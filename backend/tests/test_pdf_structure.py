"""Structure-aware / page-aware PDF extraction contract tests.

Fully offline and deterministic (see ``tests/fixtures.py``): fixtures are built
with reportlab, Arabic with arabic-reshaper + python-bidi over the vendored
OFL Amiri font. No network, no system fonts, no randomness, no wall-clock.

Tiers (per waaie_pdf_pipeline_prompt.md, Verification §1):
  T1 — tag injection & page-boundary ordering (the page-shuffling regression)
  T2 — multi-column reading order (rightmost-first for RTL, never interleaved)
  T3 — Arabic integrity & RTL reading order
  T4 — budget & tag-aware compression (incl. DocumentTooLargeError)
  T5 — guardrail integrity (model.SYSTEM_INSTRUCTION pinned by SHA-256)
  T6 — defensive cases (empty, image-only page, corrupt bytes)
Plus a check of the structural parse trace used as the verification artifact.
"""

import hashlib
import re
import unicodedata

import pytest

from documents import (
    MAX_CONTEXT_CHARS,
    PAGE_EMPTY_TMPL,
    PAGE_END_TMPL,
    PAGE_START_TMPL,
    PAGE_TAG_RE,
    DocumentParseError,
    DocumentTooLargeError,
    _assemble_pdf_with_budget,
    extract_text,
    structural_parse_trace,
)
from tests.fixtures import Word, build_pdf, shape_arabic, simple_lines_pdf


def _tag_sequence(text):
    """Return the ordered list of (page_number, kind) for every boundary tag,
    matched with the single canonical regex."""
    seq = []
    for line in text.splitlines():
        m = PAGE_TAG_RE.match(line)
        if m:
            seq.append((int(m.group(1)), m.group(2)))
    return seq


def _nfkc_shaped(token):
    """The form a logical Arabic token takes in the extractor output: shaped to
    visual order by the PDF, then NFKC-folded back to base letters."""
    return unicodedata.normalize("NFKC", shape_arabic(token))


# --------------------------------------------------------------------------- #
# Tier 1 — tag injection & page-boundary ordering
# --------------------------------------------------------------------------- #


def test_tier1_every_page_wrapped_in_ascending_tags():
    data = simple_lines_pdf(
        [
            ["PAGE1_LINE1", "PAGE1_LINE2"],
            ["PAGE2_LINE1", "PAGE2_LINE2"],
            ["PAGE3_LINE1"],
        ]
    )
    out = extract_text("doc.pdf", data)

    seq = _tag_sequence(out)
    # Strict START/END pairing in order: (1,S)(1,E)(2,S)(2,E)(3,S)(3,E).
    assert seq == [
        (1, "START"), (1, "END"),
        (2, "START"), (2, "END"),
        (3, "START"), (3, "END"),
    ]

    starts = [n for n, kind in seq if kind == "START"]
    # Strictly ascending 1..N, no gaps, no duplicates.
    assert starts == list(range(1, len(starts) + 1))
    assert len(starts) == len(set(starts))


def test_tier1_content_stays_within_its_own_page_boundaries():
    data = simple_lines_pdf(
        [["PAGE1_LINE1", "PAGE1_LINE2"], ["PAGE2_LINE1"], ["PAGE3_LINE1"]]
    )
    out = extract_text("doc.pdf", data)

    p1_end = out.index(PAGE_END_TMPL.format(n=1))
    p2_start = out.index(PAGE_START_TMPL.format(n=2))

    # Page-1 content appears before PAGE 1 END and never leaks past it — the
    # direct regression test for "page-16 answered with page-21 content".
    assert 0 <= out.index("PAGE1_LINE1") < p1_end
    assert 0 <= out.index("PAGE1_LINE2") < p1_end
    assert out.index("PAGE2_LINE1") > p2_start
    assert "PAGE2_LINE1" not in out[:p1_end]


def test_tier1_lines_in_reading_order_top_to_bottom():
    data = simple_lines_pdf([["ALPHA", "BETA", "GAMMA"]])
    out = extract_text("doc.pdf", data)
    assert out.index("ALPHA") < out.index("BETA") < out.index("GAMMA")


# --------------------------------------------------------------------------- #
# Tier 2 — multi-column reading order
# --------------------------------------------------------------------------- #


def test_tier2_ltr_two_columns_not_interleaved():
    # Left column at x=72, right column at x=360, same three rows.
    pages = [[
        Word(72, 720, "LEFT1"), Word(360, 720, "RIGHT1"),
        Word(72, 700, "LEFT2"), Word(360, 700, "RIGHT2"),
        Word(72, 680, "LEFT3"), Word(360, 680, "RIGHT3"),
    ]]
    out = extract_text("cols.pdf", build_pdf(pages))

    li = [out.index(f"LEFT{i}") for i in (1, 2, 3)]
    ri = [out.index(f"RIGHT{i}") for i in (1, 2, 3)]
    # LTR: whole left column is read before the right column (not L1,R1,L2,...).
    assert li == sorted(li)
    assert ri == sorted(ri)
    assert max(li) < min(ri)


