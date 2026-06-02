"""Token-efficient text extraction for uploaded study documents.

Supports the three formats students attach — PDF, Word (.docx) and Excel
(.xlsx) — using pypdf, python-docx and openpyxl. Output is light Markdown
(headings, bullet lists, simple tables) so the DeepSeek mentor reads the
structure densely instead of swimming through raw, whitespace-heavy text. A
generous character budget plus a structure-aware compressor let students
upload complete chapters while still guarding against runaway token spend.

The scope guardrails in ``model.SYSTEM_INSTRUCTION`` still decide whether a
document is in scope — no subject filtering happens here.
"""

import io
import logging
import re

logger = logging.getLogger(__name__)

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from openpyxl import load_workbook
from pypdf import PdfReader

# Context budget (characters). On the prepaid DeepSeek production tier the
# model handles large contexts efficiently, so this is generous enough for a
# complete, detailed study document. Only content beyond this is compressed
# structurally (headings + core paragraphs) rather than hard-truncated.
MAX_CONTEXT_CHARS = 150_000

SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".xlsx")

# Appended (in Arabic) when a document had to be compressed, so the student
# knows the answer is based on a reduced view and can upload a smaller file.
_COMPRESSION_NOTICE = (
    "\n\n> ملاحظة: هذا المستند كبير وتم اختصاره تلقائيًا إلى العناوين والفقرات "
    "الأساسية لتوفير سياق فعّال. للحصول على إجابات أدق، ارفع ملفًا أصغر خاصًا "
    "بالفصل أو الدرس المطلوب."
)


class DocumentParseError(Exception):
    """Raised when an upload cannot be read as a supported text document."""


def extract_text(filename: str, data: bytes) -> str:
    """Extract clean, token-efficient Markdown from a PDF or .docx payload.

    Raises ``DocumentParseError`` for unsupported types, unreadable files, or
    documents that contain no extractable text (e.g. a scanned-image PDF).
    """
    name = (filename or "").lower()

    if name.endswith(".pdf"):
        markdown = _extract_pdf(data)
    elif name.endswith(".docx"):
        markdown = _extract_docx(data)
    elif name.endswith(".xlsx"):
        markdown = _extract_xlsx(data)
    else:
        raise DocumentParseError(
            "Unsupported file type. Please upload a .pdf, .docx or .xlsx file."
        )

    markdown = _normalize(markdown)
    if not markdown:
        raise DocumentParseError(
            "No readable text was found in the document. If it is a scanned "
            "PDF (images only), it cannot be parsed."
        )

    return _compress_to_budget(markdown, MAX_CONTEXT_CHARS)


# --------------------------------------------------------------------------- #
# Format-specific extraction
# --------------------------------------------------------------------------- #


def _extract_docx(data: bytes) -> str:
    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:
        raise DocumentParseError(f"Could not read the Word document: {exc}")

    blocks = []
    for item in _iter_block_items(document):
        if isinstance(item, Paragraph):
            rendered = _paragraph_to_md(item)
        else:  # Table
            rendered = _table_to_md(item)
        if rendered:
            blocks.append(rendered)

    return "\n\n".join(blocks)


def _iter_block_items(document):
    """Yield paragraphs and tables in document order (python-docx loses order
    when iterating ``.paragraphs`` and ``.tables`` separately)."""
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def _paragraph_to_md(paragraph: Paragraph) -> str:
    text = paragraph.text.strip()
    if not text:
        return ""

    style = (paragraph.style.name if paragraph.style else "") or ""
    style_low = style.lower()

    if style_low.startswith("title"):
        return f"# {text}"

    if style_low.startswith("heading"):
        digits = "".join(ch for ch in style_low if ch.isdigit())
        level = min(int(digits), 6) if digits else 2
        return f"{'#' * level} {text}"

    if "list" in style_low or paragraph._p.find(qn("w:numPr")) is not None:
        return f"- {text}"

    return text


