import re

import pytest

from tests.contract import MIXED_IN_SCOPE_ANSWER, REFUSAL_MESSAGE
from model import SYSTEM_INSTRUCTION, DeepSeekMentor, detect_language


@pytest.fixture
def mentor():
    return DeepSeekMentor()


def test_model_initialization(mentor):
    assert mentor.client is not None
    assert mentor.model  # a model name is always configured


def test_detect_language():
    assert detect_language("What is the CPU?") == "en"
    assert detect_language("ما هو المعالج المركزي؟") == "ar"
    assert detect_language("") == "en"
    # Mixed input containing any Arabic script is treated as Arabic.
    assert detect_language("What is الراوتر?") == "ar"


def test_get_answer_english(mentor):
    result = mentor.get_answer("What is the CIA triad?")

    assert isinstance(result, dict)
    assert set(result) == {"answer", "language"}
    assert result["language"] == "en"
    assert result["answer"], "Answer should not be empty."


def test_get_answer_arabic(mentor):
    # Arabic question -> answer flagged as Arabic and containing Arabic script.
    result = mentor.get_answer("ما هو الجدار الناري؟")

    assert result["language"] == "ar"
    assert re.search(r"[؀-ۿ]", result["answer"]), \
        "Arabic question should yield an answer containing Arabic script."


def test_empty_question(mentor):
    with pytest.raises(ValueError, match="Question cannot be empty"):
        mentor.get_answer("")


def test_whitespace_question(mentor):
    with pytest.raises(ValueError, match="Question cannot be empty"):
        mentor.get_answer("   ")


def test_missing_api_key(monkeypatch):
    # With no key in the environment, construction must fail fast.
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        DeepSeekMentor(api_key=None)


# --------------------------------------------------------------------------- #
# Guardrail contract — the three core scope scenarios at the model layer.
# --------------------------------------------------------------------------- #

def test_refusal_string_matches_system_prompt():
    """The stub's refusal must byte-match the one in the production prompt."""
    assert REFUSAL_MESSAGE in SYSTEM_INSTRUCTION


def test_scenario_a_in_scope_query(mentor):
    """(a) Valid in-scope query -> structured, non-empty, language-tagged."""
    result = mentor.get_answer("Solve the equation x^2 - 5x + 6 = 0")

    assert set(result) == {"answer", "language"}
    assert result["language"] == "en"
    assert result["answer"].strip()
    # An in-scope answer is never the refusal string.
    assert result["answer"] != REFUSAL_MESSAGE


@pytest.mark.parametrize(
    "question",
    [
        "كيف أطبخ الكبسة؟",          # cooking (Arabic)
        "Give me a recipe for pasta",  # cooking (English -> still refused in Arabic)
        "من فاز في مباراة كرة القدم؟",  # sports (out of curriculum scope)
    ],
)
def test_scenario_b_out_of_scope_exact_refusal(mentor, question):
    """(b) Out-of-scope -> EXACTLY the Arabic refusal, zero extra text."""
    result = mentor.get_answer(question)

    # Refusal language is fixed to Arabic regardless of the question's language.
    assert result["answer"] == REFUSAL_MESSAGE
    # Nothing appended or prepended.
    assert result["answer"].strip() == REFUSAL_MESSAGE


def test_scenario_c_mixed_query_filters_out_of_scope(mentor):
    """(c) Mixed -> answers only the in-scope (TCP/IP) part, drops the recipe."""
    result = mentor.get_answer("Explain TCP/IP and give me a pasta recipe")

    answer_lower = result["answer"].lower()
    assert "tcp/ip" in answer_lower            # technical content present
    assert "pasta" not in answer_lower         # out-of-scope content dropped
    assert "recipe" not in answer_lower
    assert result["answer"] != REFUSAL_MESSAGE  # not a blanket refusal
    assert result["answer"] == MIXED_IN_SCOPE_ANSWER


def test_empty_model_response_raises(mentor, monkeypatch):
    """A blank upstream response is surfaced as a RuntimeError, not '' answer."""
    blank_message = type("_M", (), {"content": ""})()
    blank_choice = type("_C", (), {"message": blank_message})()
    blank = type("_Blank", (), {"choices": [blank_choice]})()
    monkeypatch.setattr(
        mentor.client.chat.completions,
        "create",
        lambda **kwargs: blank,
    )
    with pytest.raises(RuntimeError, match="empty response"):
        mentor.get_answer("What is TCP?")
