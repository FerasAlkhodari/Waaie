"""Contract tests for the Interactive Question Generator (صانع الأسئلة التفاعلي).

Fully offline and deterministic: the DeepSeek client is the guardrail-aware
``FakeClient`` (see conftest), which returns a fixed, valid MCQ JSON whenever it
sees the quiz-generation marker. These tests pin:

  * the per-subject grounding assets load with the required schema,
  * generation parses/validates the model output into the question schema,
  * answers are sealed statelessly and graded (with tamper rejection),
  * the start → answer-loop → final-score+assessment flow holds zero server
    state (every bit of progress round-trips in the payload), and
  * the academic guardrails in model.SYSTEM_INSTRUCTION are untouched.
"""

import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import quiz
from app import app
from model import SYSTEM_INSTRUCTION
from tests.contract import QUIZ_BULK_MARKER, QUIZ_CORRECT_INDEX, QUIZ_GEN_MARKER

client = TestClient(app)

ASSET_DIR = Path(__file__).resolve().parent.parent / "data" / "exam_banks"
EXPECTED_SUBJECTS = {
    "math", "physics", "chemistry", "biology", "earth_science", "english",
}

# Same digest pinned in test_pdf_structure (Tier 5). Re-asserted here so the
# quiz work is independently shown not to have mutated the guardrails.
_SYSTEM_INSTRUCTION_SHA256 = (
    "01a9795e073d6b8aebbc067d82f4733aeb2c2ea2abbea6476e4997e98018659f"
)


# --------------------------------------------------------------------------- #
# Assets — grounding context files load with the required schema.
# --------------------------------------------------------------------------- #


def test_all_six_subject_assets_exist_with_schema():
    files = {p.stem for p in ASSET_DIR.glob("*.json")}
    assert EXPECTED_SUBJECTS <= files

    for subject_id in EXPECTED_SUBJECTS:
        asset = json.loads((ASSET_DIR / f"{subject_id}.json").read_text("utf-8"))
        assert asset["id"] == subject_id
        assert asset["name_ar"] and asset["name_en"]
        assert asset["language"] in ("ar", "en")
        assert asset["source"] in ("exam", "curriculum")
        assert isinstance(asset["context"], str) and asset["context"].strip()


def test_exam_backed_subjects_are_grounded_in_real_exam_text():
    # Physics/Math/English were extracted from the real .docx exams.
    for subject_id in ("physics", "math", "english"):
        asset = json.loads((ASSET_DIR / f"{subject_id}.json").read_text("utf-8"))
        assert asset["source"] == "exam"
        assert asset["source_file"]


def test_curriculum_subjects_carry_topic_outlines():
    for subject_id in ("biology", "earth_science", "chemistry"):
        asset = json.loads((ASSET_DIR / f"{subject_id}.json").read_text("utf-8"))
        assert asset["source"] == "curriculum"
        assert len(asset["topics"]) >= 5


def test_list_subjects_orders_and_hides_context():
    subjects = quiz.list_subjects()
    assert [s["id"] for s in subjects][0] == "math"  # stable friendly order
    assert {s["id"] for s in subjects} == EXPECTED_SUBJECTS
    for s in subjects:
        assert set(s) == {"id", "name_ar", "name_en", "language"}  # no context leak


# --------------------------------------------------------------------------- #
# Generation — model output → validated question schema.
# --------------------------------------------------------------------------- #


def test_generate_question_returns_valid_schema():
    q = quiz.generate_question(lambda p: _MCQ_JSON, "physics", "easy", [])
    assert set(q) == {"question", "options", "correct_index", "explanation"}
    assert len(q["options"]) == 4
    assert 0 <= q["correct_index"] <= 3


def test_generation_prompt_carries_marker_subject_and_difficulty():
    subject = quiz.get_subject("physics")
    prompt = quiz.build_generation_prompt(subject, "hard", ["old q1", "old q2"])
    assert QUIZ_GEN_MARKER in prompt
    assert "Physics" in prompt
    assert "hard" in prompt
    assert "old q1" in prompt  # anti-repetition list is included


