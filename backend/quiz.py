"""Stateless engine for the Interactive Question Generator (صانع الأسئلة التفاعلي).

The feature generates quiz questions live with DeepSeek, grounded on per-subject
context assets in ``data/exam_banks/`` (built by ``scripts/build_exam_banks.py``).
It holds **no** server state: every quiz's subject, difficulty, length, current
index and running score round-trip in the request/response payload, and each
question's correct answer is sealed into an HMAC token the client echoes back —
so the server can score an answer it never stored, and a tampered token can't
forge a correct result. No database, cache, or session is involved.

The existing academic guardrails in ``model.SYSTEM_INSTRUCTION`` are reused
unchanged: generation goes through ``DeepSeekMentor.get_answer``, so the same
scope rules that govern the chat apply to the quiz, and this module never edits
that prompt.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# Read-only catalog of subject grounding assets. Loaded once at import — this is
# constant reference data committed to the repo, not mutable runtime state.
_ASSET_DIR = Path(__file__).resolve().parent / "data" / "exam_banks"

# Bounds on a quiz so a crafted payload can't request an unbounded run.
MIN_QUESTIONS = 1
MAX_QUESTIONS = 30
DEFAULT_QUESTIONS = 10

# Difficulty keys accepted from the client → Arabic label shown to the student.
DIFFICULTY_LABELS = {"easy": "سهل", "medium": "متوسط", "hard": "صعب"}
DEFAULT_DIFFICULTY = "medium"

# Server secret that seals each question's answer. MUST be set (and identical)
# across instances in production for tokens to verify; the dev default keeps
# local runs and the offline test suite working with no configuration.
_SECRET = os.getenv("QUIZ_SECRET", "waaie-dev-quiz-secret").encode("utf-8")

# Caps so a round-tripped token stays small. The token now seals the question
# CONTEXT (question text + options + correct index) instead of an explanation —
# explanations are generated lazily at grade time so the batch kickoff is fast.
_MAX_EXPLANATION_CHARS = 600
_MAX_SEALED_QUESTION_CHARS = 600
_MAX_SEALED_OPTION_CHARS = 200


class QuizError(Exception):
    """Base class for quiz failures."""


class UnknownSubjectError(QuizError):
    """Raised when a requested subject id has no grounding asset."""


class QuizGenerationError(QuizError):
    """Raised when the model's output can't be parsed into a valid question."""


class QuizTokenError(QuizError):
    """Raised when an answer token is missing, malformed, or tampered with."""


def _load_subjects() -> Dict[str, dict]:
    catalog: Dict[str, dict] = {}
    if not _ASSET_DIR.is_dir():
        return catalog
    for path in sorted(_ASSET_DIR.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                asset = json.load(fh)
        except Exception:  # a malformed asset shouldn't take the whole app down
            logger.warning("Skipping unreadable subject asset: %s", path.name)
            continue
        subject_id = asset.get("id") or path.stem
        catalog[subject_id] = asset
    return catalog


_SUBJECTS: Dict[str, dict] = _load_subjects()


def list_subjects() -> List[dict]:
    """Public subject catalog for the picker (no grounding context leaked)."""
    out = []
    for asset in _SUBJECTS.values():
        out.append(
            {
                "id": asset["id"],
                "name_ar": asset.get("name_ar", asset["id"]),
                "name_en": asset.get("name_en", asset["id"]),
                "language": asset.get("language", "ar"),
            }
        )
    # Stable, friendly ordering for the UI.
    order = ["math", "physics", "chemistry", "biology", "earth_science", "english"]
    out.sort(key=lambda s: order.index(s["id"]) if s["id"] in order else 99)
    return out


def get_subject(subject_id: str) -> dict:
    asset = _SUBJECTS.get(subject_id)
    if asset is None:
        raise UnknownSubjectError(f"Unknown subject: {subject_id!r}")
    return asset


def normalize_difficulty(difficulty: Optional[str]) -> str:
    return difficulty if difficulty in DIFFICULTY_LABELS else DEFAULT_DIFFICULTY


def clamp_count(count: Optional[int]) -> int:
    try:
        value = int(count)
    except (TypeError, ValueError):
        return DEFAULT_QUESTIONS
    return max(MIN_QUESTIONS, min(MAX_QUESTIONS, value))


# --------------------------------------------------------------------------- #
# Answer sealing — stateless, tamper-evident scoring.
# --------------------------------------------------------------------------- #


def seal_answer(question: str, options: List[str], correct_index: int) -> str:
    """Seal a question's GRADING CONTEXT into an opaque, integrity-protected token.

    The token carries the question text, its options, and the correct index — but
    deliberately NO explanation (explanations are generated lazily at grade time
    so the quiz kickoff stays fast). The client echoes the token back on submit;
    the server verifies the HMAC, recovers the context it never stored, grades
    the choice, and only then generates teaching feedback. Tampering (to force a
    'correct' verdict) fails verification, so the score can't be forged. Signed,
    not encrypted — enough to prevent score forgery in a self-assessment quiz; it
    is not a secrecy guarantee against payload inspection.
    """
    raw = json.dumps(
        {
            "q": (question or "")[:_MAX_SEALED_QUESTION_CHARS],
            "o": [str(o)[:_MAX_SEALED_OPTION_CHARS] for o in (options or [])],
            "a": int(correct_index),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    mac = hmac.new(_SECRET, raw, hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(mac + raw).decode("ascii")


def _open_token(token: str) -> dict:
    try:
        blob = base64.urlsafe_b64decode(token.encode("ascii"))
    except Exception:
        raise QuizTokenError("Malformed answer token.")
    if len(blob) <= 16:
        raise QuizTokenError("Truncated answer token.")
    mac, raw = blob[:16], blob[16:]
    expected = hmac.new(_SECRET, raw, hashlib.sha256).digest()[:16]
    if not hmac.compare_digest(mac, expected):
        raise QuizTokenError("Answer token failed integrity check.")
    try:
        return json.loads(raw)
    except Exception:
        raise QuizTokenError("Answer token payload is not valid JSON.")


def evaluate_answer(token: str, selected_index: int) -> dict:
    """Unseal ``token`` and grade ``selected_index`` against it.

    Returns ``{correct, correct_index, question, options}`` — the question and
    options are recovered so grade-time feedback can be generated for them. The
    explanation is NO LONGER sealed (it is produced lazily at grade time).
    ``selected_index`` may be ``None``/out-of-range (a skipped question) → graded
    incorrect.
    """
    payload = _open_token(token)
    correct_index = int(payload.get("a", -1))
    question = payload.get("q") if isinstance(payload.get("q"), str) else ""
    options = payload.get("o") if isinstance(payload.get("o"), list) else []
    try:
        chosen = int(selected_index)
    except (TypeError, ValueError):
        chosen = -1
    return {
        "correct": chosen == correct_index,
        "correct_index": correct_index,
        "question": question,
        "options": options,
    }


def assess(score: int, total: int) -> dict:
    """Map a final score to the student-facing level (مبتدئ / متوسط / متقدم)."""
    ratio = (score / total) if total else 0.0
    if ratio >= 0.8:
        level = "متقدم"
    elif ratio >= 0.5:
        level = "متوسط"
    else:
        level = "مبتدئ"
    return {"level": level, "ratio": round(ratio, 2)}


# --------------------------------------------------------------------------- #
# Generation — one MCQ at a time, grounded + guardrailed.
# --------------------------------------------------------------------------- #

# Marker that opens every generation prompt. Kept stable so the offline test
# stub (tests/contract.py) can recognise a quiz request deterministically.
_GEN_MARKER = "Generate exactly ONE multiple-choice quiz question"


def build_generation_prompt(
    subject: dict, difficulty: str, asked: List[str]
) -> str:
    """Compose the user-turn prompt that asks the model for one MCQ as JSON.

    Scope is still governed by the unchanged ``SYSTEM_INSTRUCTION`` system turn;
    this prompt only pins the subject grounding, difficulty, anti-repetition
    list, output language, and the strict JSON contract.
    """
    language = subject.get("language", "ar")
    lang_word = "English" if language == "en" else "Arabic"
    label = DIFFICULTY_LABELS.get(difficulty, difficulty)
    context = (subject.get("context") or "").strip()

    avoid_block = ""
    recent = [q for q in (asked or []) if q][-MAX_QUESTIONS:]
    if recent:
        joined = "\n".join(f"- {q}" for q in recent)
        avoid_block = (
            "\nDo NOT repeat or paraphrase any of these already-asked "
            f"questions:\n{joined}\n"
        )

    return (
        f"{_GEN_MARKER} for a Saudi third-year secondary student.\n"
        f"Subject: {subject.get('name_en')} ({subject.get('name_ar')}).\n"
        f"Difficulty: {difficulty} ({label}).\n"
        f"Write the question, all four options, and the explanation in "
        f"{lang_word}.\n"
        "Requirements:\n"
        "- Exactly four answer options, with exactly ONE correct.\n"
        "- The options must be plausible and mutually exclusive.\n"
        "- Match the requested difficulty.\n"
        "- Base it on the curriculum grounding below; vary the topic.\n"
        f"{avoid_block}"
        "Return ONLY a raw JSON object (no markdown, no code fence, no extra "
        "text) with EXACTLY these keys:\n"
        '{"question": str, "options": [str, str, str, str], '
        '"correct_index": int (0-3), "explanation": str}\n\n'
        "Curriculum grounding (reference only — do not quote verbatim):\n"
        f"{context}"
    )


def _extract_json(text: str) -> dict:
    """Best-effort parse of a JSON object from the model's reply.

    Tolerates a ```json fence or stray prose around the object by isolating the
    outermost balanced ``{...}`` span before parsing.
    """
    cleaned = text.strip()
    # Strip a leading/trailing code fence if present.
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise QuizGenerationError("No JSON object found in the model response.")
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise QuizGenerationError(f"Model response was not valid JSON: {exc}")


def _validate_question(obj: dict) -> dict:
    if not isinstance(obj, dict):
        raise QuizGenerationError("Generated question is not an object.")
    question = obj.get("question")
    options = obj.get("options")
    correct_index = obj.get("correct_index")

    if not isinstance(question, str) or not question.strip():
        raise QuizGenerationError("Generated question text is empty.")
    if not isinstance(options, list) or len(options) != 4:
        raise QuizGenerationError("A question must have exactly four options.")
    options = [str(o).strip() for o in options]
    if not all(options):
        raise QuizGenerationError("All four options must be non-empty.")
    try:
        correct_index = int(correct_index)
    except (TypeError, ValueError):
        raise QuizGenerationError("correct_index must be an integer.")
    if not 0 <= correct_index <= 3:
        raise QuizGenerationError("correct_index must be between 0 and 3.")

    explanation = obj.get("explanation")
    explanation = explanation.strip() if isinstance(explanation, str) else ""

    return {
        "question": question.strip(),
        "options": options,
        "correct_index": correct_index,
        "explanation": explanation,
    }


def generate_question(
    complete: Callable[[str], str],
    subject_id: str,
    difficulty: str,
    asked: Optional[List[str]] = None,
) -> dict:
    """Generate and validate one MCQ for ``subject_id``.

    ``complete`` is any ``prompt -> text`` function — in the app it wraps
    ``DeepSeekMentor.get_answer`` (so SYSTEM_INSTRUCTION guardrails apply); in
    tests it is a stub. Returns the validated question dict
    (``question, options, correct_index, explanation``). Raises
    ``QuizGenerationError`` if the model output can't be parsed/validated and
    ``UnknownSubjectError`` for an unknown subject.
    """
    subject = get_subject(subject_id)
    difficulty = normalize_difficulty(difficulty)
    prompt = build_generation_prompt(subject, difficulty, asked or [])

    raw = complete(prompt)
    if not isinstance(raw, str) or not raw.strip():
        raise QuizGenerationError("The model returned an empty response.")

    return _validate_question(_extract_json(raw))


def make_question_payload(question: dict, number: int, total: int, subject: dict) -> dict:
    """Shape a generated question for the client: the prompt + options + a sealed
    answer token. The token carries ONLY the grading context (question, options,
    correct index) — never the plaintext correct answer. The explanation and the
    "نقاط التطوير" topic are produced lazily at grade time (``generate_feedback``)
    so the batch kickoff stays fast.
    """
    return {
        "number": number,
        "total": total,
        "subject": subject["id"],
        "language": subject.get("language", "ar"),
        "question": question["question"],
        "options": question["options"],
        "token": seal_answer(
            question["question"], question["options"], question["correct_index"]
        ),
    }


# --------------------------------------------------------------------------- #
# Bulk generation — the whole quiz in ONE model call (zero-latency transitions).
#
# Instead of one model round-trip per question, the start endpoint asks DeepSeek
# for the entire quiz as a single minified JSON array. The client then advances
# instantly between pre-fetched, pre-sealed questions; only stateless grading
# (no model call) happens per answer. Scope is still governed by the unchanged
# SYSTEM_INSTRUCTION, because generation routes through DeepSeekMentor exactly
# like the single-question path.
# --------------------------------------------------------------------------- #

# Marker that opens every BULK prompt. Distinct from _GEN_MARKER (and not a
# substring of it, nor vice-versa) so the offline stub can tell the two apart.
_BULK_GEN_MARKER = "Generate a numbered batch of multiple-choice quiz questions"


def build_bulk_generation_prompt(subject: dict, difficulty: str, count: int) -> str:
    """Compose the user-turn prompt asking for ``count`` MCQs as ONE minified
    JSON array. The payload is deliberately LIGHT — only question/options/answer,
    NO explanations or topics — so a 20-question quiz initializes fast (the heavy
    teaching text is generated lazily at grade time). The model is pushed hard
    toward a single-line, fence-free array so parsing is trivial."""
    language = subject.get("language", "ar")
    lang_word = "English" if language == "en" else "Arabic"
    label = DIFFICULTY_LABELS.get(difficulty, difficulty)
    context = (subject.get("context") or "").strip()
    count = clamp_count(count)

    return (
        f"{_BULK_GEN_MARKER} for a Saudi third-year secondary student.\n"
        f"Subject: {subject.get('name_en')} ({subject.get('name_ar')}).\n"
        f"Difficulty: {difficulty} ({label}).\n"
        f"Produce a single minified JSON array containing EXACTLY {count} objects.\n"
        f"Write every question and option in {lang_word}.\n"
        "Requirements for EACH object:\n"
        '- Keys EXACTLY and ONLY: "question" (str), "options" (array of 4 '
        'distinct strings), "correct_index" (int 0-3).\n'
        "- Do NOT include explanations, reasoning, hints, topics, difficulty, or "
        "ANY other key — they are produced later and would only slow this step "
        "down. Brevity here is the whole point.\n"
        "- Exactly four options, exactly ONE correct, plausible and mutually "
        "exclusive.\n"
        "- Every question must be DISTINCT — a different topic/subtopic, never a "
        "paraphrase of another.\n"
        "- Match the requested difficulty; keep questions and options short.\n"
        "- Vary the position of the correct answer across the batch.\n"
        "- Base them on the curriculum grounding below; vary the topics widely.\n"
        "OUTPUT FORMAT (critical): return ONLY the raw minified JSON array on a "
        "single line — no markdown, no code fence, no commentary, no trailing "
        "text, and no newlines or padding spaces between objects. Start the reply "
        "with '[' and end it with ']'.\n\n"
        "Curriculum grounding (reference only — do not quote verbatim):\n"
        f"{context}"
    )


def _extract_json_array(text: str) -> list:
    """Best-effort parse of a JSON array from the model's reply.

    Tolerates a ```json fence or stray prose by isolating the outermost balanced
    ``[...]`` span before parsing — the array analogue of ``_extract_json``.
    """
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()

    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise QuizGenerationError("No JSON array found in the model response.")
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise QuizGenerationError(f"Model batch was not valid JSON: {exc}")
    if not isinstance(data, list):
        raise QuizGenerationError("Model batch is not a JSON array.")
    return data


def _validate_batch_item(obj: dict) -> dict:
    """Validate one batch item into the LIGHTWEIGHT schema (question, options,
    correct_index). Explanations and topics are intentionally NOT part of the
    batch — they are produced lazily at grade time — so this just delegates to the
    strict single-question validator (whose ``explanation`` defaults to empty)."""
    return _validate_question(obj)


def generate_quiz_batch(
    complete: Callable[[str], str],
    subject_id: str,
    difficulty: str,
    count: int,
) -> List[dict]:
    """Generate and validate a whole quiz (``count`` MCQs) in ONE model call.

    ``complete`` is the same ``prompt -> text`` bridge used by the single-question
    path (so SYSTEM_INSTRUCTION guardrails apply). Returns a list of validated,
    LIGHTWEIGHT question dicts (``question, options, correct_index`` — no
    explanation/topic, which are generated at grade time). A single malformed item
    is skipped rather than failing the whole batch; near-duplicate questions are
    de-duplicated. Raises ``QuizGenerationError`` only if NOTHING usable came
    back, and ``UnknownSubjectError`` for a bad subject.
    """
    subject = get_subject(subject_id)
    difficulty = normalize_difficulty(difficulty)
    count = clamp_count(count)
    prompt = build_bulk_generation_prompt(subject, difficulty, count)

    raw = complete(prompt)
    if not isinstance(raw, str) or not raw.strip():
        raise QuizGenerationError("The model returned an empty batch.")

    items = _extract_json_array(raw)

    questions: List[dict] = []
    seen: set = set()
    for item in items:
        try:
            question = _validate_batch_item(item)
        except QuizGenerationError:
            continue  # tolerate one bad item; keep the rest of the batch
        key = _normalize_text(question["question"])
        if key and key in seen:
            continue  # drop a duplicate/paraphrase the model slipped in
        seen.add(key)
        questions.append(question)
        if len(questions) >= count:
            break

    if not questions:
        raise QuizGenerationError("No valid questions in the model batch.")
    return questions


# --------------------------------------------------------------------------- #
# Lazy feedback — explanation + insight generated at GRADE time, not at kickoff.
#
# The batch ships WITHOUT explanations so a 20-question quiz initializes fast.
# When the student submits an answer, the grade endpoint asks the model for a
# single-sentence explanation plus a short concept label (the "نقاط التطوير"
# topic) for just that ONE question — small, quick, and overlapped with the
# student reading the reveal. Best-effort: a model failure degrades to no
# explanation and NEVER blocks grading.
# --------------------------------------------------------------------------- #

_FEEDBACK_MARKER = "Give brief feedback for ONE answered multiple-choice question"
_ARABIC_CHAR_RE = re.compile(r"[؀-ۿ]")


def _feedback_language(question: str, options: List[str]) -> str:
    blob = (question or "") + " " + " ".join(str(o) for o in (options or []))
    return "ar" if _ARABIC_CHAR_RE.search(blob) else "en"


def build_feedback_prompt(
    question: str, options: List[str], correct_index: int, selected_index
) -> str:
    """Compose the user-turn prompt asking for ONE question's explanation + topic
    as a tiny JSON object. Scope is still governed by SYSTEM_INSTRUCTION."""
    lang_word = "English" if _feedback_language(question, options) == "en" else "Arabic"
    try:
        correct_text = options[int(correct_index)]
    except (IndexError, TypeError, ValueError):
        correct_text = ""
    try:
        chosen_text = options[int(selected_index)]
    except (IndexError, TypeError, ValueError):
        chosen_text = "(no answer given)"

    return (
        f"{_FEEDBACK_MARKER}.\n"
        f"Question: {question}\n"
        f"Options: {options}\n"
        f"Correct answer: {correct_text}\n"
        f"Student's answer: {chosen_text}\n"
        f"Write in {lang_word}. Return ONLY a raw minified JSON object with "
        'EXACTLY these keys: {"explanation": one short sentence on why the '
        "correct answer is right (and, if the student was wrong, gently why their "
        'choice is not), "topic": a 2-4 word concept label naming what to '
        "review}.\nNo markdown, no code fence, no extra text."
    )


def generate_feedback(
    complete: Callable[[str], str],
    question: str,
    options: List[str],
    correct_index: int,
    selected_index,
) -> dict:
    """Generate ``{explanation, topic}`` for one graded question — best-effort.

    Any failure (empty context, model/network error, unparseable JSON) degrades
    to empty feedback so grading is never blocked. Routed through ``complete``
    (the guardrailed mentor) exactly like generation.
    """
    if not question or not options:
        return {"explanation": "", "topic": ""}
    try:
        prompt = build_feedback_prompt(question, options, correct_index, selected_index)
        obj = _extract_json(complete(prompt))
    except Exception:  # model/network/parse failure — degrade gracefully
        return {"explanation": "", "topic": ""}

    explanation = obj.get("explanation") if isinstance(obj, dict) else ""
    topic = obj.get("topic") if isinstance(obj, dict) else ""
    return {
        "explanation": (
            explanation.strip()[:_MAX_EXPLANATION_CHARS]
            if isinstance(explanation, str)
            else ""
        ),
        "topic": topic.strip()[:60] if isinstance(topic, str) else "",
    }


# --------------------------------------------------------------------------- #
# Voice answer matching — map a spoken transcript to one of the four options.
#
# Fully local and deterministic (no model call): a student can say the option
# letter ("ألف", "خيار ب"), an ordinal/number ("الإجابة الثالثة", "first"),
# true/false, or simply read a choice aloud, and we resolve it to an index. Pure
# stdlib so it is instant — the hands-free flow never waits on the network.
# --------------------------------------------------------------------------- #

# Arabic combining marks + tatweel, stripped before matching so a transcript
# with or without diacritics compares equal.
_ARABIC_MARKS_RE = re.compile(
    "[ؐ-ًؚ-ٰٟۖ-ۭـ]"
)
# Fold Arabic letter variants that speech-to-text renders inconsistently.
_ARABIC_FOLD = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ئ": "ي", "ؤ": "و", "ة": "ه"}
)
# Arabic-Indic and extended (Persian) digits → ASCII, so "١" and "۱" match "1".
_DIGIT_FOLD = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def _normalize_text(text: str) -> str:
    """NFKC-fold a string for fuzzy matching: unify Arabic letter/digit variants,
    drop diacritics and punctuation, lowercase Latin, and collapse whitespace."""
    if not isinstance(text, str):
        return ""
    out = unicodedata.normalize("NFKC", text)
    out = out.translate(_DIGIT_FOLD)
    out = _ARABIC_MARKS_RE.sub("", out)
    out = out.translate(_ARABIC_FOLD)
    out = out.lower()
    out = re.sub(r"[^\w\s]", " ", out, flags=re.UNICODE)
    out = re.sub(r"\s+", " ", out).strip()
    return out


# Spoken letter / ordinal / number words → 0-based option index. Keys are stored
# already normalized (so "ألف" is looked up as "الف", "الأولى" as "الاولى").
_SPOKEN_INDEX = {
    # Arabic letter names (أ ب ج د).
    "ا": 0, "الف": 0, "همزه": 0,
    "ب": 1, "باء": 1, "با": 1,
    "ج": 2, "جيم": 2,
    "د": 3, "دال": 3,
    # Arabic ordinals.
    "الاول": 0, "اول": 0, "الاولى": 0, "اولى": 0,
    "الثاني": 1, "ثاني": 1, "الثانيه": 1, "ثانيه": 1,
    "الثالث": 2, "ثالث": 2, "الثالثه": 2, "ثالثه": 2,
    "الرابع": 3, "رابع": 3, "الرابعه": 3, "رابعه": 3,
    # Arabic cardinals.
    "واحد": 0, "اثنان": 1, "اثنين": 1, "ثلاثه": 2, "ثلاث": 2, "اربعه": 3, "اربع": 3,
    # Latin letters and how STT often spells them out.
    "a": 0, "ay": 0, "eh": 0,
    "b": 1, "bee": 1, "be": 1,
    "c": 2, "cee": 2, "see": 2, "sea": 2,
    "d": 3, "dee": 3,
    # English ordinals / numbers / digits.
    "first": 0, "one": 0, "1": 0,
    "second": 1, "two": 1, "2": 1,
    "third": 2, "three": 2, "3": 2,
    "fourth": 3, "four": 3, "4": 3,
    # Arabic ordinal adverbs ("أولاً", "ثانياً", ...).
    "اولا": 0, "ثانيا": 1, "ثالثا": 2, "رابعا": 3,
    # STT phonetic variants for LONE letters. Speech engines mangle a single
    # spoken Arabic letter, so also accept how they commonly hand it back — the
    # spelled-out names (already above) plus the English letter sounds students
    # use ("بي/سي/دي") and "ألفا". Unambiguous enough for the short-utterance
    # tier; the exact/qualifier tiers still take precedence.
    "بي": 1, "سي": 2, "دي": 3, "الفا": 0, "بيتا": 1,
}

# Words that explicitly introduce a choice reference ("الخيار ب", "فقرة ألف",
# "جواب ج", "option C"). A qualifier lets us pull the letter/number out of a long
# conversational sentence with confidence.
_CHOICE_QUALIFIERS = {
    "خيار", "الخيار", "اختيار", "الاختيار", "حرف", "الحرف", "اجابه", "الاجابه",
    "اجابة", "رقم", "الرقم", "البديل", "بديل",
    "فقره", "الفقره", "جواب", "الجواب", "بند", "البند", "العباره", "عباره",
    "option", "letter", "choice", "answer", "number", "paragraph",
}


# Authored Arabic variants may carry alef-maksura / taa-marbuta / hamza forms
# (e.g. "الأولى", "إجابة"). Re-key these lookups through the SAME normalizer that
# is applied to transcripts, so they still match after folding (أإآ→ا, ى→ي,
# ة→ه). Idempotent for entries already in normal form — and it removes
# unreachable dead keys (a transcript is never compared against an un-normalized
# key).
_SPOKEN_INDEX = {_normalize_text(k): v for k, v in _SPOKEN_INDEX.items()}
_CHOICE_QUALIFIERS = {_normalize_text(w) for w in _CHOICE_QUALIFIERS}


def _spoken_index_for(token: str):
    """Map one normalized token to a 0-based index, tolerating the Arabic
    definite article ("الدال" → "دال" → 3, "الثالثة" → "ثالث" → 2). Returns
    ``None`` when the token is not a recognised letter/ordinal/number word."""
    if token in _SPOKEN_INDEX:
        return _SPOKEN_INDEX[token]
    if token.startswith("ال") and len(token) > 3:
        return _SPOKEN_INDEX.get(token[2:])
    return None


def _word_overlap(a: str, b: str) -> float:
    """Jaccard similarity of the word sets of two normalized strings (0..1)."""
    sa, sb = set(a.split()), set(b.split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


# --------------------------------------------------------------------------- #
# Conversational stripping — pull the answer out of everyday Saudi phrasing.
#
# Students rarely say a bare letter; they say "امممم اتوقع الجواب الصحيح هو فقرة
# الف" or "اشوف ان الخيار الثاني صح". These markers are answer-NEUTRAL padding —
# hesitations, opinion framing ("I think/maybe"), copulas and connectors — that
# we drop before keyword matching so the semantic core ("فقرة الف" → 0,
# "الخيار الثاني" → 1) survives. Stored already-normalized (no diacritics,
# أإآ→ا, ة→ه, lowercased) to match _normalize_text's output.
#
# Curated to NEVER collide with an answer word: no letter names, ordinals,
# numbers, true/false words, or option fragments (e.g. "ربما"/"لا أعرف" stay).
# The full read-aloud tiers still run on the UN-stripped text, so an option that
# happens to contain a padding word is unaffected.
# --------------------------------------------------------------------------- #
_FILLER_WORDS = {
    # Hesitations / discourse markers (elongations like "اممم" fold in via
    # _deelongate; all-identical runs like "ممم" are dropped separately).
    "ام", "امم", "اه", "اها", "ايه", "هم", "همم", "مم", "ها", "يا",
    "يعني", "طيب", "اوكي", "اوك", "تمام", "حسنا", "خلاص", "ماشي", "زين",
    # Opinion / stance framing — "I think", "I guess", "maybe", "I see that".
    "اتوقع", "اعتقد", "اظن", "اضن", "اشوف", "ارى", "احس", "افكر", "بظن", "بقول",
    "يمكن", "ممكن", "لعل", "اكيد", "بالتاكيد", "صراحه", "بصراحه", "عموما", "المهم",
    "والله", "لله", "خلينا", "خلني", "خليني", "نقول", "اقول", "قول", "ابغى", "ابي",
    # Copulas / connectors / particles (answer-neutral).
    "هو", "هي", "هذا", "هذه", "هاي", "ذلك", "ان", "انه", "اني", "هنا", "هناك",
    "قد", "لقد", "يكون", "تكون", "راح", "رح",
    # English fillers.
    "um", "umm", "uh", "uhh", "er", "like", "well", "so", "ok", "okay", "maybe",
    "guess", "i", "im", "the", "is", "its", "it", "my", "think", "that",
    "answer", "gonna", "go", "with",
}


def _deelongate(token: str) -> str:
    """Collapse a run of 3+ identical characters to one, so elongated fillers
    ("اممممم" → "ام", "uhhh" → "uh") match the curated filler set."""
    return re.sub(r"(.)\1{2,}", r"\1", token)


def _strip_fillers(norm: str) -> str:
    """Drop answer-neutral padding tokens from an already-normalized string,
    leaving the semantic core. Returns the input unchanged if stripping would
    leave nothing (a pure-filler utterance still flows through the read tiers)."""
    if not norm:
        return ""
    kept = []
    for tok in norm.split():
        if tok in _FILLER_WORDS or _deelongate(tok) in _FILLER_WORDS:
            continue
        # An all-identical run ("ممم", "اااا") is mic noise, never an answer.
        if len(tok) >= 3 and len(set(tok)) == 1:
            continue
        kept.append(tok)
    stripped = " ".join(kept)
    return stripped if stripped else norm


# True/false answer vocabulary — only consulted when the OPTIONS themselves are a
# true/false set, so "صح" at the tail of a normal MCQ sentence never hijacks it.
_TRUE_WORDS = {"صح", "صحيح", "صحيحه", "true", "correct", "yes", "نعم", "ايوه", "اجل"}
_FALSE_WORDS = {"خطا", "غلط", "غالط", "خطأ", "false", "wrong", "incorrect", "no"}
_FALSE_PREFIXES = ("خاط",)  # خاطئ / خاطئة / خاطي(ه)
_NEGATIONS = {"مو", "مب", "مش", "ليس", "مهو", "ماهو", "not"}
# An option counts as "true"/"false" when its normalized text is one of these.
_TRUE_OPTION = {"صح", "صحيح", "صحيحه", "true", "yes", "correct", "نعم"}
_FALSE_OPTION = {"خطا", "خطأ", "غلط", "false", "no", "wrong", "خاطئه", "خاطيه"}


def _tf_option_indices(norm_options: List[str]):
    """Return ``(true_index, false_index)`` if ``norm_options`` looks like a
    true/false set, else ``(None, None)`` — which disables TF matching entirely
    for ordinary multiple-choice questions."""
    true_idx = false_idx = None
    for i, opt in enumerate(norm_options):
        if opt in _TRUE_OPTION and true_idx is None:
            true_idx = i
        if opt in _FALSE_OPTION and false_idx is None:
            false_idx = i
    return true_idx, false_idx


def _match_true_false(tokens: List[str], norm_options: List[str]):
    """Resolve a true/false intent ("صحيح", "خطأ", "خاطئة", "غلط", "مو صح") to the
    matching option index — but only for a genuine true/false option set. Handles
    negated truth ("مو صح" → false). Returns ``None`` when not applicable."""
    true_idx, false_idx = _tf_option_indices(norm_options)
    if true_idx is None and false_idx is None:
        return None
    has_neg = any(t in _NEGATIONS for t in tokens)
    saw_true = saw_false = False
    for t in tokens:
        bare = t[2:] if (t.startswith("ال") and len(t) > 3) else t
        if bare in _FALSE_WORDS or bare.startswith(_FALSE_PREFIXES):
            saw_false = True
        elif bare in _TRUE_WORDS:
            saw_true = True
    if saw_false and false_idx is not None:
        return false_idx
    if saw_true:
        # "مو صح" / "مش صحيح" — negated truth is a false answer.
        if has_neg and false_idx is not None:
            return false_idx
        if true_idx is not None:
            return true_idx
    return None


# Positional references that depend on the option count ("آخر واحدة" → last).
# "first"/"الأولى" are already covered by the ordinal map in _SPOKEN_INDEX.
_LAST_WORDS = {"اخر", "الاخير", "الاخيره", "اخيره", "اخير", "last"}
_UNIT_WORDS = {
    "وحده", "وحده", "واحده", "خيار", "الخيار", "اجابه", "الاجابه", "فقره",
    "الفقره", "بند", "البند", "one", "option", "answer", "choice",
}


def _resolve_positional(tokens: List[str], n: int):
    """Map a positional phrase to an index. "آخر وحدة"/"الأخيرة"/"last" → the last
    option (``n-1``). Gated on a unit word or a short utterance so a stray "آخر"
    inside a long read-aloud can't trigger it. Returns ``None`` when N/A."""
    if not any(t in _LAST_WORDS for t in tokens):
        return None
    if any(t in _UNIT_WORDS for t in tokens) or len(tokens) <= 3:
        return n - 1
    return None


