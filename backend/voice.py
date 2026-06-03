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

import websockets
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from model import SYSTEM_INSTRUCTION

logger = logging.getLogger("waaie.voice")

REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-mini")
REALTIME_URL = f"wss://api.openai.com/v1/realtime?model={REALTIME_MODEL}"

# OpenAI Realtime voice name (alloy, echo, shimmer, ...). Configurable.
REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "alloy")

# Hard wall-clock cap per call, in seconds. Default 5 minutes.
MAX_CALL_SECONDS = int(os.getenv("VOICE_MAX_CALL_SECONDS", "300"))

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


def _session_update_event() -> str:
    """Build the session.update sent right after the upstream socket opens.

    GA Realtime shape: the session is typed ``realtime`` and all audio I/O
    config lives under ``audio.input`` / ``audio.output`` with object-form
    formats (``{type: "audio/pcm", rate: 24000}`` == 24 kHz mono PCM16). Server
    VAD is enabled so OpenAI handles speech detection and interruptions; PCM16
    both directions lets the browser capture/play with the Web Audio API.
    """
    return json.dumps(
        {
            "type": "session.update",
            "session": {
                "type": "realtime",
                "instructions": VOICE_INSTRUCTIONS,
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


async def _client_to_openai(client_ws: WebSocket, openai_ws) -> None:
    """Pump frames from the browser to OpenAI.

    Binary frames are raw PCM16 mic chunks -> wrapped as input_audio_buffer
    append events. Text frames are already-formed OpenAI client events ->
    forwarded as-is. Nothing is retained between iterations.
    """
    while True:
        message = await client_ws.receive()

        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))

        data = message.get("bytes")
        if data is not None:
            # Base64 is required because OpenAI Realtime carries audio inside
            # JSON events; we encode the single chunk and immediately let it go.
            payload = json.dumps(
                {
                    "type": "input_audio_buffer.append",
                    "audio": base64.b64encode(data).decode("ascii"),
                }
            )
            await openai_ws.send(payload)
            continue

        text = message.get("text")
        if text is not None:
            # A pre-formed OpenAI client event (e.g. response.create / cancel).
            await openai_ws.send(text)


async def _openai_to_client(client_ws: WebSocket, openai_ws) -> None:
    """Pump OpenAI server events back to the browser verbatim.

    Audio deltas are base64 inside the JSON; forwarding the text frame
    unmodified keeps the server off the decode path (the browser decodes).
    """
    async for event in openai_ws:
        # websockets yields str for text frames; Realtime is all-JSON text.
        if isinstance(event, bytes):
            event = event.decode("utf-8", "ignore")
        await client_ws.send_text(event)


async def handle_voice_connection(client_ws: WebSocket) -> None:
    """Accept one browser call and bridge it to a dedicated OpenAI socket.

    Wraps the two relay tasks plus a hard timeout in a single supervised group,
    and guarantees teardown of both sockets on every exit path.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        # Accept then close with a policy-violation code so the client sees a
        # clean reason instead of a silent handshake failure.
        await client_ws.accept()
        await client_ws.close(code=1011, reason="Voice service is not configured.")
        logger.error("OPENAI_API_KEY is not set; refusing voice connection.")
        return

    await client_ws.accept()

    openai_ws = None
    tasks: list[asyncio.Task] = []
    try:
        openai_ws = await _connect_openai(api_key)

        # Configure the session (server VAD, PCM16, persona) before relaying.
        await openai_ws.send(_session_update_event())

        tasks = [
            asyncio.create_task(_client_to_openai(client_ws, openai_ws)),
            asyncio.create_task(_openai_to_client(client_ws, openai_ws)),
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
