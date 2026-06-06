"""Voice-proxy helper contract + streaming-pipeline safety.

These tests run fully offline (no WebSocket, no OpenAI). They cover the pure
helpers in ``voice.py`` that the live transcript feature depends on, and they
assert that the DeepSeek streaming pipeline is a lazy generator — so it can be
driven incrementally without making a blocking call at construction time.
"""

import asyncio
import inspect
import json

import voice
from model import SYSTEM_INSTRUCTION, DeepSeekMentor


# --------------------------------------------------------------------------- #
# Voice system-prompt assembly.
# --------------------------------------------------------------------------- #

def test_voice_instructions_carry_persona_and_spoken_addendum():
    instr = voice._voice_instructions(None, [])
    assert SYSTEM_INSTRUCTION in instr
    assert "VOICE MODE" in instr  # spoken-answers-only addendum is folded in


def test_voice_instructions_fold_document_and_history():
    instr = voice._voice_instructions(
        "PHOTOSYNTHESIS STUDY NOTES",
        [
            {"role": "user", "content": "ما هي الخلية؟"},
            {"role": "assistant", "content": "الخلية هي وحدة بناء الكائن الحي."},
        ],
    )
    assert "PHOTOSYNTHESIS STUDY NOTES" in instr  # uploaded doc context
    assert "ما هي الخلية؟" in instr  # prior typed turn is remembered


# --------------------------------------------------------------------------- #
# session.update — must enable the transcription that powers the live preview.
# --------------------------------------------------------------------------- #

def test_session_update_enables_user_transcription_and_audio_out():
    event = json.loads(voice._session_update_event("INSTR"))
    session = event["session"]
    assert event["type"] == "session.update"
    # whisper transcription on the input is what produces the user's question
    # text that gets merged into the chat on hang-up (Criterion #3).
    assert session["audio"]["input"]["transcription"]["model"]
    # audio output (with a voice) is what carries the spoken-transcript stream.
    assert session["audio"]["output"]["voice"]
    assert session["instructions"] == "INSTR"


# --------------------------------------------------------------------------- #
# Control frames are app<->proxy signals and must never reach OpenAI.
# --------------------------------------------------------------------------- #

def test_control_frames_recognized():
    assert (
        voice._control_frame(json.dumps({"type": "client.context", "history": []}))[
            "type"
        ]
        == "client.context"
    )
    assert voice._control_frame(json.dumps({"type": "client.ping"}))["type"] == (
        "client.ping"
    )
    # A real OpenAI client event and unparseable text are NOT control frames.
    assert voice._control_frame(json.dumps({"type": "response.create"})) is None
    assert voice._control_frame("not json at all") is None


def test_forward_client_message_filters_control_and_wraps_audio():
    sent = []

    class _FakeOpenAIWS:
        async def send(self, payload):
            sent.append(payload)

    ws = _FakeOpenAIWS()

    # A control frame is swallowed (never forwarded upstream).
    asyncio.run(
        voice._forward_client_message(
            {"text": json.dumps({"type": "client.ping"})}, ws
        )
    )
    assert sent == []

    # A genuine OpenAI client event is forwarded verbatim.
    asyncio.run(
        voice._forward_client_message(
            {"text": json.dumps({"type": "response.create"})}, ws
        )
    )
    assert len(sent) == 1

    # A binary mic chunk is wrapped into an input_audio_buffer.append event.
    asyncio.run(voice._forward_client_message({"bytes": b"\x01\x02\x03\x04"}, ws))
    assert len(sent) == 2
    wrapped = json.loads(sent[1])
    assert wrapped["type"] == "input_audio_buffer.append"
    assert wrapped["audio"]  # base64 payload present


# --------------------------------------------------------------------------- #
# Streaming pipeline is non-blocking: the generator defers the API call until
# it is iterated, so the relay can pump deltas without blocking on construction.
# --------------------------------------------------------------------------- #

def test_stream_answer_is_lazy_non_blocking_generator(monkeypatch):
    mentor = DeepSeekMentor()
    calls = {"n": 0}

    def _fake_create(**kwargs):
        calls["n"] += 1
        assert kwargs.get("stream") is True

        def _gen():
            for piece in ("Hel", "lo"):
                delta = type("_D", (), {"content": piece})()
                choice = type("_C", (), {"delta": delta})()
                yield type("_Chunk", (), {"choices": [choice]})()

        return _gen()

    monkeypatch.setattr(mentor.client.chat.completions, "create", _fake_create)

    gen = mentor.stream_answer("What is the CPU?")
    assert inspect.isgenerator(gen)
    # Constructing the generator must NOT have hit the API yet (no blocking call).
    assert calls["n"] == 0

    out = "".join(gen)
    assert calls["n"] == 1
    assert out == "Hello"
