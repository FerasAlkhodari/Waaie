"""Offline, guardrail-aware DeepSeek stub + the response contract under test.

This module holds the canned responses and the fake ``openai`` client that
emulates the scope contract encoded in ``model.SYSTEM_INSTRUCTION``:

* In-scope question      -> a language-matched answer within one of the five
  Saudi high-school subjects (math, physics, chemistry, biology/earth & space,
  digital technology & CS).
* Out-of-scope question  -> EXACTLY the Arabic refusal string, nothing else
  (Arabic even for an English out-of-scope question, per the spec).
* Mixed in/out-of-scope  -> answers only the in-scope part, drops the rest.

``conftest.py`` imports ``FakeClient`` from here and patches ``openai.OpenAI``
so the real network client is never constructed. The constants are imported by
the test modules to assert the contract exactly.
"""

import json
import re

_ARABIC_RE = re.compile(r"[؀-ۿ]")

# Canned in-scope answers (language-matched), subject-neutral across the five
# curriculum subjects.
EN_ANSWER = "This is a test answer within a Saudi high-school subject."
AR_ANSWER = "هذه إجابة تجريبية ضمن مواد المرحلة الثانوية."

# The EXACT refusal (harmful/unsafe or non-educational spam) — must byte-match
# model.SYSTEM_INSTRUCTION / model.REFUSAL_MESSAGE.
REFUSAL_MESSAGE = (
    "أنا واعي، مساعدك الدراسي الذكي. يسعدني مساعدتك في أي سؤال علمي أو أكاديمي "
    "أو تقني أو برمجي. لكن لا يمكنني المساعدة في هذا الطلب تحديدًا لأنه ضار أو "
    "غير آمن أو لا يحمل أي طابع تعليمي. اطرح عليّ أي سؤال دراسي ويسعدني شرحه لك."
)

# In a mixed prompt the model answers only the in-scope part — never the
# out-of-scope content (no recipe, no sports).
MIXED_IN_SCOPE_ANSWER = (
    "TCP/IP is the core networking model of the internet. IP routes packets "
    "between hosts and TCP provides reliable, ordered delivery on top of it."
)

# The quiz generator (quiz.py) asks the model for one MCQ as raw JSON, opening
# the prompt with this exact marker. The stub recognises it and returns a fixed,
# valid MCQ so the Question-Generator contract can be tested fully offline. The
# correct option is index 0, which the quiz tests rely on.
QUIZ_GEN_MARKER = "Generate exactly ONE multiple-choice quiz question"
QUIZ_QUESTION_JSON = (
    '{"question": "Sample generated question?", '
    '"options": ["Correct option", "Distractor one", "Distractor two", '
    '"Distractor three"], "correct_index": 0, '
    '"explanation": "Option A is correct for this sample."}'
)
QUIZ_CORRECT_INDEX = 0

# The bulk path (quiz.generate_quiz_batch) asks for the WHOLE quiz as one
# minified JSON array, opening with this marker. The stub parses the requested
# count out of the prompt ("EXACTLY <n> objects") and returns exactly that many
# DISTINCT, valid MCQs as a single minified line — so the bulk contract is
# exercised fully offline. Every item's correct option is index 0
# (QUIZ_CORRECT_INDEX), matching the single-question stub.
QUIZ_BULK_MARKER = "Generate a numbered batch of multiple-choice quiz questions"
_QUIZ_BULK_COUNT_RE = re.compile(r"EXACTLY (\d+) objects")


def quiz_bulk_json(count):
    """Build a minified JSON array of ``count`` distinct, valid MCQs in the
    LIGHTWEIGHT shape the bulk generator now expects (question/options/
    correct_index only — NO explanation/topic, which are produced at grade time).
    Question text is indexed so generate_quiz_batch's de-dup keeps all of them."""
    items = [
        {
            "question": f"Sample generated question {i}?",
            "options": [
                "Correct option",
                "Distractor one",
                "Distractor two",
                "Distractor three",
            ],
            "correct_index": 0,
        }
        for i in range(1, count + 1)
    ]
    return json.dumps(items, separators=(",", ":"), ensure_ascii=False)


# Grade-time feedback: quiz.generate_feedback() asks the model for one question's
# explanation + topic as a tiny JSON object, opening with this marker. The stub
# returns a fixed, valid feedback object so the lazy-feedback contract is testable
# offline.
QUIZ_FEEDBACK_MARKER = "Give brief feedback for ONE answered multiple-choice question"
QUIZ_FEEDBACK_JSON = (
    '{"explanation": "The correct option follows directly from the concept being '
    'tested.", "topic": "Sample concept"}'
)