# Index tokens that are AMBIGUOUS out of context — a bare letter that doubles as
# an article ("a"), a colloquial word ("دي" = "this"), or a cardinal that may be
# a quantity. They resolve fine in a SHORT utterance, but inside a long sentence
# we require a STRONGER signal (a spelled-out letter name or ordinal) before
# committing, since the voice path auto-submits.
_WEAK_INDEX_TOKENS = {
    "a", "b", "c", "d",
    "ا", "ب", "ج", "د",
    "be", "bee", "cee", "see", "sea", "dee", "ay", "eh",
    "بي", "سي", "دي",
    "واحد", "اثنان", "اثنين", "ثلاثه", "ثلاث", "اربعه", "اربع",
    "one", "two", "three", "four",
    "1", "2", "3", "4",
}


# Normalize every vocabulary set through the transcript normalizer (as with
# _SPOKEN_INDEX above) so authored ة/أ/ى spellings match and no member is dead.
_WEAK_INDEX_TOKENS = {_normalize_text(w) for w in _WEAK_INDEX_TOKENS}
_FILLER_WORDS = {_normalize_text(w) for w in _FILLER_WORDS}
_TRUE_WORDS = {_normalize_text(w) for w in _TRUE_WORDS}
_FALSE_WORDS = {_normalize_text(w) for w in _FALSE_WORDS}
_TRUE_OPTION = {_normalize_text(w) for w in _TRUE_OPTION}
_FALSE_OPTION = {_normalize_text(w) for w in _FALSE_OPTION}
_NEGATIONS = {_normalize_text(w) for w in _NEGATIONS}
_LAST_WORDS = {_normalize_text(w) for w in _LAST_WORDS}
_UNIT_WORDS = {_normalize_text(w) for w in _UNIT_WORDS}


