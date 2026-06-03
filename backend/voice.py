"""Realtime voice proxy: a stream-through bridge between a browser WebSocket and
OpenAI's GA Realtime API (gpt-realtime-mini).

Design goals for a 1 vCPU / 1 GB droplet:

* ZERO disk and ZERO buffering. Audio is never written to a file and never
  accumulated in a list/bytearray. Each chunk is piped straight through:
  client -> (base64 wrap) -> OpenAI, and OpenAI -> (verbatim) -> client.
* One client socket maps 1:1 to exactly one upstream OpenAI socket.
* A hard 5-minute wall-clock cap per call, after which the server tears the
  call down regardless of activity, to bound token spend and resource use.
* Server-side VAD: OpenAI detects speech/turns/interruptions natively, so the
  server does no audio analysis itself.
* Deterministic cleanup: on any exit path both sockets are closed, the relay
  tasks are cancelled, and references are dropped so nothing lingers.

Protocol contract with the frontend
------------------------------------
Client -> server:
  * BINARY frame  = a raw PCM16 (24 kHz, mono, little-endian) microphone chunk.
                    The server base64-wraps it into an
                    ``input_audio_buffer.append`` event for OpenAI.
  * TEXT frame    = a JSON OpenAI Realtime client event, forwarded verbatim
                    (e.g. a manual ``response.create`` or a barge-in cancel).

Server -> client:
  * TEXT frames   = OpenAI server events forwarded verbatim as JSON. Audio
                    arrives inside ``response.output_audio.delta`` events as
                    base64; the browser decodes and plays it. Forwarding the
                    JSON untouched keeps the server off the audio-decode path.
"""

import asyncio
import base64
import json
import logging
import os
from typing import List, Optional

import websockets
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from model import SYSTEM_INSTRUCTION
from session import Message, SessionStore

logger = logging.getLogger("waaie.voice")

REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-mini")
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={REALTIME_MODEL}"

# OpenAI Realtime voice name (alloy, echo, shimmer, ...). Configurable.
REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "alloy")

# Hard wall-clock cap per call, in seconds. Default 5 minutes.
MAX_CALL_SECONDS = int(os.getenv("VOICE_MAX_CALL_SECONDS", "300"))

# Application-level keep-alive period. The browser can't emit WebSocket protocol
# pings, and an idle stretch (assistant silent) otherwise trips a proxy/idle
# read-timeout and drops the call "after ~1 minute". The server sends a tiny
# server.ping JSON frame this often; the client sends client.ping symmetrically.
HEARTBEAT_SECONDS = 15

# How long to wait, right after accept, for the browser's one-shot client.context
# frame (the visible chat history) before giving up and using server-side memory.
CONTEXT_WAIT_SECONDS = 5.0

# Caps on the live context folded into the session prompt, so a long chat or a
# big uploaded document can't bloat the session.update payload.
MAX_DOCUMENT_CHARS = 12000
MAX_HISTORY_MESSAGES = 20

# Pre-serialized keep-alive frame sent server -> client.
_SERVER_PING = json.dumps({"type": "server.ping"})

# A spoken-style addendum to the shared Waaie persona: voice answers must be
# conversational, never markdown/code, and short enough to listen to.
_VOICE_ADDENDUM = (
    "\n\n============================================================\n"
    "VOICE MODE — SPOKEN ANSWERS ONLY\n"
    "============================================================\n"
    "You are now speaking out loud, not writing. Respond in natural, "
    "conversational spoken language in the SAME language the student speaks "
    "(Arabic or English). Keep answers concise and easy to follow by ear. "
    "Do NOT use markdown, headings, bullet symbols, code fences, tables, or "
    "LaTeX — none of that can be heard. Read formulas aloud in words (e.g. say "
    "'E equals I squared times R times t'). If an explanation is long, give the "
    "core idea first, then ask if the student wants more detail."
)

VOICE_INSTRUCTIONS = SYSTEM_INSTRUCTION + _VOICE_ADDENDUM


async def _connect_openai(api_key: str):
    """Open the upstream Realtime socket, tolerating the websockets-library
    header-kwarg rename.

    websockets <14 takes ``extra_headers``; >=14 renamed it to
    ``additional_headers`` and dropped the old name. Try the new name first and
    fall back so the same code runs on either version.
    """
    # GA Realtime authenticates with the bearer token only. The legacy
    # ``OpenAI-Beta: realtime=v1`` header selects the now-decommissioned beta
    # shape; sending it on a GA-only account makes OpenAI close the upstream
    # with ``invalid_request_error.beta_api_shape_disabled``.
    headers = {"Authorization": f"Bearer {api_key}"}
    common = {
        "max_size": None,  # don't cap frame size; audio deltas can be large
        "ping_interval": 20,
        "ping_timeout": 20,
    }
    try:
        return await websockets.connect(
            REALTIME_URL, additional_headers=headers, **common
        )
    except TypeError:
        return await websockets.connect(
            REALTIME_URL, extra_headers=headers, **common
        )