def test_tier2_rtl_two_columns_rightmost_first():
    # An RTL (Arabic) page: right band must be read before the left band.
    right_tokens = ["واحد", "اثنان"]   # placed at x=400 (right column)
    left_tokens = ["ثلاثة", "أربعة"]   # placed at x=120 (left column)
    pages = [[
        Word(400, 720, right_tokens[0], arabic=True),
        Word(120, 720, left_tokens[0], arabic=True),
        Word(400, 700, right_tokens[1], arabic=True),
        Word(120, 700, left_tokens[1], arabic=True),
    ]]
    out = extract_text("rtlcols.pdf", build_pdf(pages, font_size=14))

    right_idx = [out.find(_nfkc_shaped(t)) for t in right_tokens]
    left_idx = [out.find(_nfkc_shaped(t)) for t in left_tokens]
    assert all(i >= 0 for i in right_idx + left_idx)
    # Every right-band token precedes every left-band token — rightmost-first,
    # never interleaved across the column gutter.
    assert max(right_idx) < min(left_idx)


# --------------------------------------------------------------------------- #
# Tier 3 — Arabic integrity & RTL reading order
# --------------------------------------------------------------------------- #


def test_tier3_arabic_codepoints_survive_and_tokens_in_rtl_order():
    # Logical phrase "قوانين الطاقة" reads right-to-left: قوانين (right) first.
    right_token = "قوانين"
    left_token = "الطاقة"
    pages = [[
        Word(400, 700, right_token, arabic=True),
        Word(200, 700, left_token, arabic=True),
    ]]
    out = extract_text("ar.pdf", build_pdf(pages, font_size=18))

    # Integrity: every base codepoint of each token survives the round-trip
    # (NFKC folds the shaped presentation forms back to base Arabic letters).
    assert set(right_token) <= set(out)
    assert set(left_token) <= set(out)

    # Token order: the right-placed token appears first (RTL reading order).
    ri = out.find(_nfkc_shaped(right_token))
    li = out.find(_nfkc_shaped(left_token))
    assert 0 <= ri < li


def test_tier3_latin_digit_run_keeps_ltr_order_inside_arabic_line():
    # A year embedded in an Arabic line must stay "2024", never "4202".
    pages = [[
        Word(380, 700, "الفصل", arabic=True),
        Word(300, 700, "2024"),
    ]]
    out = extract_text("mixed.pdf", build_pdf(pages, font_size=16))
    assert "2024" in out
    assert "4202" not in out


# --------------------------------------------------------------------------- #
# Tier 4 — budget & tag-aware compression
# --------------------------------------------------------------------------- #


def _over_budget_pdf(num_pages=30, lines_per_page=80):
    """Build a PDF whose extracted text far exceeds the budget. Each page leads
    with a unique 'PAGEHEAD_n' token (topmost) so head-preservation is testable."""
    pages = []
    for pg in range(1, num_pages + 1):
        words = [Word(36, 765, f"PAGEHEAD_{pg}")]
        y = 750
        for ln in range(lines_per_page):
            words.append(Word(36, y, f"P{pg:02d}L{ln:02d}_" + "ABCDEFGHIJ" * 8))
            y -= 9
        pages.append(words)
    return build_pdf(pages, font_size=6)


def test_tier4_over_budget_stays_within_limit_with_all_tags():
    data = _over_budget_pdf()
    out = extract_text("big.pdf", data)

    # Pre-compression the content is well over budget; the result never is.
    assert len(out) <= MAX_CONTEXT_CHARS

    seq = _tag_sequence(out)
    starts = [n for n, kind in seq if kind == "START"]
    ends = [n for n, kind in seq if kind == "END"]
    # ALL 30 pages remain addressable — no page (or tag) was dropped.
    assert starts == list(range(1, 31))
    assert ends == list(range(1, 31))

    # Over-budget pages carry the truncation marker...
    assert "TRUNCATED" in out
    assert re.search(r"--- \[PAGE \d+ TRUNCATED: kept \d+ of \d+ chars\] ---", out)
    # ...and leading structural content (the page header) survived truncation.
    for pg in range(1, 31):
        assert f"PAGEHEAD_{pg}" in out


def test_tier4_truncation_marker_counts_match_kept_chars():
    out = extract_text("big.pdf", _over_budget_pdf())
    for m in re.finditer(
        r"--- \[PAGE (\d+) TRUNCATED: kept (\d+) of (\d+) chars\] ---", out
    ):
        kept, total = int(m.group(2)), int(m.group(3))
        assert 0 <= kept < total  # truncation really dropped something