@pytest.mark.parametrize(
    "raw",
    [
        _MCQ := (
            '{"question":"Q?","options":["a","b","c","d"],'
            '"correct_index":1,"explanation":"because"}'
        ),
        "```json\n" + _MCQ + "\n```",                 # fenced
        "Sure! Here is your question:\n" + _MCQ,        # prose preamble
    ],
)
def test_generation_tolerates_fences_and_prose(raw):
    q = quiz.generate_question(lambda p: raw, "math", "medium", [])
    assert q["question"] == "Q?"
    assert q["correct_index"] == 1


@pytest.mark.parametrize(
    "raw",
    [
        '{"question":"Q","options":["a","b","c"],"correct_index":0}',  # 3 options
        '{"question":"","options":["a","b","c","d"],"correct_index":0}',  # empty q
        '{"question":"Q","options":["a","b","c","d"],"correct_index":9}',  # oob
        "not json at all",
        "",
    ],
)
def test_generation_rejects_malformed_output(raw):
    with pytest.raises(quiz.QuizGenerationError):
        quiz.generate_question(lambda p: raw, "math", "medium", [])


def test_generate_unknown_subject_raises():
    with pytest.raises(quiz.UnknownSubjectError):
        quiz.generate_question(lambda p: _MCQ_JSON, "astrology", "easy", [])


# --------------------------------------------------------------------------- #
# Sealed-answer tokens — stateless, tamper-evident grading.
# --------------------------------------------------------------------------- #


def test_seal_and_evaluate_roundtrip():
    # The token now seals the GRADING CONTEXT (question + options + index), not an
    # explanation — explanations are generated lazily at grade time.
    token = quiz.seal_answer("What is 2+2?", ["3", "4", "5", "6"], 1)
    correct = quiz.evaluate_answer(token, 1)
    assert correct["correct"] is True
    assert correct["correct_index"] == 1
    assert correct["question"] == "What is 2+2?"
    assert correct["options"] == ["3", "4", "5", "6"]
    assert "explanation" not in correct  # no longer sealed

    wrong = quiz.evaluate_answer(token, 0)
    assert wrong["correct"] is False
    assert wrong["correct_index"] == 1  # still revealed for teaching


def test_token_does_not_expose_answer_in_clear_label():
    # The plaintext correct index is not a bare substring of the opaque token.
    token = quiz.seal_answer("Q?", ["a", "b", "c", "d"], 3)
    assert token != "3"
    assert "correct_index" not in token


@pytest.mark.parametrize("bad", ["", "garbage", "a.b.c", "!!!notbase64!!!"])
def test_tampered_or_malformed_token_rejected(bad):
    with pytest.raises(quiz.QuizTokenError):
        quiz.evaluate_answer(bad, 0)


def test_flipped_token_fails_integrity():
    token = quiz.seal_answer("Q?", ["a", "b", "c", "d"], 1)
    flipped = ("A" if token[-1] != "A" else "B") + token[1:]  # mutate one char
    with pytest.raises(quiz.QuizTokenError):
        quiz.evaluate_answer(flipped, 1)


# --------------------------------------------------------------------------- #
# Assessment thresholds (مبتدئ / متوسط / متقدم).
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "score,total,level",
    [
        (10, 10, "متقدم"),
        (8, 10, "متقدم"),
        (7, 10, "متوسط"),
        (5, 10, "متوسط"),
        (4, 10, "مبتدئ"),
        (0, 10, "مبتدئ"),
        (0, 0, "مبتدئ"),  # no division-by-zero
    ],
)
def test_assessment_levels(score, total, level):
    assert quiz.assess(score, total)["level"] == level


# --------------------------------------------------------------------------- #
# HTTP contract — /quiz/subjects, /quiz/question (generate), /quiz/answer (grade).
# --------------------------------------------------------------------------- #


def test_normalize_difficulty_and_clamp_count():
    assert quiz.normalize_difficulty("banana") == "medium"
    assert quiz.normalize_difficulty("hard") == "hard"
    assert quiz.clamp_count(0) == quiz.MIN_QUESTIONS
    assert quiz.clamp_count(999) == quiz.MAX_QUESTIONS
    assert quiz.clamp_count(10) == 10
    assert quiz.clamp_count("x") == quiz.DEFAULT_QUESTIONS