def _voice_instructions(
    document: Optional[str], history: List[Message]
) -> str:
    """Compose the spoken-mode system prompt with this session's live context.

    Folds two extra blocks into the base persona so the voice bot is NOT
    amnesiac about what happened in the text chat: (1) the text of any document
    uploaded in this session, and (2) a transcript of the recent typed
    conversation. Both are capped (``MAX_DOCUMENT_CHARS`` /
    ``MAX_HISTORY_MESSAGES``) so a long chat or a large PDF can't blow up the
    session.update payload.
    """
    parts = [VOICE_INSTRUCTIONS]

    snippet = (document or "").strip()[:MAX_DOCUMENT_CHARS]
    if snippet:
        parts.append(
            "\n\n============================================================\n"
            "DOCUMENT THE STUDENT IS STUDYING\n"
            "============================================================\n"
            "The student uploaded a document in this session. Its text is below. "
            "Use it to answer questions about 'this document', 'the file', "
            "'the PDF', or 'what I sent you'.\n\n" + snippet
        )

    recent = [
        m
        for m in (history or [])
        if isinstance(m, dict) and m.get("content")
    ][-MAX_HISTORY_MESSAGES:]
    if recent:
        lines = []
        for m in recent:
            speaker = "Student" if m.get("role") == "user" else "Waaie"
            lines.append(f"{speaker}: {m['content']}")
        parts.append(
            "\n\n============================================================\n"
            "EARLIER IN THIS CONVERSATION (typed chat)\n"
            "============================================================\n"
            "Before this voice call, you and the student exchanged the messages "
            "below by text. Continue naturally from here — don't reintroduce "
            "yourself or repeat what was already covered.\n\n" + "\n".join(lines)
        )

    return "".join(parts)


def _session_update_event(instructions: str) -> str:
    """Build the session.update sent right after the upstream socket opens.

    GA Realtime shape: the session is typed ``realtime`` and all audio I/O
    config lives under ``audio.input`` / ``audio.output`` with object-form
    formats (``{type: "audio/pcm", rate: 24000}`` == 24 kHz mono PCM16). Server
    VAD is enabled so OpenAI handles speech detection and interruptions; PCM16
    both directions lets the browser capture/play with the Web Audio API. The
    ``instructions`` already carry the persona plus this session's live context.
    """
    return json.dumps(
        {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "instructions": instructions,
                "output_modalities": ["audio"],
                "audio": {
                    "input": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                        },
                        "transcription": {"model": "whisper-1"},
                    },
                    "output": {
                        "format": {"type": "audio/pcm", "rate": 24000},
                        "voice": REALTIME_VOICE,
                    },
                },
            },
        }
    )


def _control_frame(text: str) -> Optional[dict]:
    """Return the parsed frame if ``text`` is an app-level control frame, else None.

    Control frames are signals between the browser and THIS proxy — the
    keep-alive heartbeat and the one-shot chat-history hand-off — namespaced
    with a ``client.`` / ``server.`` ``type`` prefix. They must NEVER be
    forwarded to OpenAI. Anything else (a real OpenAI client event, or
    unparseable text) returns None and is relayed verbatim.
    """
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    kind = obj.get("type")
    if isinstance(kind, str) and (
        kind.startswith("client.") or kind.startswith("server.")
    ):
        return obj
    return None


async def _forward_client_message(message: dict, openai_ws) -> None:
    """Forward one browser frame to OpenAI, swallowing app-level control frames.

    Binary frame -> wrapped as an ``input_audio_buffer.append`` event. Text
    frame -> forwarded verbatim, UNLESS it is a namespaced control frame
    (``client.*`` / ``server.*``), which is meant for this proxy only and must
    not reach OpenAI. Nothing is retained between calls.
    """
    data = message.get("bytes")
    if data is not None:
        # Base64 is required because OpenAI Realtime carries audio inside JSON
        # events; we encode the single chunk and immediately let it go.
        payload = json.dumps(
            {
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(data).decode("ascii"),
            }
        )
        await openai_ws.send(payload)
        return

    text = message.get("text")
    if text is not None:
        if _control_frame(text) is not None:
            return  # heartbeat / context hand-off: not for OpenAI
        # A pre-formed OpenAI client event (e.g. response.create / cancel).
        await openai_ws.send(text)


async def _client_to_openai(client_ws: WebSocket, openai_ws) -> None:
    """Pump frames from the browser to OpenAI (see _forward_client_message)."""
    while True:
        message = await client_ws.receive()

        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))

        await _forward_client_message(message, openai_ws)


async def _openai_to_client(
    client_ws: WebSocket, openai_ws, send_lock: asyncio.Lock
) -> None:
    """Pump OpenAI server events back to the browser verbatim.

    Audio deltas are base64 inside the JSON; forwarding the text frame
    unmodified keeps the server off the decode path (the browser decodes). The
    send is serialized through ``send_lock`` because the heartbeat task also
    writes to this same socket, and concurrent sends would interleave frames.
    """
    async for event in openai_ws:
        # websockets yields str for text frames; Realtime is all-JSON text.
        if isinstance(event, bytes):
            event = event.decode("utf-8", "ignore")
        async with send_lock:
            await client_ws.send_text(event)


