"""Deterministic, fully-offline PDF fixture builders for the structure-aware
extraction tests.

Fixtures are generated programmatically with ``reportlab`` (BSD). Arabic text is
shaped with ``arabic-reshaper`` + ``python-bidi`` and rendered with the
OFL-licensed **Amiri** font vendored under ``tests/assets/fonts/`` — so there is
no system-font dependency, no network call, and no runtime asset download. Same
inputs always produce the same bytes.

The builders place words at explicit page coordinates (reportlab's origin is the
bottom-left corner, so larger ``y`` is higher on the page) which is exactly what
lets the tests pin column order, line order, and RTL reading order.
"""

import io
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_PATH = Path(__file__).parent / "assets" / "fonts" / "Amiri-Regular.ttf"
ARABIC_FONT = "AmiriTest"
PAGE_WIDTH, PAGE_HEIGHT = letter  # (612, 792) points


def _ensure_arabic_font() -> None:
    """Register the vendored Amiri font once (idempotent — no module state)."""
    try:
        pdfmetrics.getFont(ARABIC_FONT)
    except KeyError:
        pdfmetrics.registerFont(TTFont(ARABIC_FONT, str(FONT_PATH)))


def shape_arabic(text: str) -> str:
    """Reshape + bidi a logical Arabic string into the visual glyph order a real
    PDF exporter writes into the content stream — the very thing the positional
    parser has to put back into reading order."""
    return get_display(arabic_reshaper.reshape(text))


class Word:
    """One placed token: bottom-left origin ``(x, y)``, text, and whether it
    should be Arabic-shaped + rendered with the Amiri font."""

    __slots__ = ("x", "y", "text", "arabic")

    def __init__(self, x: float, y: float, text: str, arabic: bool = False):
        self.x = x
        self.y = y
        self.text = text
        self.arabic = arabic


def build_pdf(pages, font_size: int = 12, draw_rect_on_blank: bool = False) -> bytes:
    """Build a PDF from ``pages`` (a list of pages, each a list of ``Word``).

    A page given as an empty list renders blank — i.e. no text layer, the
    deterministic stand-in for an image-only/scanned page. With
    ``draw_rect_on_blank`` such a page also gets a filled rectangle so it is a
    faithful image-only analogue (still zero extractable text).
    """
    _ensure_arabic_font()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    for words in pages:
        if not words and draw_rect_on_blank:
            c.setFillGray(0.6)
            c.rect(100, 400, 300, 200, fill=1, stroke=0)
            c.setFillGray(0.0)
        for w in words:
            if w.arabic:
                c.setFont(ARABIC_FONT, font_size)
                c.drawString(w.x, w.y, shape_arabic(w.text))
            else:
                c.setFont("Helvetica", font_size)
                c.drawString(w.x, w.y, w.text)
        c.showPage()
    c.save()
    return buf.getvalue()


def simple_lines_pdf(pages_lines, x: float = 72, top: float = 720,
                     leading: float = 20) -> bytes:
    """Convenience: build an LTR PDF from ``pages_lines`` — a list of pages,
    each a list of single-token line strings stacked top-to-bottom."""
    pages = []
    for lines in pages_lines:
        words = [Word(x, top - i * leading, text) for i, text in enumerate(lines)]
        pages.append(words)
    return build_pdf(pages)
