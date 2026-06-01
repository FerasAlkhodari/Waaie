"""Offline, guardrail-aware Gemini stub + the response contract under test.

This module holds the canned responses and the fake ``genai`` client that
emulates the scope contract encoded in ``model.SYSTEM_INSTRUCTION``:

* In-scope question      -> a language-matched technical answer.
* Out-of-scope question  -> EXACTLY the Arabic refusal string, nothing else
  (Arabic even for an English out-of-scope question, per the spec).
* Mixed in/out-of-scope  -> answers only the in-scope part, drops the rest.

``conftest.py`` imports ``FakeClient`` from here and patches ``genai.Client``
so the real network client is never constructed. The constants are imported by
the test modules to assert the contract exactly.
"""

import re

_ARABIC_RE = re.compile(r"[؀-ۿ]")

# Canned in-scope answers (language-matched).
EN_ANSWER = "This is a test answer about computer science."
AR_ANSWER = "هذه إجابة تجريبية حول علوم الحاسوب."

# The EXACT out-of-scope refusal — must byte-match model.SYSTEM_INSTRUCTION.
REFUSAL_MESSAGE = (
    "أنا هنا كمساعد ومتخصص في مجالات علوم الحاسب وتقنية المعلومات فقط. "
    "يسعدني الإجابة على أي سؤال يخص البرمجة، الشبكات، أو الأمن السيبراني!"
)

# In a mixed prompt the model answers only the technical part — never the
# out-of-scope content (no recipe, no calculus).
MIXED_IN_SCOPE_ANSWER = (
    "TCP/IP is the core networking model of the internet. IP routes packets "
    "between hosts and TCP provides reliable, ordered delivery on top of it."
)

# Lowercased substrings that mark a request out of scope (cooking, pure
# calculus). Chosen to never collide with the in-scope markers below.
_OUT_OF_SCOPE_MARKERS = (
    "كبسة", "أطبخ", "اطبخ", "طبخ", "وصفة",
    "pasta", "recipe", "cook",
    "calculus", "∫", "تفاضل", "تكامل",
)

# Lowercased substrings that mark a request in scope (CS / IT).
# NB: avoid short fragments that collide with out-of-scope words
# (e.g. bare "ip" is a substring of "recipe"); "tcp" covers the TCP/IP cases.
_IN_SCOPE_MARKERS = (
    "cia", "triad", "tcp", "cpu", "network", "router", "firewall",
    "algorithm", "programming", "database",
    "شبك", "معالج", "خوارزم", "برمج", "راوتر", "جدار", "حاسب",
)


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _FakeModels:
    """Stand-in for ``client.models`` that emulates the guardrail decision."""

    def generate_content(self, model, contents, config=None):
        question = contents or ""
        low = question.lower()

        has_out = any(marker in low for marker in _OUT_OF_SCOPE_MARKERS)
        has_in = any(marker in low for marker in _IN_SCOPE_MARKERS)

        # Pure out-of-scope -> exact Arabic refusal, nothing else.
        if has_out and not has_in:
            return _FakeResponse(REFUSAL_MESSAGE)

        # Mixed -> answer the in-scope part only, ignore the rest.
        if has_out and has_in:
            return _FakeResponse(MIXED_IN_SCOPE_ANSWER)

        # In-scope -> reply in the language of the question.
        text = AR_ANSWER if _ARABIC_RE.search(question) else EN_ANSWER
        return _FakeResponse(text)


class FakeClient:
    """Replacement for ``genai.Client`` — never opens a network connection."""

    def __init__(self, *args, **kwargs):
        self.models = _FakeModels()
