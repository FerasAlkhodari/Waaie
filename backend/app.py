import asyncio
import json
import os
import uuid
from typing import AsyncIterator, List, Optional

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import quiz
from documents import SUPPORTED_EXTENSIONS, DocumentParseError, extract_text
from model import DeepSeekMentor, detect_language
from session import SessionStore
from voice import handle_voice_connection

load_dotenv()

# Per-client rate limit, configurable via the RATE_LIMIT env var.
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Waaie API",
    description=(
        "DeepSeek-powered AI study mentor for Saudi high school subjects — "
        "Mathematics, Physics, Chemistry, Biology/Earth & Space Sciences, and "
        "Digital Technology & Computer Science (Arabic & English)."
    ),
    version="2.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Minimal security headers on every response.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

# Setup CORS. The deployed frontend origins are baked in so the API works the
# moment it's reached through the Ngrok tunnel, and any extra origins from the
# CORS_ORIGINS env var (comma-separated) are merged on top. Merging — rather
# than replacing — means the production domain stays allowed even if a local
# .env still pins CORS_ORIGINS to localhost.
DEFAULT_CORS_ORIGINS = [
    "https://waaie.feraswe.com",  # production frontend (Vercel + custom domain)
    "http://localhost:3000",  # local React dev server
    "http://127.0.0.1:3000",
]

_extra_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
# De-duplicated, order-stable union of the baked-in defaults and any env origins.
cors_origins = list(dict.fromkeys(DEFAULT_CORS_ORIGINS + _extra_origins))

# A literal "*" cannot be combined with credentialed requests — browsers reject
# `Access-Control-Allow-Origin: *` when credentials are sent. With an explicit
# allow-list we keep allow_credentials=True; only if CORS_ORIGINS is set to "*"
# do we drop credentials to keep the response browser-valid.
allow_all_origins = "*" in cors_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_origins else cors_origins,
    allow_credentials=not allow_all_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the DeepSeek-backed mentor. Fails fast if DEEPSEEK_API_KEY is unset.
mentor = DeepSeekMentor()

# Process-local conversation memory. The window (last N turns) is configurable
# via CHAT_HISTORY_TURNS; each turn is one user + one assistant message.
_HISTORY_TURNS = int(os.getenv("CHAT_HISTORY_TURNS", "10"))
sessions = SessionStore(max_messages=_HISTORY_TURNS * 2)


RATE_LIMIT = os.getenv("RATE_LIMIT", "20/minute")

# Maximum accepted upload size for /ask-document (bytes). Configurable via env.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024

# Default prompt used when a document is uploaded without a typed question.
DEFAULT_DOC_PROMPT = "لخّص محتوى هذا المستند وأبرز أهم النقاط الدراسية فيه."

