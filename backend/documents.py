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
import re

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


def _extract_pdf(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise DocumentParseError(f"Could not read the PDF file: {exc}")

    pages = []
    for page in reader.pages:
        page_text = _normalize(page.extract_text() or "")
        if page_text:
            pages.append(page_text)
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


def _normalize(text: str) -> str:
    """Collapse runs of spaces/tabs and blank lines — the cheapest, safest
    token reduction, removing the dead whitespace PDF/Word exports are full
    of without dropping any actual content."""
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