def _table_to_md(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = [
            cell.text.strip().replace("\n", " ").replace("|", "\\|")
            for cell in row.cells
        ]
        if any(cells):
            rows.append(cells)

    if not rows:
        return ""

    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]

    lines = ["| " + " | ".join(rows[0]) + " |"]
    lines.append("| " + " | ".join(["---"] * width) + " |")
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    return "\n".join(lines)


def _extract_page_text(page) -> str:
    """Pull text from one PDF page, preferring pypdf's ``layout`` mode.

    Layout mode keeps glyphs in their on-page positions, so an equation's
    operands, operators and super/subscripts stay together (e.g. ``E = I2 R t``
    instead of the symbols scattering or dropping out). If layout mode is
    unavailable or yields nothing, fall back to the default flow extractor so
    behaviour never regresses below the previous baseline."""
    try:
        text = page.extract_text(extraction_mode="layout") or ""
    except Exception:
        text = ""
    if not text.strip():
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
    return text


def _extract_pdf(data: bytes) -> str:
    """Extract text page-by-page, wrapping each page in explicit START/END
    markers so the model can anchor answers to real page numbers instead of
    guessing (e.g. hunting for "Chapter 5" when asked about "page 5").

    Pages are tagged with a strict, sequential 1-based index that maps directly
    to the physical page object order — exactly what a standard PDF viewer's
    page counter shows. ``total_pages`` scales dynamically to the file, so the
    tags run 1..N for a 5-, 50-, or 500-page document alike. A page with no
    extractable text still emits its markers with a placeholder so numbering
    never drifts. If NO page yields any text (e.g. a fully scanned PDF), an
    empty string is returned so the caller raises the existing "no readable
    text" error."""
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise DocumentParseError(f"Could not read the PDF file: {exc}")

    total_pages = len(reader.pages)
    pages = []
    has_text = False
    for page_number, page in enumerate(reader.pages, start=1):
        page_text = _fix_visual_order_arabic(_normalize(_extract_page_text(page)))
        if page_text:
            has_text = True
        else:
            page_text = "[No extractable text on this page.]"
        pages.append(
            f"--- START OF PAGE {page_number} OF {total_pages} ---\n"
            f"{page_text}\n"
            f"--- END OF PAGE {page_number} ---"
        )

    if not has_text:
        return ""
    return "\n\n".join(pages)


def _extract_xlsx(data: bytes) -> str:
    """Render every worksheet as a Markdown table. ``data_only=True`` returns
    computed cell values (not formulas) so DeepSeek can reason over the numbers
    directly; ``read_only=True`` keeps memory flat on large workbooks."""
    try:
        workbook = load_workbook(
            io.BytesIO(data), read_only=True, data_only=True
        )
    except Exception as exc:
        raise DocumentParseError(f"Could not read the Excel file: {exc}")

    blocks = []
    try:
        for sheet in workbook.worksheets:
            rows = []
            for row in sheet.iter_rows(values_only=True):
                cells = [_cell_to_text(value) for value in row]
                if any(cell for cell in cells):
                    rows.append(cells)

            if not rows:
                continue

            width = max(len(r) for r in rows)
            rows = [r + [""] * (width - len(r)) for r in rows]

            blocks.append(f"## Sheet: {sheet.title}")
            table = ["| " + " | ".join(rows[0]) + " |"]
            table.append("| " + " | ".join(["---"] * width) + " |")
            for r in rows[1:]:
                table.append("| " + " | ".join(r) + " |")
            blocks.append("\n".join(table))
    finally:
        workbook.close()

    return "\n\n".join(blocks)


def _cell_to_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip().replace("\n", " ").replace("|", "\\|")


# --------------------------------------------------------------------------- #
# Whitespace normalization & budget compression
# --------------------------------------------------------------------------- #