def test_subjects_endpoint():
    r = client.get("/quiz/subjects")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert {s["id"] for s in body["subjects"]} == EXPECTED_SUBJECTS


def _question(subject="physics", difficulty="medium", total=3, number=1, asked=None):
    return client.post(
        "/quiz/question",
        json={"subject": subject, "difficulty": difficulty, "total": total,
              "number": number, "asked": asked or []},
    )


def test_question_endpoint_returns_mcq_without_leaking_answer():
    r = _question(subject="physics", difficulty="easy", total=5, number=1)
    assert r.status_code == 200
    q = r.json()["question"]

    assert q["number"] == 1 and q["total"] == 5
    assert q["subject"] == "physics"
    assert len(q["options"]) == 4
    assert q["token"]
    # The correct answer / explanation never reach the client at question time.
    assert "correct_index" not in q
    assert "explanation" not in q


def test_question_passes_asked_list_for_anti_repetition():
    # The endpoint accepts and forwards the already-asked list (no crash).
    r = _question(total=3, number=2, asked=["prior question one", "prior question two"])
    assert r.status_code == 200


def test_question_unknown_subject_is_400():
    assert _question(subject="astrology").status_code == 400


def test_question_rejects_out_of_range_total():
    assert client.post(
        "/quiz/question", json={"subject": "math", "total": 0, "number": 1}
    ).status_code == 422
    assert client.post(
        "/quiz/question", json={"subject": "math", "total": 99, "number": 1}
    ).status_code == 422


def _answer(state, token, selected):
    return client.post(
        "/quiz/answer", json={"quiz": state, "token": token, "selected": selected}
    )


def _fresh_state(subject="physics", difficulty="medium", total=3):
    return {"subject": subject, "difficulty": difficulty, "total": total,
            "index": 0, "score": 0}


def test_correct_answer_increments_score_no_final_midquiz():
    q = _question(total=3, number=1).json()["question"]
    b = _answer(_fresh_state(total=3), q["token"], QUIZ_CORRECT_INDEX).json()

    assert b["result"]["correct"] is True
    assert b["result"]["number"] == 1
    assert b["quiz"]["score"] == 1
    assert b["quiz"]["index"] == 1
    assert b["final"] is None  # grading is instant; next question is fetched separately


def test_wrong_answer_does_not_increment_score():
    q = _question(total=3, number=1).json()["question"]
    wrong = (QUIZ_CORRECT_INDEX + 1) % 4

    b = _answer(_fresh_state(total=3), q["token"], wrong).json()
    assert b["result"]["correct"] is False
    assert b["result"]["correct_index"] == QUIZ_CORRECT_INDEX  # revealed for teaching
    assert b["quiz"]["score"] == 0


def test_skipped_answer_is_graded_incorrect():
    q = _question(total=3, number=1).json()["question"]
    b = _answer(_fresh_state(total=3), q["token"], None).json()
    assert b["result"]["correct"] is False
    assert b["quiz"]["score"] == 0


def test_full_quiz_flow_alternates_generate_grade_then_final():
    total = 3
    state = _fresh_state(total=total)
    asked = []
    final = None

    for number in range(1, total + 1):
        q = _question(total=total, number=number, asked=asked).json()["question"]
        asked.append(q["question"])
        b = _answer(state, q["token"], QUIZ_CORRECT_INDEX).json()
        state = b["quiz"]
        final = b["final"]

    assert state["index"] == total
    assert final is not None
    assert final["score"] == total            # all correct
    assert final["total"] == total
    assert final["assessment"]["level"] == "متقدم"


def test_answer_with_bad_token_is_400():
    r = _answer(_fresh_state(), "not-a-real-token", 0)
    assert r.status_code == 400


