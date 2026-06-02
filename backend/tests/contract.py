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

import re

_ARABIC_RE = re.compile(r"[؀-ۿ]")

# Canned in-scope answers (language-matched), subject-neutral across the five
# curriculum subjects.
EN_ANSWER = "This is a test answer within a Saudi high-school subject."
AR_ANSWER = "هذه إجابة تجريبية ضمن مواد المرحلة الثانوية."

# The EXACT out-of-scope refusal — must byte-match model.SYSTEM_INSTRUCTION.
REFUSAL_MESSAGE = (
    "أنا واعي، مساعدك الدراسي المخصّص حصريًا لمواد المرحلة الثانوية في المملكة "
    "العربية السعودية: الرياضيات، الفيزياء، الكيمياء، الأحياء وعلوم الأرض "
    "والفضاء، والتقنية الرقمية والحاسب. لا يمكنني مساعدتك في هذا الطلب لأنه خارج "
    "نطاق هذه المواد، لكن يسعدني الإجابة عن أي سؤال ضمنها."
)

# In a mixed prompt the model answers only the in-scope part — never the
# out-of-scope content (no recipe, no sports).
MIXED_IN_SCOPE_ANSWER = (
    "TCP/IP is the core networking model of the internet. IP routes packets "
    "between hosts and TCP provides reliable, ordered delivery on top of it."
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


class _FakeCompletions:
    """Stand-in for ``client.chat.completions`` that emulates the guardrail
    decision from the question carried in the user message."""

    def create(self, model, messages, **kwargs):
        question = ""
        for message in messages:
            if message.get("role") == "user":
                question = message.get("content", "")
        low = question.lower()

        has_out = any(marker in low for marker in _OUT_OF_SCOPE_MARKERS)
        has_in = any(marker in low for marker in _IN_SCOPE_MARKERS)

        # Pure out-of-scope -> exact Arabic refusal, nothing else.
        if has_out and not has_in:
            return _FakeCompletion(REFUSAL_MESSAGE)

        # Mixed -> answer the in-scope part only, ignore the rest.
        if has_out and has_in:
            return _FakeCompletion(MIXED_IN_SCOPE_ANSWER)

        # In-scope -> reply in the language of the question.
        text = AR_ANSWER if _ARABIC_RE.search(question) else EN_ANSWER
        return _FakeCompletion(text)


class _FakeChat:
    def __init__(self):
        self.completions = _FakeCompletions()


class FakeClient:
    """Replacement for ``openai.OpenAI`` — never opens a network connection."""

    def __init__(self, *args, **kwargs):
        self.chat = _FakeChat()