# Math glyphs that PDF/Word exports emit as Unicode but that get mangled or
# read poorly downstream. We translate them to plain-ASCII math equivalents so
# formulas survive extraction intact and stay legible to the model — e.g.
# "E = I² R t" -> "E = I^2 R t", "H₂O" -> "H_2O", "a × b − c" -> "a * b - c".
# Plain operators (= ^ + * / -) are already ASCII and pass through untouched.
_MATH_TRANSLATIONS = {
    # Superscript digits -> ^n
    0x2070: "^0", 0x00B9: "^1", 0x00B2: "^2", 0x00B3: "^3", 0x2074: "^4",
    0x2075: "^5", 0x2076: "^6", 0x2077: "^7", 0x2078: "^8", 0x2079: "^9",
    0x207A: "^+", 0x207B: "^-", 0x207F: "^n",
    # Subscript digits -> _n (also helps chemistry: H2O, CO2)
    0x2080: "_0", 0x2081: "_1", 0x2082: "_2", 0x2083: "_3", 0x2084: "_4",
    0x2085: "_5", 0x2086: "_6", 0x2087: "_7", 0x2088: "_8", 0x2089: "_9",
    0x208A: "_+", 0x208B: "_-",
    # Operators that have unambiguous ASCII forms
    0x00D7: "*",   # × multiplication sign
    0x22C5: "*",   # ⋅ dot operator
    0x00B7: "*",   # · middle dot
    0x2217: "*",   # ∗ asterisk operator
    0x00F7: "/",   # ÷ division sign
    0x2215: "/",   # ∕ division slash
    0x2212: "-",   # − minus sign
    0x2260: "!=",  # ≠
    0x2264: "<=",  # ≤
    0x2265: ">=",  # ≥
}


# --------------------------------------------------------------------------- #
# Visual-order Arabic correction
# --------------------------------------------------------------------------- #
#
# Some PDF generators (PowerPoint exports, localized printers) embed Arabic in
# VISUAL order — glyphs laid out left-to-right exactly as displayed — instead of
# LOGICAL (reading/typing) order. pypdf reads that glyph stream left-to-right and
# returns the Arabic reversed, e.g. logical "قوانين الطاقة" -> "ةقاطلا نيناوق".
# That gibberish would reach the LLM as if it were real text, so we repair the
# DATA here before any page wrapper is assembled.
#
# Detection is deliberately conservative and keyed on Arabic orthography, so it
# distinguishes visual from logical order WITHOUT a dictionary and stays
# idempotent (a corrected line scores as logical and is never flipped again):
#   * teh marbuta (ة) and alef maksura (ى) can only END a logical word; seeing
#     one at the START of a token is a strong "this token is reversed" signal.
#   * the definite article "ال" begins many logical words; reversed it becomes a
#     trailing "لا", another reversal signal.
# A line is only flipped when reversal signals strictly outnumber logical ones —
# on a tie or no signal we leave the text untouched (a false positive corrupts
# good data, which is worse than a missed fix).

_ARABIC_RE = re.compile(r"[؀-ۿ]")

# Characters stripped from a token's ends before inspecting its first/last
# letter (punctuation, quotes, digits, markdown bullets, whitespace).
_TOKEN_EDGE_STRIP = " \t\r\n.,:;!?()[]{}\"'«»،؛؟…-–—*#|/\\0123456789"

_TEH_MARBUTA = "ة"   # ة — final-only letter
_ALEF_MAKSURA = "ى"  # ى — final-only letter
_ALEF = "ا"          # ا
_LAM = "ل"           # ل
_DEFINITE_ARTICLE = _ALEF + _LAM   # "ال" (logical, word start)
_REVERSED_ARTICLE = _LAM + _ALEF   # "لا" (visual, word end)

# Latin/digit runs (incl. decimals/times like "3.14", "12:30") that must keep
# their internal left-to-right order when the surrounding RTL line is reversed —
# so "2024" never becomes "4202".
_LTR_RUN_RE = re.compile(r"[A-Za-z0-9]+(?:[.,:][A-Za-z0-9]+)*")