def test_endpoint_is_stateless_no_prior_question_needed():
    # Craft a quiz state + sealed token by hand and grade it — the server keeps
    # no memory, so a mid-quiz request needs nothing but its own payload.
    token = quiz.seal_answer("Why is the sky blue?", ["a", "b", "c", "d"], 2)
    state = {"subject": "biology", "difficulty": "hard", "total": 4,
             "index": 1, "score": 1}
    b = _answer(state, token, 2).json()

    assert b["result"]["correct"] is True
    # The explanation is now generated lazily at grade time (a string, not sealed).
    assert isinstance(b["result"]["explanation"], str)
    assert b["quiz"]["index"] == 2
    assert b["quiz"]["score"] == 2  # 1 (carried in payload) + 1


# --------------------------------------------------------------------------- #
# Guardrail integrity — the quiz reuses, never edits, SYSTEM_INSTRUCTION.
# --------------------------------------------------------------------------- #


def test_quiz_does_not_mutate_system_instruction_guardrails():
    digest = hashlib.sha256(SYSTEM_INSTRUCTION.encode("utf-8")).hexdigest()
    assert digest == _SYSTEM_INSTRUCTION_SHA256


_MCQ_JSON = (
    '{"question": "Sample?", "options": ["a", "b", "c", "d"], '
    '"correct_index": 0, "explanation": "x"}'
)


# --------------------------------------------------------------------------- #
# Bulk generation — the WHOLE quiz in one minified JSON array (zero-latency).
# --------------------------------------------------------------------------- #


def _bulk_array(count, start=1):
    """A minified JSON array of ``count`` distinct, valid MCQs in the LIGHTWEIGHT
    shape the bulk path now asks for (question/options/correct_index only — no
    explanation/topic), mirroring what DeepSeek is asked to emit."""
    items = []
    for i in range(start, start + count):
        items.append(
            f'{{"question":"Bulk Q{i}?","options":["a","b","c","d"],'
            f'"correct_index":{i % 4}}}'
        )
    return "[" + ",".join(items) + "]"


def test_bulk_prompt_carries_marker_subject_difficulty_and_count():
    subject = quiz.get_subject("physics")
    prompt = quiz.build_bulk_generation_prompt(subject, "hard", 20)
    assert QUIZ_BULK_MARKER in prompt
    assert "Physics" in prompt
    assert "hard" in prompt
    assert "EXACTLY 20 objects" in prompt  # the count the stub parses back out
    assert "minified JSON array" in prompt


def test_bulk_prompt_marker_is_distinct_from_single_marker():
    # The two markers must not be substrings of one another, or the offline stub
    # (and a real prompt classifier) could confuse single vs. bulk requests.
    assert QUIZ_GEN_MARKER not in QUIZ_BULK_MARKER
    assert QUIZ_BULK_MARKER not in QUIZ_GEN_MARKER


def test_generate_quiz_batch_returns_lightweight_questions():
    # The batch is now explanation-free and topic-free (the speed optimization):
    # only question/options/correct_index, with an empty explanation default.
    batch = quiz.generate_quiz_batch(lambda p: _bulk_array(10), "physics", "easy", 10)
    assert len(batch) == 10
    for item in batch:
        assert set(item) == {"question", "options", "correct_index", "explanation"}
        assert item["explanation"] == ""  # never generated at kickoff
        assert "topic" not in item
        assert len(item["options"]) == 4
        assert 0 <= item["correct_index"] <= 3


@pytest.mark.parametrize(
    "wrap",
    [
        lambda a: a,                          # raw minified array
        lambda a: "```json\n" + a + "\n```",  # fenced
        lambda a: "Sure! Here you go:\n" + a,  # prose preamble
    ],
)
def test_generate_quiz_batch_tolerates_fences_and_prose(wrap):
    batch = quiz.generate_quiz_batch(lambda p: wrap(_bulk_array(5)), "math", "medium", 5)
    assert len(batch) == 5


def test_generate_quiz_batch_dedupes_and_caps_to_count():
    # Five identical questions collapse to one; a request for more never invents.
    dup = "[" + ",".join([_bulk_array(1)[1:-1]] * 5) + "]"
    assert len(quiz.generate_quiz_batch(lambda p: dup, "math", "easy", 5)) == 1
    # Over-supply is capped to the requested count.
    assert len(quiz.generate_quiz_batch(lambda p: _bulk_array(12), "math", "easy", 8)) == 8


