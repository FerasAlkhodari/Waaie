"""Unit tests for the visual-order Arabic correction in ``documents.py``.

Some PDFs store Arabic in visual (reversed) order; ``_fix_visual_order_arabic``
re-derives logical order before the text reaches the LLM. These tests pin the
correctness, conservatism, and idempotency contract of that helper.
"""

from documents import _fix_visual_order_arabic

# Logical (correct, reading order) <-> visual (reversed, as a buggy PDF emits).
LOGICAL = "قوانين الطاقة"
VISUAL = "ةقاطلا نيناوق"


def test_visual_order_line_is_corrected_to_logical():
    # (a) A known visual-order Arabic line is repaired to logical order.
    assert _fix_visual_order_arabic(VISUAL) == LOGICAL


def test_already_logical_line_is_unchanged():
    # (b) Correct logical Arabic must pass through untouched.
    assert _fix_visual_order_arabic(LOGICAL) == LOGICAL


def test_digits_are_preserved_not_reversed():
    # (c) Mixed Arabic + a year: the digit run must keep its LTR order.
    visual_mixed = "2024 لصفلا"      # visual form of "الفصل 2024"
    result = _fix_visual_order_arabic(visual_mixed)
    assert result == "الفصل 2024"
    assert "2024" in result
    assert "4202" not in result


def test_pure_latin_line_is_unchanged():
    # (d) No Arabic block characters -> returned verbatim.
    latin = "This is page 12 of 2024 — PDF export"
    assert _fix_visual_order_arabic(latin) == latin


def test_idempotency_on_visual_input():
    # (e) f(f(x)) == f(x): one correction, never a re-flip.
    once = _fix_visual_order_arabic(VISUAL)
    twice = _fix_visual_order_arabic(once)
    assert twice == once == LOGICAL


def test_idempotency_on_already_logical_input():
    once = _fix_visual_order_arabic(LOGICAL)
    assert _fix_visual_order_arabic(once) == once == LOGICAL


def test_ambiguous_arabic_word_is_left_alone():
    # No reversal signals (no leading ة/ى, no trailing "لا") -> conservative
    # no-op rather than a risky transform on data that may already be correct.
    word = "محمد"
    assert _fix_visual_order_arabic(word) == word


def test_multiline_only_reverses_visual_lines():
    text = f"{LOGICAL}\n{VISUAL}\nplain english line"
    expected = f"{LOGICAL}\n{LOGICAL}\nplain english line"
    assert _fix_visual_order_arabic(text) == expected


def test_empty_string():
    assert _fix_visual_order_arabic("") == ""