# Headers that keep token deltas flushing to the browser immediately instead of
# being buffered until the whole response completes. ``X-Accel-Buffering: no``
# disables nginx/ngrok response buffering for this Server-Sent Events stream.
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _sse(payload: dict) -> str:
    """Serialize one Server-Sent Events frame. ``ensure_ascii=False`` keeps
    Arabic deltas as literal UTF-8 rather than \\uXXXX escapes."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def _answer_events(
    session_id: str,
    prompt: str,
    document: Optional[str],
    language: str,
    extra_meta: Optional[dict] = None,
) -> AsyncIterator[str]:
    """Shared SSE generator powering the streaming chat endpoints.

    Frame protocol (one JSON object per ``data:`` frame, keyed by ``type``):
      * ``meta``  — emitted once up front: session id + detected language
                    (plus any ``extra_meta``, e.g. the document filename).
      * ``delta`` — one per token as it arrives, carrying ``text``.
      * ``done``  — terminal success marker.
      * ``error`` — emitted instead of ``done`` on ANY upstream failure or an
                    entirely empty stream; the frontend collapses it to the
                    localized recovery notice.

    The session turn is recorded only after a non-empty answer fully streams, so
    a failed/partial stream never pollutes conversation memory.

    This MUST be an async generator: ``StreamingResponse`` over a *sync*
    generator silently emits an empty body on the current Starlette/Python
    stack, which would deliver a 200 with no tokens (the streaming "stops"). The
    model's ``stream_answer`` is blocking I/O, so it is pumped in a worker thread
    that hands tokens to this coroutine through an ``asyncio.Queue`` — the event
    loop stays free to flush each delta (and to service the voice WebSocket /
    other requests) instead of blocking on every token.
    """
    meta = {"type": "meta", "session_id": session_id, "language": language}
    if extra_meta:
        meta.update(extra_meta)
    yield _sse(meta)

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def _produce() -> None:
        """Runs in a thread: drain the blocking model stream into the queue.

        Frames are tagged ``('delta', text)`` / ``('error', None)`` and always
        terminated by a single ``('end', None)`` so the consumer can stop."""
        try:
            history = sessions.history(session_id)
            for delta in mentor.stream_answer(
                prompt, context=document, history=history
            ):
                loop.call_soon_threadsafe(queue.put_nowait, ("delta", delta))
        except Exception:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", None))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, ("end", None))

    producer = asyncio.create_task(asyncio.to_thread(_produce))

    chunks: List[str] = []
    errored = False
    try:
        while True:
            kind, value = await queue.get()
            if kind == "delta":
                chunks.append(value)
                yield _sse({"type": "delta", "text": value})
            elif kind == "error":
                errored = True
            else:  # "end" — producer is done (cleanly or after an error)
                break
    finally:
        # Always join the worker thread, even on client disconnect (GeneratorExit).
        await producer

    if errored:
        yield _sse({"type": "error"})
        return

    answer = "".join(chunks).strip()
    if not answer:
        yield _sse({"type": "error"})
        return

    sessions.add_turn(session_id, prompt, answer)
    yield _sse({"type": "done"})


class Question(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description=(
            "A Saudi high-school subject question — Mathematics, Physics, "
            "Chemistry, Biology/Earth & Space Sciences, or Digital "
            "Technology & Computer Science — to ask the mentor."
        ),
    )
    session_id: Optional[str] = Field(
        default=None,
        max_length=64,
        description=(
            "Optional conversation id. Pass the session_id returned by a "
            "previous response to continue the same chat (the mentor will "
            "remember recent turns and any uploaded document). Omit it to "
            "start a fresh conversation; a new id is then returned."
        ),
    )

    model_config = {
        "json_schema_extra": {
            "example": {"question": "اشرح قانون نيوتن الثاني للحركة مع مثال"}
        }
    }


# --------------------------------------------------------------------------- #
# Interactive Question Generator (صانع الأسئلة التفاعلي) — request schemas.
# The quiz is 100% stateless: the whole quiz state round-trips in the payload
# (no DB, no SessionStore). The server only ever reads the static subject assets
# and the unchanged SYSTEM_INSTRUCTION guardrails.
# --------------------------------------------------------------------------- #


class QuizQuestionRequest(BaseModel):
    subject: str = Field(..., description="Subject id, e.g. 'physics'.")
    difficulty: str = Field(default="medium", description="easy | medium | hard")
    total: int = Field(default=10, ge=1, le=30, description="Quiz length.")
    number: int = Field(default=1, ge=1, le=30, description="Which question to make.")
    asked: List[str] = Field(
        default_factory=list,
        description="Texts of questions already shown, to avoid repeats.",
    )


class QuizStateModel(BaseModel):
    subject: str
    difficulty: str = "medium"
    total: int = Field(..., ge=1, le=30)
    index: int = Field(..., ge=0, description="Questions answered so far.")
    score: int = Field(..., ge=0)


class QuizAnswerRequest(BaseModel):
    quiz: QuizStateModel
    token: str = Field(..., description="The sealed answer token for the question.")
    selected: Optional[int] = Field(
        default=None, description="Chosen option index (0-3); null = skipped."
    )


class QuizStartRequest(BaseModel):
    """Start a whole quiz: the entire set is generated in ONE bulk model call so
    the client can advance between pre-fetched questions with zero latency."""

    subject: str = Field(..., description="Subject id, e.g. 'physics'.")
    difficulty: str = Field(default="medium", description="easy | medium | hard")
    total: int = Field(default=10, ge=1, le=30, description="Quiz length.")


class QuizVoiceMatchRequest(BaseModel):
    """Resolve a spoken answer to an option index — fully local, no model call."""

    transcript: str = Field(
        default="",
        max_length=1000,
        description="Speech-to-text of the spoken answer (may be a full sentence).",
    )
    alternatives: List[str] = Field(
        default_factory=list,
        max_length=8,
        description="Optional N-best STT alternatives, tried if the primary misses.",
    )
    options: List[str] = Field(
        ..., min_length=2, max_length=6, description="The displayed answer options."
    )
    language: str = Field(default="ar", description="Question language: 'ar' | 'en'.")


# Output headroom for the bulk call. A 30-question minified array can run past
# the model's modest default cap, so the batch path asks for room to finish the
# JSON; the single-question path is unaffected. Configurable via env.
QUIZ_BULK_MAX_TOKENS = int(os.getenv("QUIZ_BULK_MAX_TOKENS", "8000"))


def _quiz_complete(prompt: str) -> str:
    """Single-completion bridge for the generator: routes through the mentor so
    the unchanged SYSTEM_INSTRUCTION academic guardrails apply to quiz items."""
    return mentor.get_answer(prompt)["answer"]


def _quiz_bulk_complete(prompt: str) -> str:
    """Bulk bridge: same guardrailed mentor, with extra output headroom so a
    large minified JSON array is not truncated mid-object."""
    return mentor.get_answer(prompt, max_tokens=QUIZ_BULK_MAX_TOKENS)["answer"]


def _generate_quiz_batch_payloads(subject_id, difficulty, total):
    """Generate the whole quiz in one model call and shape each item for the
    client (sealed answers, no plaintext correct option). Maps generation
    failures to a 502 like the chat/single-question paths."""
    try:
        questions = quiz.generate_quiz_batch(
            _quiz_bulk_complete, subject_id, difficulty, total
        )
    except quiz.QuizGenerationError as exc:
        raise HTTPException(status_code=502, detail=f"Quiz generation failed: {exc}")
    except Exception as exc:  # upstream model / network failure
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {exc}")

    subject = quiz.get_subject(subject_id)
    actual_total = len(questions)
    return [
        quiz.make_question_payload(question, number, actual_total, subject)
        for number, question in enumerate(questions, start=1)
    ]


def _generate_question_payload(subject_id, difficulty, number, total, asked):
    """Generate one MCQ and shape it for the client (sealed answer, no plaintext
    correct option). Maps generation failures to a 502 like the chat path."""
    try:
        question = quiz.generate_question(
            _quiz_complete, subject_id, difficulty, asked
        )
    except quiz.QuizGenerationError as exc:
        raise HTTPException(status_code=502, detail=f"Question generation failed: {exc}")
    except Exception as exc:  # upstream model / network failure
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {exc}")
    subject = quiz.get_subject(subject_id)
    return quiz.make_question_payload(question, number, total, subject)


@app.get("/quiz/subjects")
async def quiz_subjects():
    """List the subjects available in the Question Bank (بنك الأسئلة)."""
    return {"status": "success", "subjects": quiz.list_subjects()}


@app.post("/quiz/start")
@limiter.limit(RATE_LIMIT)
async def quiz_start(request: Request, body: QuizStartRequest):
    """Generate an ENTIRE quiz in ONE bulk model call (zero-latency transitions).

    Returns every question pre-sealed, so the client pre-fetches the whole set
    and advances instantly between questions; only stateless grading
    (``/quiz/answer``) happens per answer. The correct answers ride back sealed
    in each ``question.token``, never in the clear. If the model returns fewer
    valid questions than requested, ``total`` reflects what was actually built.
    """
    try:
        quiz.get_subject(body.subject)
    except quiz.UnknownSubjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    difficulty = quiz.normalize_difficulty(body.difficulty)
    total = quiz.clamp_count(body.total)

    questions = _generate_quiz_batch_payloads(body.subject, difficulty, total)
    return {"status": "success", "total": len(questions), "questions": questions}


@app.post("/quiz/voice-match")
async def quiz_voice_match(body: QuizVoiceMatchRequest):
    """Resolve a spoken answer to an option index — fully local, no model call.

    Deliberately NOT rate-limited: matching is pure CPU work and runs on the
    hands-free answer path, where a 429 would be worse than the (negligible)
    abuse surface of a stateless string match. Returns ``index = -1`` when no
    option matches confidently, so the client can ask the student to repeat.

    The primary transcript plus any N-best ``alternatives`` are tried in order so
    a mis-ranked lone-letter hypothesis still resolves.
    """
    candidates = [body.transcript, *body.alternatives]
    match = quiz.match_spoken_answer_multi(candidates, body.options, body.language)
    return {"status": "success", **match}


@app.post("/quiz/question")
@limiter.limit(RATE_LIMIT)
async def quiz_question(request: Request, body: QuizQuestionRequest):
    """Generate ONE quiz question (the 'يتم صناعة السؤال...' step).

    Used both to start a quiz (``number=1``) and to advance it. Generation is
    the only model call in the loop; grading (``/quiz/answer``) is instant. The
    correct answer is returned sealed in ``question.token``, never in the clear.
    """
    try:
        quiz.get_subject(body.subject)
    except quiz.UnknownSubjectError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    difficulty = quiz.normalize_difficulty(body.difficulty)
    total = quiz.clamp_count(body.total)
    number = max(1, min(total, body.number))

    question = _generate_question_payload(
        body.subject, difficulty, number, total, body.asked
    )
    return {"status": "success", "question": question}


@app.post("/quiz/answer")
@limiter.limit(RATE_LIMIT)
async def quiz_answer(request: Request, body: QuizAnswerRequest):
    """Grade one submitted answer and return the revealed result (correct flag +
    a lazily-generated explanation/insight) plus the updated, round-tripped quiz
    state. The verdict itself is instant from the sealed token; only the teaching
    feedback for this one question is generated here (kept off the fast kickoff
    path). When the last question is graded, also return the final score +
    assessment (مبتدئ / متوسط / متقدم). Fully stateless: score/progress live in the
    payload."""
    try:
        result = quiz.evaluate_answer(body.token, body.selected)
    except quiz.QuizTokenError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Explanation + insight (نقاط التطوير) are generated LAZILY here, not at
    # kickoff, so the batch starts fast. Best-effort and self-contained: the
    # question/options come from the sealed token, and a feedback failure degrades
    # to an empty explanation rather than blocking the (already-decided) grade.
    feedback = quiz.generate_feedback(
        _quiz_complete,
        result["question"],
        result["options"],
        result["correct_index"],
        body.selected,
    )

    state = body.quiz
    answered = state.index + 1
    new_score = state.score + (1 if result["correct"] else 0)

    response = {
        "status": "success",
        "result": {
            "correct": result["correct"],
            "correct_index": result["correct_index"],
            "explanation": feedback["explanation"],
            "topic": feedback["topic"],
            "number": answered,
        },
        "quiz": {
            "subject": state.subject,
            "difficulty": state.difficulty,
            "total": state.total,
            "index": answered,
            "score": new_score,
        },
        "final": None,
    }

    if answered >= state.total:
        response["final"] = {
            "score": new_score,
            "total": state.total,
            "assessment": quiz.assess(new_score, state.total),
        }

    return response


@app.get("/")
async def root():
    return {
        "message": "Welcome to the Waaie API",
        "version": "2.0.0",
        "endpoints": {
            "POST /ask": (
                "Ask a Saudi high-school subject question — math, physics, "
                "chemistry, biology/earth & space, or digital technology "
                "(Arabic or English)"
            ),
            "POST /ask-document": (
                "Upload a study document ("
                + ", ".join(SUPPORTED_EXTENSIONS)
                + ") and ask a question about its contents"
            ),
            "GET /quiz/subjects": "List subjects for the Question Bank (بنك الأسئلة)",
            "POST /quiz/start": (
                "Generate a whole quiz in one bulk call (صانع الأسئلة التفاعلي)"
            ),
            "POST /quiz/question": "Generate one quiz question (single/regen path)",
            "POST /quiz/answer": "Grade an answer and track the score statelessly",
            "POST /quiz/voice-match": "Map a spoken answer to an option index",
            "GET /health": "Check API health status",
        },
    }


@app.post("/ask")
@limiter.limit(RATE_LIMIT)
async def ask_question(request: Request, question: Question):
    # Resume the given conversation, or start a new one and hand back its id.
    session_id = (question.session_id or "").strip() or str(uuid.uuid4())
    try:
        history = sessions.history(session_id)
        # If a document was uploaded earlier in this session, keep answering
        # follow-up questions against it.
        document = sessions.document(session_id)
        result = mentor.get_answer(
            question.question, context=document, history=history
        )
        sessions.add_turn(session_id, question.question, result["answer"])
        return {
            "status": "success",
            "message": "Answer generated",
            "session_id": session_id,
            "data": {
                "answer": result["answer"],
                "language": result["language"],
            },
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {e}")


@app.post("/ask-stream")
@limiter.limit(RATE_LIMIT)
async def ask_question_stream(request: Request, question: Question):
    """Token-streaming twin of ``POST /ask``.

    Streams the answer as Server-Sent Events so the client can render it
    word-by-word in real time. Identical session memory, uploaded-document
    follow-up, and SYSTEM_INSTRUCTION guardrails as ``/ask`` — only the
    transport differs. Errors are signalled in-band via an ``error`` frame
    (see ``_answer_events``) since the HTTP status is already committed once the
    stream begins.
    """
    session_id = (question.session_id or "").strip() or str(uuid.uuid4())
    document = sessions.document(session_id)
    language = detect_language(question.question)
    return StreamingResponse(
        _answer_events(session_id, question.question, document, language),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@app.post("/ask-document")
@limiter.limit(RATE_LIMIT)
async def ask_document(
    request: Request,
    file: UploadFile = File(...),
    question: str = Form(""),
    session_id: str = Form(""),
):
    session_id = session_id.strip() or str(uuid.uuid4())

    data = await file.read()

    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. The maximum size is {limit_mb} MB.",
        )

    try:
        document_text = extract_text(file.filename, data)
    except DocumentParseError as de:
        raise HTTPException(status_code=400, detail=str(de))

    # Persist the document on the session so later /ask follow-ups can reference
    # it without re-uploading.
    sessions.set_document(session_id, document_text)

    prompt = question.strip() or DEFAULT_DOC_PROMPT

    try:
        history = sessions.history(session_id)
        result = mentor.get_answer(
            prompt, context=document_text, history=history
        )
        sessions.add_turn(session_id, prompt, result["answer"])
        return {
            "status": "success",
            "message": "Answer generated from document",
            "session_id": session_id,
            "data": {
                "answer": result["answer"],
                "language": result["language"],
                "filename": file.filename,
            },
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {e}")


@app.post("/ask-document-stream")
@limiter.limit(RATE_LIMIT)
async def ask_document_stream(
    request: Request,
    file: UploadFile = File(...),
    question: str = Form(""),
    session_id: str = Form(""),
):
    """Token-streaming twin of ``POST /ask-document``.

    The upload is validated and parsed up front (so bad files still get a real
    4xx status before the stream starts); the answer about the document is then
    streamed as Server-Sent Events, exactly like ``/ask-stream``.
    """
    session_id = session_id.strip() or str(uuid.uuid4())

    data = await file.read()

    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. The maximum size is {limit_mb} MB.",
        )

    try:
        document_text = extract_text(file.filename, data)
    except DocumentParseError as de:
        raise HTTPException(status_code=400, detail=str(de))

    # Persist the document on the session so later follow-ups can reference it.
    sessions.set_document(session_id, document_text)

    prompt = question.strip() or DEFAULT_DOC_PROMPT
    language = detect_language(prompt)
    return StreamingResponse(
        _answer_events(
            session_id,
            prompt,
            document_text,
            language,
            extra_meta={"filename": file.filename},
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@app.get("/ask")
async def ask_not_allowed():
    raise HTTPException(
        status_code=405,
        detail=(
            "Method Not Allowed. Use POST to /ask with a JSON body "
            "containing your question."
        ),
    )


@app.websocket("/voice")
async def voice_endpoint(websocket: WebSocket):
    """Live, bi-directional voice call bridged to OpenAI's Realtime API.

    The connection is a stream-through proxy (no disk, no buffering) with a hard
    per-call timeout and deterministic cleanup. See voice.py for the protocol.
    The shared SessionStore lets the call recall this session's document and
    typed chat history so the voice bot isn't amnesiac.
    """
    await handle_voice_connection(websocket, sessions)


@app.get("/health")
async def health_check():
    try:
        assert mentor.client is not None
        return {
            "status": "healthy",
            "model": mentor.model,
            "provider": "deepseek",
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Service Unhealthy: {str(e)}",
        )