def test_generate_quiz_batch_skips_a_single_bad_item_keeps_rest():
    mixed = (
        '[{"question":"Good?","options":["a","b","c","d"],"correct_index":0,'
        '"explanation":"e","topic":"T"},'
        '{"question":"Bad","options":["only","three","here"],"correct_index":0}]'
    )
    batch = quiz.generate_quiz_batch(lambda p: mixed, "math", "easy", 5)
    assert len(batch) == 1 and batch[0]["question"] == "Good?"


@pytest.mark.parametrize("raw", ["not an array", "{}", "[]", "", '{"a":1}', "[123, 456]"])
def test_generate_quiz_batch_rejects_unusable_output(raw):
    with pytest.raises(quiz.QuizGenerationError):
        quiz.generate_quiz_batch(lambda p: raw, "math", "medium", 5)


def test_generate_quiz_batch_unknown_subject_raises():
    with pytest.raises(quiz.UnknownSubjectError):
        quiz.generate_quiz_batch(lambda p: _bulk_array(3), "astrology", "easy", 3)


# --------------------------------------------------------------------------- #
# /quiz/start — bulk endpoint contract.
# --------------------------------------------------------------------------- #


def _start(subject="physics", difficulty="medium", total=10):
    return client.post(
        "/quiz/start",
        json={"subject": subject, "difficulty": difficulty, "total": total},
    )


def test_start_returns_full_sealed_batch_without_leaking_answers():
    r = _start(subject="physics", difficulty="easy", total=12)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["total"] == 12
    questions = body["questions"]
    assert len(questions) == 12
    for i, q in enumerate(questions, start=1):
        assert q["number"] == i and q["total"] == 12
        assert q["subject"] == "physics"
        assert len(q["options"]) == 4
        assert q["token"]
        # The lighter start-payload carries NO topic/explanation/answer — those
        # are produced lazily at grade time.
        assert "topic" not in q
        assert "correct_index" not in q
        assert "explanation" not in q


def test_start_unknown_subject_is_400():
    assert _start(subject="astrology").status_code == 400


def test_start_rejects_out_of_range_total():
    assert _start(total=0).status_code == 422
    assert _start(total=99).status_code == 422


def test_start_tokens_grade_correctly_through_answer_endpoint():
    questions = _start(subject="math", total=5).json()["questions"]
    # Every stub question's correct option is QUIZ_CORRECT_INDEX; grading the
    # bulk-issued token must agree (sealed answers survive the round-trip).
    state = _fresh_state(subject="math", total=5)
    for q in questions:
        b = _answer(state, q["token"], QUIZ_CORRECT_INDEX).json()
        state = b["quiz"]
    assert state["score"] == 5
    assert b["final"]["assessment"]["level"] == "متقدم"


# --------------------------------------------------------------------------- #
# Light kickoff + lazy feedback — explanations move OFF the start path, ONTO the
# grade path, so a 20-question quiz initializes fast.
# --------------------------------------------------------------------------- #


def test_bulk_prompt_omits_explanations_and_topics():
    # The whole speed optimization: the kickoff prompt must NOT request the
    # text-heavy explanation/topic keys (they are generated later, per answer).
    prompt = quiz.build_bulk_generation_prompt(quiz.get_subject("physics"), "medium", 20)
    assert '"question"' in prompt and '"options"' in prompt and '"correct_index"' in prompt
    assert '"explanation"' not in prompt
    assert '"topic"' not in prompt


def test_grade_generates_explanation_and_topic_lazily():
    # A freshly sealed token (question context only) grades AND yields a
    # lazily-generated explanation + topic from the grade endpoint.
    token = quiz.seal_answer("ما هي وحدة القوة؟", ["نيوتن", "جول", "واط", "باسكال"], 0)
    b = _answer(_fresh_state(total=3), token, 0).json()
    assert b["result"]["correct"] is True
    assert isinstance(b["result"]["explanation"], str) and b["result"]["explanation"]
    assert isinstance(b["result"]["topic"], str) and b["result"]["topic"]