def test_tier4_tag_overhead_alone_exceeding_budget_raises():
    # Thousands of pages: START+END tags alone blow the budget -> typed error.
    bodies = ["body"] * 20000
    with pytest.raises(DocumentTooLargeError):
        _assemble_pdf_with_budget(bodies, MAX_CONTEXT_CHARS)


def test_tier4_document_too_large_is_a_parse_error():
    # The API layer catches DocumentParseError -> 400; the subtype must inherit.
    assert issubclass(DocumentTooLargeError, DocumentParseError)


def test_tier4_small_document_is_returned_verbatim_within_tags():
    data = simple_lines_pdf([["HELLO_WORLD"]])
    out = extract_text("small.pdf", data)
    assert len(out) <= MAX_CONTEXT_CHARS
    assert "TRUNCATED" not in out
    assert "HELLO_WORLD" in out


# --------------------------------------------------------------------------- #
# Tier 5 — guardrail integrity (mechanically enforces Constraint 2)
# --------------------------------------------------------------------------- #

# Pinned digest of the current model.SYSTEM_INSTRUCTION. If the refactor mutated
# the 6 academic guardrails in any way, this assertion fails loudly.
_SYSTEM_INSTRUCTION_SHA256 = (
    "01a9795e073d6b8aebbc067d82f4733aeb2c2ea2abbea6476e4997e98018659f"
)


def test_tier5_system_instruction_guardrails_unchanged():
    from model import SYSTEM_INSTRUCTION

    digest = hashlib.sha256(SYSTEM_INSTRUCTION.encode("utf-8")).hexdigest()
    assert digest == _SYSTEM_INSTRUCTION_SHA256, (
        "SYSTEM_INSTRUCTION changed — the academic guardrails must not be "
        "edited by the PDF pipeline refactor (see Constraint 2)."
    )


# --------------------------------------------------------------------------- #
# Tier 6 — defensive cases
# --------------------------------------------------------------------------- #


def test_tier6_empty_pdf_raises_no_text():
    # A single blank page (no text layer anywhere) -> clear typed parse error.
    data = build_pdf([[]])
    with pytest.raises(DocumentParseError):
        extract_text("empty.pdf", data)


def test_tier6_image_only_page_gets_empty_marker():
    # Page 1 has text; page 2 is image-only (filled rect, no text layer). The
    # doc still returns, and page 2 carries PAGE_EMPTY between its own tags.
    data = build_pdf(
        [[Word(72, 700, "REAL_TEXT_PAGE")], []],
        draw_rect_on_blank=True,
    )
    out = extract_text("scan.pdf", data)

    assert "REAL_TEXT_PAGE" in out
    assert PAGE_EMPTY_TMPL.format(n=2) in out
    # The empty page still has its boundary tags so it stays addressable.
    assert PAGE_START_TMPL.format(n=2) in out
    assert PAGE_END_TMPL.format(n=2) in out


def test_tier6_corrupt_byte_stream_raises_clean_error():
    with pytest.raises(DocumentParseError):
        extract_text("broken.pdf", b"%PDF-1.4 this is not a real pdf body \x00\x01")


def test_tier6_random_bytes_raise_clean_error():
    with pytest.raises(DocumentParseError):
        extract_text("garbage.pdf", b"\x00\xff\x10\x3a not a pdf at all")


# --------------------------------------------------------------------------- #
# Structural parse trace — the verification artifact ("AST" analogue)
# --------------------------------------------------------------------------- #


def test_structural_parse_trace_shape_and_offsets():
    data = simple_lines_pdf([["PAGE1_LINE1"], ["PAGE2_LINE1"]])
    trace = structural_parse_trace(data)

    assert trace["page_count"] == 2
    assert trace["within_budget"] is True
    assert trace["total_chars_post_compression"] <= MAX_CONTEXT_CHARS
    assert len(trace["pages"]) == 2

    out = extract_text("doc.pdf", data)
    for node in trace["pages"]:
        # Each recorded START offset really points at that page's START tag.
        start_tag = PAGE_START_TMPL.format(n=node["page"])
        assert out[node["tag_start_offset"]:].startswith(start_tag)
        # And the END offset points at the END tag.
        end_tag = PAGE_END_TMPL.format(n=node["page"])
        assert out[node["tag_end_offset"]:].startswith(end_tag)
        assert {"columns", "reading_order", "direction", "lines",
                "char_count", "truncated"} <= node.keys()


def test_structural_parse_trace_tags_form_contiguous_ascending_sequence():
    data = simple_lines_pdf([["A"], ["B"], ["C"], ["D"]])
    trace = structural_parse_trace(data)
    pages = [node["page"] for node in trace["pages"]]
    assert pages == [1, 2, 3, 4]