def match_spoken_answer(
    transcript: str, options: List[str], language: str = "ar"
) -> dict:
    """Resolve a spoken ``transcript`` to one of ``options`` → ``{index,
    transcript, matched_via}``. ``index`` is ``-1`` when nothing matches
    confidently (the caller then asks the student to repeat). Never raises.

    The transcript may be a full conversational sentence ("امممم اتوقع الجواب
    الصحيح هو فقرة الف"): filler/padding is stripped first, then the semantic
    core is resolved. Tiers, most-confident first:
      1. exact text — the utterance equals an option (reading a choice aloud);
      2. qualifier + symbol — "فقرة ألف", "الخيار ب", "option C", "رقم واحد";
      3. positional — "آخر واحدة"/"last" → the last option;
      4. keyword — the stripped core is a letter/ordinal/number word;
      5. true/false — "صح"/"خطأ"/"خاطئة"/"غلط"/"مو صح" for a T/F option set;
      6. containment — the utterance is wholly inside exactly one option;
      7. overlap — a clear single best word-overlap above threshold.
    """
    result = {"index": -1, "transcript": (transcript or "").strip(), "matched_via": "none"}
    norm = _normalize_text(transcript)
    if not norm or not options:
        return result

    n = len(options)
    norm_options = [_normalize_text(o) for o in options]
    # Token tiers run on the filler-stripped CORE; the full read tiers (exact,
    # containment, overlap) run on the un-stripped text so a read-aloud option is
    # never corrupted by stripping.
    core = _strip_fillers(norm)
    tokens = core.split()

    def _accept(idx: int, via: str) -> dict:
        result["index"] = idx
        result["matched_via"] = via
        return result

    # 1) Exact read of a choice (highest confidence, beats a stray "a"/"ا").
    exact = [i for i, opt in enumerate(norm_options) if opt and opt == norm]
    if len(exact) == 1:
        return _accept(exact[0], "exact")

    # 2) Explicit qualifier + a letter/ordinal/number token anywhere in the core
    #    ("فقرة ألف", "حرف الف", "جواب ج", "رقم واحد", "الخيار الثاني").
    if any(tok in _CHOICE_QUALIFIERS for tok in tokens):
        for tok in tokens:
            idx = _spoken_index_for(tok)
            if idx is not None and 0 <= idx < n:
                return _accept(idx, "qualifier")

    # 3) Positional reference ("آخر واحدة"/"الأخيرة"/"last" → last option).
    pos = _resolve_positional(tokens, n)
    if pos is not None:
        return _accept(pos, "position")

    # 4) The stripped core contains a letter/ordinal/number word. A short core
    #    (≤2 tokens) trusts even a bare letter; a longer core requires a single
    #    UNAMBIGUOUS strong signal (a spelled-out name/ordinal, not a bare "a"/
    #    "1") so a buried token in a qualifier-less ramble can't false-match.
    idx_hits = []
    for tok in tokens:
        idx = _spoken_index_for(tok)
        if idx is not None and 0 <= idx < n:
            idx_hits.append((tok, idx))
    if idx_hits:
        if len(tokens) <= 2:
            distinct = {idx for _, idx in idx_hits}
            if len(distinct) == 1:
                return _accept(next(iter(distinct)), "keyword")
        else:
            strong = {idx for tok, idx in idx_hits if tok not in _WEAK_INDEX_TOKENS}
            if len(strong) == 1:
                return _accept(next(iter(strong)), "keyword")

    # 5) True/false intent — only for a genuine T/F option set (handles "مو صح").
    tf = _match_true_false(tokens, norm_options)
    if tf is not None and 0 <= tf < n:
        return _accept(tf, "true_false")

    # 6) The utterance sits wholly inside exactly one option (a partial read).
    contained = [
        i for i, opt in enumerate(norm_options) if opt and (norm in opt or opt in norm)
    ]
    if len(contained) == 1:
        return _accept(contained[0], "contains")

    # 7) Best word-overlap, but only if there is a single clear winner.
    scores = [_word_overlap(norm, opt) for opt in norm_options]
    best = max(scores)
    if best >= 0.5 and scores.count(best) == 1:
        return _accept(scores.index(best), "overlap")

    return result


def match_spoken_answer_multi(
    transcripts: List[str], options: List[str], language: str = "ar"
) -> dict:
    """Resolve a spoken answer from SEVERAL candidate transcripts — the primary
    (full continuous utterance) plus an STT engine's N-best alternatives — and
    return the FIRST confident match, else the primary candidate's no-match
    result.

    Each candidate may be a full conversational sentence; ``match_spoken_answer``
    strips its filler/padding and resolves the semantic core, so "اشوف ان الخيار
    الثاني صح" maps straight to its choice. Trying every alternative also recovers
    cases where the engine mis-ranks a lone spoken letter ("أ") at the top while
    a clearer phrasing sits one rank down — no extra round-trips. Order is
    preserved so the best-ranked confident hit wins.
    """
    first: Optional[dict] = None
    for transcript in transcripts or []:
        match = match_spoken_answer(transcript, options, language)
        if first is None:
            first = match
        if match["index"] >= 0:
            return match
    return first or {"index": -1, "transcript": "", "matched_via": "none"}
