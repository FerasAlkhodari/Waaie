"""Verification artifact: deterministic structural parse trace.

A PDF has no canonical AST, so this prints a deterministic structural parse tree
(``document -> pages[...]``) plus document-level stats for a representative
multi-page Arabic + multi-column fixture, a side-by-side source/reconstructed
excerpt for one Arabic page, and an explicit contiguous-ascending tag check.

Run:  python -m tests.parse_trace_demo   (from backend/, offline, no network)
"""

import io
import json

from documents import (
    MAX_CONTEXT_CHARS,
    PAGE_TAG_RE,
    extract_text,
    structural_parse_trace,
)
from tests.fixtures import Word, build_pdf, shape_arabic


def _representative_pdf() -> bytes:
    # Page 1: single-column Arabic phrase "قوانين الطاقة" (RTL).
    # Page 2: two Arabic columns (rightmost read first).
    # Page 3: image-only (blank) -> PAGE_EMPTY.
    pages = [
        [Word(430, 700, "قوانين", arabic=True), Word(360, 700, "الطاقة", arabic=True)],
        [
            Word(400, 720, "السؤال", arabic=True), Word(120, 720, "الجواب", arabic=True),
            Word(400, 700, "الأول", arabic=True), Word(120, 700, "الثاني", arabic=True),
        ],
        [],
    ]
    return build_pdf(pages, font_size=16, draw_rect_on_blank=True)


def main() -> None:
    data = _representative_pdf()
    trace = structural_parse_trace(data)
    out = extract_text("trace.pdf", data)

    print("=" * 70)
    print("STRUCTURAL PARSE TREE (document -> pages[...])")
    print("=" * 70)
    print(json.dumps(trace, ensure_ascii=False, indent=2))

    print("\n" + "=" * 70)
    print("SIDE-BY-SIDE: source token (logical) vs reconstructed line — page 1")
    print("=" * 70)
    page1 = trace["pages"][0]
    source_logical = "قوانين الطاقة"
    print(f"  source (logical)      : {source_logical}")
    print(f"  reconstructed line(s) : {' / '.join(page1['lines'])}")
    print(f"  shaped form in output : {shape_arabic('قوانين')!r} then {shape_arabic('الطاقة')!r}")
    print("  note: reading order (right token first) and codepoint integrity are")
    print("        the verifiable contract; glyph-perfect round-trip is not claimed.")

    print("\n" + "=" * 70)
    print("PAGE-TAG SEQUENCE CHECK")
    print("=" * 70)
    starts = [
        int(PAGE_TAG_RE.match(ln).group(1))
        for ln in out.splitlines()
        if PAGE_TAG_RE.match(ln) and PAGE_TAG_RE.match(ln).group(2) == "START"
    ]
    contiguous = starts == list(range(1, len(starts) + 1))
    print(f"  start tags found      : {starts}")
    print(f"  contiguous ascending  : {contiguous}")
    print(f"  page_count            : {trace['page_count']}")
    print(f"  chars pre/post comp   : {trace['total_chars_pre_compression']} / "
          f"{trace['total_chars_post_compression']}")
    print(f"  within budget (<= {MAX_CONTEXT_CHARS}): {trace['within_budget']}")


if __name__ == "__main__":
    main()