def test_generate_feedback_is_best_effort():
    opts = ["نيوتن", "جول", "واط", "باسكال"]
    # A model/parse failure degrades to empty feedback — never blocks grading.
    def boom(_prompt):
        raise RuntimeError("model down")

    assert quiz.generate_feedback(boom, "Q?", opts, 0, 0) == {"explanation": "", "topic": ""}
    # Missing context short-circuits without a model call.
    assert quiz.generate_feedback(boom, "", [], 0, 0) == {"explanation": "", "topic": ""}
    # A well-formed completion is parsed into explanation + topic.
    good = quiz.generate_feedback(
        lambda p: '{"explanation":"because reasons","topic":"forces"}', "Q?", opts, 0, 0
    )
    assert good["explanation"] == "because reasons" and good["topic"] == "forces"


def test_feedback_prompt_marker_is_distinct():
    # The feedback marker must not collide with the single/bulk generation markers.
    prompt = quiz.build_feedback_prompt("Q?", ["a", "b", "c", "d"], 0, 1)
    assert QUIZ_GEN_MARKER not in prompt
    assert QUIZ_BULK_MARKER not in prompt


# --------------------------------------------------------------------------- #
# Voice answer matching — spoken transcript → option index (local, no model).
# --------------------------------------------------------------------------- #

_AR_OPTIONS = ["الطاقة الحركية", "الطاقة الكامنة", "الشغل", "القدرة"]
_EN_OPTIONS = ["Kinetic energy", "Potential energy", "Work", "Power"]
_TF_OPTIONS = ["صح", "خطأ", "لا أعرف", "ربما"]


@pytest.mark.parametrize(
    "transcript,options,expected",
    [
        # Arabic letter names (bare and with the definite article / qualifier).
        ("أ", _AR_OPTIONS, 0),
        ("ألف", _AR_OPTIONS, 0),
        ("خيار ب", _AR_OPTIONS, 1),
        ("جيم", _AR_OPTIONS, 2),
        ("الدال", _AR_OPTIONS, 3),
        # Arabic ordinals and digits.
        ("الخيار الأول", _AR_OPTIONS, 0),
        ("الإجابة الثالثة", _AR_OPTIONS, 2),
        ("الرابع", _AR_OPTIONS, 3),
        ("١", _AR_OPTIONS, 0),
        ("٢", _AR_OPTIONS, 1),
        # Reading a choice aloud (exact + diacritized).
        ("الطاقة الكامنة", _AR_OPTIONS, 1),
        ("القدرة", _AR_OPTIONS, 3),
        # True / false style options.
        ("صح", _TF_OPTIONS, 0),
        ("خطأ", _TF_OPTIONS, 1),
        ("صحيح", _TF_OPTIONS, 0),
        # English letters / ordinals / read-aloud.
        ("A", _EN_OPTIONS, 0),
        ("letter B", _EN_OPTIONS, 1),
        ("option C", _EN_OPTIONS, 2),
        ("D", _EN_OPTIONS, 3),
        ("first", _EN_OPTIONS, 0),
        ("Potential energy", _EN_OPTIONS, 1),
        # No confident match → -1 (caller asks the student to repeat).
        ("بطيخ أحمر كبير", _AR_OPTIONS, -1),
        ("", _AR_OPTIONS, -1),
    ],
)
def test_match_spoken_answer(transcript, options, expected):
    assert quiz.match_spoken_answer(transcript, options)["index"] == expected


def test_match_spoken_answer_is_pure_and_never_raises():
    # Defensive: odd inputs return a clean no-match, never an exception.
    assert quiz.match_spoken_answer(None, _AR_OPTIONS)["index"] == -1
    assert quiz.match_spoken_answer("anything", [])["index"] == -1


def _voice_match(transcript, options, language="ar"):
    return client.post(
        "/quiz/voice-match",
        json={"transcript": transcript, "options": options, "language": language},
    )


def test_voice_match_endpoint_resolves_and_reports_no_match():
    hit = _voice_match("خيار ب", _AR_OPTIONS).json()
    assert hit["status"] == "success"
    assert hit["index"] == 1
    miss = _voice_match("لا يوجد تطابق هنا إطلاقا", _AR_OPTIONS).json()
    assert miss["index"] == -1