async def _heartbeat(client_ws: WebSocket, send_lock: asyncio.Lock) -> None:
    """Send a ``server.ping`` to the browser every ``HEARTBEAT_SECONDS``.

    Keeps the end-to-end path warm so an idle stretch (assistant not speaking)
    doesn't trip an intermediary's read timeout and drop the call. Shares
    ``send_lock`` with the relay so the two senders never interleave frames.
    The browser swallows ``server.ping``; it is never shown or forwarded.
    """
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        async with send_lock:
            await client_ws.send_text(_SERVER_PING)


async def handle_voice_connection(
    client_ws: WebSocket, sessions: SessionStore
) -> None:
    """Accept one browser call and bridge it to a dedicated OpenAI socket.

    Before relaying, the call is primed with this session's context so the bot
    isn't amnesiac: the uploaded document (from server memory, keyed by the
    ``?session=`` query param) and the visible chat history (sent once by the
    browser as a ``client.context`` frame) are folded into the OpenAI
    session.update. Then three tasks run under one supervisor — client->OpenAI,
    OpenAI->client, and a server->client heartbeat — with a hard timeout, and
    both sockets are torn down on every exit path.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        # Accept then close with a policy-violation code so the client sees a
        # clean reason instead of a silent handshake failure.
        await client_ws.accept()
        await client_ws.close(code=1011, reason="Voice service is not configured.")
        logger.error("OPENAI_API_KEY is not set; refusing voice connection.")
        return

    # The session id rides in as a query param (?session=...), letting us look
    # up the document + typed history this call should remember.
    session_id = (client_ws.query_params.get("session") or "").strip()
    document = sessions.document(session_id) if session_id else None
    history: List[Message] = sessions.history(session_id) if session_id else []

    await client_ws.accept()

    openai_ws = None
    tasks: list[asyncio.Task] = []
    # A first frame consumed during the context pre-roll that turned out NOT to
    # be the context handshake (audio or a real event); replayed after setup.
    deferred = None
    try:
        # --- Context pre-roll ------------------------------------------------
        # The browser sends a single client.context frame (the visible chat
        # history) right after open, before any audio. Wait briefly for it so
        # the FIRST thing OpenAI sees already carries the conversation. If it
        # never arrives, fall back to the server-side history; if the first
        # frame is something else, stash it and relay it once setup is done.
        try:
            first = await asyncio.wait_for(
                client_ws.receive(), timeout=CONTEXT_WAIT_SECONDS
            )
            if first["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(first.get("code", 1000))
            text = first.get("text")
            ctrl = _control_frame(text) if text is not None else None
            if ctrl is not None and ctrl.get("type") == "client.context":
                supplied = ctrl.get("history")
                if isinstance(supplied, list):
                    history = supplied
            elif ctrl is None:
                deferred = first  # audio / real event — replay after setup
        except asyncio.TimeoutError:
            pass

        openai_ws = await _connect_openai(api_key)

        # Configure the session (server VAD, PCM16, persona + live context).
        instructions = _voice_instructions(document, history)
        await openai_ws.send(_session_update_event(instructions))

        # Replay the non-context frame we pulled during the pre-roll, if any.
        if deferred is not None:
            await _forward_client_message(deferred, openai_ws)

        # The relay and the heartbeat both write to the browser socket; a shared
        # lock serializes those sends so their frames never interleave.
        send_lock = asyncio.Lock()
        tasks = [
            asyncio.create_task(_client_to_openai(client_ws, openai_ws)),
            asyncio.create_task(
                _openai_to_client(client_ws, openai_ws, send_lock)
            ),
            asyncio.create_task(_heartbeat(client_ws, send_lock)),
        ]

        # Whichever finishes first (a disconnect, an error, or the timeout)
        # ends the call; the hard cap bounds cost on a runaway connection.
        done, pending = await asyncio.wait(
            tasks,
            timeout=MAX_CALL_SECONDS,
            return_when=asyncio.FIRST_COMPLETED,
        )

        if not done:
            logger.info("Voice call hit the %ss cap; closing.", MAX_CALL_SECONDS)

        # Surface a relay error (other than a normal disconnect) for logging.
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                logger.warning("Voice relay ended with error: %r", exc)

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # upstream connect failure, network drop, etc.
        logger.warning("Voice bridge failed: %r", exc)
    finally:
        # 1) Cancel both relay tasks and await their unwind.
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

        # 2) Terminate the upstream OpenAI socket.
        if openai_ws is not None:
            try:
                await openai_ws.close()
            except Exception:
                pass

        # 3) Close the browser socket if still open.
        try:
            if client_ws.client_state != WebSocketState.DISCONNECTED:
                await client_ws.close()
        except Exception:
            pass

        # 4) Drop references so nothing is held past the call.
        openai_ws = None
        tasks = []