def _directional_scores(line: str) -> tuple[int, int]:
    """Return (logical_signals, reversed_signals) for the Arabic tokens in
    ``line`` based on the orthography heuristics described above."""
    logical = 0
    reversed_ = 0
    for token in line.split():
        if not _ARABIC_RE.search(token):
            continue
        core = token.strip(_TOKEN_EDGE_STRIP)
        if not core:
            continue
        if core.startswith(_DEFINITE_ARTICLE):
            logical += 1
        if core[-1] in (_TEH_MARBUTA, _ALEF_MAKSURA):
            logical += 1
        if core[0] in (_TEH_MARBUTA, _ALEF_MAKSURA):
            reversed_ += 1
        if len(core) > 2 and core.endswith(_REVERSED_ARTICLE):
            reversed_ += 1
    return logical, reversed_


def _reverse_visual_line(line: str) -> str:
    """Reverse a visually-ordered line back to logical order, restoring each
    Latin/digit run to its original left-to-right sequence."""
    reversed_chars = line[::-1]
    return _LTR_RUN_RE.sub(lambda m: m.group(0)[::-1], reversed_chars)


def _fix_visual_order_arabic(text: str) -> str:
    """Re-derive logical-order Arabic for any line a PDF emitted in visual order.

    Lines with no Arabic (\\u0600-\\u06FF) are returned unchanged. A line is only
    transformed when reversal signals strictly outnumber logical-order signals;
    otherwise it is left as-is. Idempotent: a corrected line scores as logical,
    so a second pass is a no-op."""
    if not text:
        return text

    fixed_lines = []
    changed = 0
    for line in text.split("\n"):
        if _ARABIC_RE.search(line):
            logical, reversed_ = _directional_scores(line)
            if reversed_ > logical and reversed_ >= 1:
                repaired = _reverse_visual_line(line)
                if repaired != line:
                    fixed_lines.append(repaired)
                    changed += 1
                    continue
        fixed_lines.append(line)

    if changed:
        logger.debug(
            "Corrected visual-order (reversed) Arabic on %d line(s).", changed
        )
    return "\n".join(fixed_lines)


def _normalize(text: str) -> str:
    """Collapse runs of spaces/tabs and blank lines — the cheapest, safest
    token reduction, removing the dead whitespace PDF/Word exports are full
    of without dropping any actual content. Math symbols are explicitly
    preserved: Unicode super/subscripts and operators are mapped to readable
    ASCII (see ``_MATH_TRANSLATIONS``) rather than dropped, so equations stay
    intact through extraction."""
    text = text.translate(_MATH_TRANSLATIONS)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    collapsed = "\n".join(lines)
    collapsed = re.sub(r"\n{3,}", "\n\n", collapsed)
    return collapsed.strip()


def _compress_to_budget(text: str, budget: int) -> str:
    """If ``text`` fits the budget, return it untouched. Otherwise keep the
    document's skeleton — its leading intro, every heading, and the first
    paragraph under each heading — assembled in original order until the
    budget is spent, then append a notice nudging smaller uploads."""
    if len(text) <= budget:
        return text

    blocks = [b for b in text.split("\n\n") if b.strip()]
    is_heading = [b.lstrip().startswith("#") for b in blocks]
    keep = [False] * len(blocks)

    # Leading introduction (first few blocks set the document's context).
    for i in range(min(3, len(blocks))):
        keep[i] = True

    # Every heading plus the first block beneath it (its core paragraph/table).
    for i, heading in enumerate(is_heading):
        if heading:
            keep[i] = True
            if i + 1 < len(blocks) and not is_heading[i + 1]:
                keep[i + 1] = True

    body_budget = budget - len(_COMPRESSION_NOTICE)
    selected = []
    size = 0
    for i, block in enumerate(blocks):
        if not keep[i]:
            continue
        cost = len(block) + 2  # account for the "\n\n" joiner
        if size + cost > body_budget:
            break
        selected.append(block)
        size += cost

    result = "\n\n".join(selected).strip()
    if not result:  # pathological single huge block — hard truncate
        result = text[:body_budget].rstrip()

    return result + _COMPRESSION_NOTICE