def test_voice_match_endpoint_validates_options():
    # Fewer than two options is a malformed request.
    assert _voice_match("أ", ["only one"]).status_code == 422


@pytest.mark.parametrize(
    "transcript,expected",
    [
        # Arabic ordinal adverbs ("أولاً", "ثانياً", ...).
        ("أولاً", 0),
        ("ثانياً", 1),
        ("ثالثاً", 2),
        ("رابعاً", 3),
        # STT phonetic variants for lone letters (English letter sounds, "ألفا").
        ("بي", 1),
        ("سي", 2),
        ("دي", 3),
        ("الفا", 0),
        # Extra qualifiers ("اختيار", "البديل").
        ("اختيار ج", 2),
        ("البديل الثاني", 1),
    ],
)
def test_match_spoken_answer_phonetic_and_adverb_variants(transcript, expected):
    assert quiz.match_spoken_answer(transcript, _AR_OPTIONS)["index"] == expected


@pytest.mark.parametrize(
    "transcript,expected",
    [
        # Full conversational sentences: hesitation + opinion framing + padding
        # around a letter/ordinal core. The matcher must strip the noise and pull
        # out the answer (the headline robustness requirement).
        ("امممم اتوقع الجواب الصحيح هو فقرة الف", 0),
        ("اشوف ان الخيار الثاني صح", 1),
        ("والله اتوقع فقرة باء هي الصح", 1),
        ("يعني حرف جيم", 2),
        ("جواب دال", 3),
        ("رقم واحد من فضلك", 0),
        ("اعتقد الرابع", 3),
        ("ممم اعتقد الاولى", 0),
        # Positional phrasing ("the last one").
        ("اخر وحدة", 3),
        # Natural English padding around the choice.
        ("I think the answer is option C", 2),
        ("um maybe letter B", 1),
    ],
)
def test_match_spoken_answer_strips_conversational_padding(transcript, expected):
    assert quiz.match_spoken_answer(transcript, _AR_OPTIONS)["index"] == expected


@pytest.mark.parametrize(
    "transcript,expected",
    [
        # True/false vocabulary, including conversational framing and the negated
        # truth "مو صح" → false. Resolved ONLY because the options are a T/F set.
        ("اعتقد صحيح", 0),
        ("صحيحة", 0),
        ("مو صح", 1),
        ("غلط", 1),
        ("خاطئة", 1),
        ("هذا غلط اكيد", 1),
        ("اكيد خطأ", 1),
    ],
)
def test_match_spoken_answer_true_false_variants(transcript, expected):
    assert quiz.match_spoken_answer(transcript, _TF_OPTIONS)["index"] == expected


def test_long_sentence_requires_an_unambiguous_signal():
    # A STRONG token (spelled-out ordinal) is pulled out of a long sentence even
    # with leftover non-filler chatter...
    assert (
        quiz.match_spoken_answer("honestly I guess it is the first one", _EN_OPTIONS)[
            "index"
        ]
        == 0
    )
    # ...but bare AMBIGUOUS letters buried in a long sentence must NOT auto-fire
    # (a is an article here, not choice A) — the voice path auto-submits, so a
    # false positive would commit a wrong answer. Safer to ask the student again.
    assert (
        quiz.match_spoken_answer("a cat sat on the mat then b", _EN_OPTIONS)["index"]
        == -1
    )
    assert (
        quiz.match_spoken_answer("I am torn between a and b", _EN_OPTIONS)["index"] == -1
    )


def test_true_false_words_do_not_hijack_a_normal_mcq():
    # "صح" trailing a normal MCQ sentence must NOT map to anything by itself —
    # the letter/ordinal core wins, and T/F matching is disabled for non-T/F
    # options. Here the real answer is the ordinal, not the stray "صح".
    assert quiz.match_spoken_answer("الخيار الثالث صح", _AR_OPTIONS)["index"] == 2
    # A bare T/F word against MCQ options resolves to nothing.
    assert quiz.match_spoken_answer("غلط", _AR_OPTIONS)["index"] == -1