# Lowercased substrings that mark a request out of scope (cooking, sports,
# entertainment). Chosen to never collide with the in-scope markers below.
# NOTE: mathematics — including calculus/integration — is now IN scope.
_OUT_OF_SCOPE_MARKERS = (
    "كبسة", "أطبخ", "اطبخ", "طبخ", "وصفة",
    "pasta", "recipe", "cook",
    "مباراة", "كرة القدم", "لاعب", "أغنية", "فيلم",
    "football", "match", "movie", "song",
)

# Lowercased substrings that mark a request in scope — spanning all five
# subjects. NB: avoid short fragments that collide with out-of-scope words
# (e.g. bare "ip" is a substring of "recipe"); "tcp" covers the TCP/IP cases.
_IN_SCOPE_MARKERS = (
    # Mathematics — الرياضيات
    "math", "algebra", "calculus", "integral", "derivative", "equation",
    "∫", "رياضيات", "جبر", "تفاضل", "تكامل", "معادلة", "هندسة",
    # Physics — الفيزياء
    "physics", "newton", "force", "velocity", "energy", "voltage",
    "فيزياء", "نيوتن", "قوة", "سرعة", "طاقة", "جهد",
    # Chemistry — الكيمياء
    "chemistry", "atom", "molecule", "reaction", "acid",
    "كيمياء", "ذرة", "جزيء", "تفاعل", "حمض",
    # Biology, Earth & Space — الأحياء وعلوم الأرض والفضاء
    "biology", "cell", "dna", "gene", "ecosystem", "planet", "galaxy",
    "أحياء", "خلية", "وراثة", "كوكب", "مجرة",
    # Digital Technology & Computer Science — التقنية الرقمية والحاسب
    "computer", "programming", "algorithm", "network", "tcp", "cpu",
    "حاسب", "برمج", "خوارزم", "شبك", "معالج", "راوتر", "جدار",
)


class _FakeMessage:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.message = _FakeMessage(content)


class _FakeCompletion:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeDelta:
    def __init__(self, content):
        self.content = content


class _FakeStreamChoice:
    def __init__(self, content):
        self.delta = _FakeDelta(content)


class _FakeChunk:
    """One streaming chunk, shaped like an OpenAI streaming completion chunk
    (``chunk.choices[0].delta.content``)."""

    def __init__(self, content):
        self.choices = [_FakeStreamChoice(content)]


class _FakeCompletions:
    """Stand-in for ``client.chat.completions`` that emulates the guardrail
    decision from the question carried in the user message. Supports both the
    blocking (``stream=False``) and streaming (``stream=True``) transports."""

    def create(self, model, messages, **kwargs):
        question = ""
        for message in messages:
            if message.get("role") == "user":
                question = message.get("content", "")
        low = question.lower()

        # Grade-time feedback: return a fixed, valid {explanation, topic} object.
        if QUIZ_FEEDBACK_MARKER in question:
            content = QUIZ_FEEDBACK_JSON
            if kwargs.get("stream"):
                return self._as_stream(content)
            return _FakeCompletion(content)

        # Bulk quiz generation: return a minified JSON array of the requested
        # size. Checked before the single marker (the two markers are mutually
        # exclusive, but this keeps intent obvious).
        if QUIZ_BULK_MARKER in question:
            match = _QUIZ_BULK_COUNT_RE.search(question)
            count = int(match.group(1)) if match else 10
            content = quiz_bulk_json(count)
            if kwargs.get("stream"):
                return self._as_stream(content)
            return _FakeCompletion(content)

        # Single quiz generation: return a deterministic, valid MCQ as raw JSON.
        if QUIZ_GEN_MARKER in question:
            content = QUIZ_QUESTION_JSON
            if kwargs.get("stream"):
                return self._as_stream(content)
            return _FakeCompletion(content)

        has_out = any(marker in low for marker in _OUT_OF_SCOPE_MARKERS)
        has_in = any(marker in low for marker in _IN_SCOPE_MARKERS)

        # Pure out-of-scope -> exact Arabic refusal, nothing else.
        if has_out and not has_in:
            content = REFUSAL_MESSAGE
        # Mixed -> answer the in-scope part only, ignore the rest.
        elif has_out and has_in:
            content = MIXED_IN_SCOPE_ANSWER
        # In-scope -> reply in the language of the question.
        else:
            content = AR_ANSWER if _ARABIC_RE.search(question) else EN_ANSWER

        if kwargs.get("stream"):
            return self._as_stream(content)
        return _FakeCompletion(content)

    @staticmethod
    def _as_stream(content):
        """Emulate token streaming by splitting the canned answer into
        word-sized deltas, mirroring the OpenAI streaming chunk shape."""
        words = content.split(" ")
        for i, word in enumerate(words):
            piece = word if i == 0 else " " + word
            yield _FakeChunk(piece)


class _FakeChat:
    def __init__(self):
        self.completions = _FakeCompletions()


class FakeClient:
    """Replacement for ``openai.OpenAI`` — never opens a network connection."""

    def __init__(self, *args, **kwargs):
        self.chat = _FakeChat()