def test_voice_match_endpoint_handles_a_full_sentence():
    # End-to-end: a natural spoken sentence resolves to the right option index.
    r = client.post(
        "/quiz/voice-match",
        json={
            "transcript": "امممم اتوقع ان الخيار الثاني هو الصحيح",
            "options": _AR_OPTIONS,
            "language": "ar",
        },
    )
    assert r.status_code == 200
    assert r.json()["index"] == 1


def test_match_spoken_answer_multi_recovers_a_lower_ranked_alternative():
    # The top STT hypothesis is a mangled lone letter that misses; a clearer
    # phrasing one rank down resolves — N-best recovery without a re-prompt.
    m = quiz.match_spoken_answer_multi(["زززز", "الخيار الثاني"], _AR_OPTIONS)
    assert m["index"] == 1
    # Primary-only still behaves like the single matcher.
    assert quiz.match_spoken_answer_multi(["أ"], _AR_OPTIONS)["index"] == 0
    # Everything misses → a clean no-match.
    assert quiz.match_spoken_answer_multi(["نننن", "ممم"], _AR_OPTIONS)["index"] == -1
    # Empty candidate list never raises.
    assert quiz.match_spoken_answer_multi([], _AR_OPTIONS)["index"] == -1


def test_voice_match_endpoint_uses_alternatives():
    # The primary transcript misses; an N-best alternative carries the answer.
    body = {
        "transcript": "خخخخ",
        "alternatives": ["لا شيء", "الخيار الثالث"],
        "options": _AR_OPTIONS,
        "language": "ar",
    }
    r = client.post("/quiz/voice-match", json=body)
    assert r.status_code == 200
    assert r.json()["index"] == 2


# --------------------------------------------------------------------------- #
# End-to-end stateless flows — start → (close mid-way → reopen) → finish, by
# BOTH the text path and the voice path. Mirrors the simulated user actions:
# starting a quiz, closing the interface mid-way, reopening, completing.
# --------------------------------------------------------------------------- #


def test_bulk_quiz_completed_via_text_answers():
    questions = _start(subject="physics", total=4).json()["questions"]
    state = _fresh_state(subject="physics", total=4)
    final = None
    for q in questions:
        b = _answer(state, q["token"], QUIZ_CORRECT_INDEX).json()
        state, final = b["quiz"], b["final"]
    assert state["index"] == 4 and final is not None and final["score"] == 4


def test_bulk_quiz_completed_via_voice_answers():
    # The student SPEAKS each answer; the transcript is resolved to an index and
    # then graded exactly like a click. Saying "ألف" / "letter A" picks index 0,
    # which is the stub's correct option.
    questions = _start(subject="english", total=3).json()["questions"]
    state = _fresh_state(subject="english", total=3)
    spoken = ["letter A", "option A", "A"]
    final = None
    for q, said in zip(questions, spoken):
        idx = _voice_match(said, q["options"], q.get("language", "ar")).json()["index"]
        b = _answer(state, q["token"], idx).json()
        state, final = b["quiz"], b["final"]
    assert final is not None and final["score"] == 3


def test_quiz_survives_close_and_reopen_midway():
    # Start a 6-question quiz, answer 2, then "close the tab": discard the live
    # objects and keep ONLY what the client persists (the question tokens + the
    # quiz state). Reopen and finish from there — the server held nothing, so the
    # restored payload alone is enough to complete and score the quiz.
    questions = _start(subject="biology", total=6).json()["questions"]
    state = _fresh_state(subject="biology", total=6)
    for q in questions[:2]:
        state = _answer(state, q["token"], QUIZ_CORRECT_INDEX).json()["quiz"]

    # ---- simulate reload: only `persisted` crosses the gap ----
    persisted = {"quiz": dict(state), "tokens": [q["token"] for q in questions]}

    resumed = dict(persisted["quiz"])
    final = None
    for token in persisted["tokens"][resumed["index"]:]:
        b = _answer(resumed, token, QUIZ_CORRECT_INDEX).json()
        resumed, final = b["quiz"], b["final"]

    assert resumed["index"] == 6
    assert final is not None and final["score"] == 6
    assert final["assessment"]["level"] == "متقدم"
