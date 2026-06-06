"""Build per-subject *grounding-context* assets for the Interactive Question
Generator (صانع الأسئلة التفاعلي).

The product generates quiz questions live with DeepSeek; these assets are the
per-subject grounding the generator is conditioned on — NOT pre-baked Q/A. For
the three subjects whose exam paper is machine-readable (Physics, Math, English)
the context is the real exam text, extracted with the project's own
``documents.py`` pipeline (so Arabic ordering / NFKC normalization are applied
consistently). For the three with no usable source — Biology (no file), Earth
Science (cover-page-only .docx) and Chemistry (legacy .doc, unreadable by
python-docx) — the context is a curated Saudi-curriculum topic outline authored
here.

Run once (offline, deterministic — no network, docx parsing only) to regenerate
``backend/data/exam_banks/*.json``:

    python -m scripts.build_exam_banks         # from the backend/ directory

The committed JSON is what the runtime loads; the docx files are only needed to
rebuild. Output is stable: same inputs → identical JSON.
"""

import glob
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from documents import extract_text  # noqa: E402

DOCS_DIR = BACKEND_DIR.parent / "docs"
OUT_DIR = BACKEND_DIR / "data" / "exam_banks"

# Per-subject grounding context is capped so the generation prompt stays lean.
MAX_CONTEXT_CHARS = 6000


# Subjects whose exam paper is machine-readable: (id, ar, en, docx keyword).
_EXAM_SUBJECTS = [
    ("physics", "الفيزياء", "Physics", "فيزياء"),
    ("math", "الرياضيات", "Mathematics", "رياضيات"),
    ("english", "اللغة الإنجليزية", "English", "الانجليزي"),
]

# Subjects with no usable source exam → authored Saudi third-secondary
# (المسارات) curriculum outlines used as generation grounding.
_CURRICULUM_SUBJECTS = {
    "biology": {
        "name_ar": "الأحياء",
        "name_en": "Biology",
        "language": "ar",
        "reason": "no source exam file available",
        "topics": [
            "الوراثة الجزيئية: تركيب DNA وRNA وتضاعف الحمض النووي",
            "التعبير الجيني: النسخ والترجمة وتخليق البروتين",
            "الانقسام الخلوي: المتساوي والمنصّف ودورة الخلية",
            "الطفرات الوراثية وأنواعها وآثارها",
            "التقنية الحيوية والهندسة الوراثية وتطبيقاتها",
            "جهاز المناعة وخطوط الدفاع والاستجابة المناعية",
            "الجهاز العصبي والغدد الصمّاء وتنظيم الجسم",
            "التكاثر في الإنسان والنمو الجنيني",
            "علم البيئة: النظام البيئي والسلاسل والشبكات الغذائية",
            "دورات العناصر (الكربون والنيتروجين) والتوازن البيئي",
        ],
    },
    "earth_science": {
        "name_ar": "علوم الأرض والفضاء",
        "name_en": "Earth & Space Science",
        "language": "ar",
        "reason": "source .docx is a cover page only (no questions)",
        "topics": [
            "المعادن والصخور وأنواعها (نارية، رسوبية، متحولة)",
            "دورة الصخور وعمليات التجوية والتعرية والترسيب",
            "الصفائح التكتونية وحركتها ونظرية زحزحة القارات",
            "الزلازل والبراكين وأسبابها وقياسها",
            "الغلاف الجوي وطبقاته وعناصر الطقس والمناخ",
            "الغلاف المائي: المحيطات والتيارات والدورة المائية",
            "المجموعة الشمسية: الكواكب والأقمار والكويكبات والمذنّبات",
            "النجوم: دورة حياتها وتصنيفها ومخطط هرتزشبرونغ-رسل",
            "المجرّات وأنواعها وبنية الكون",
            "نشأة الكون ونظرية الانفجار العظيم والأدلة عليها",
        ],
    },
    "chemistry": {
        "name_ar": "الكيمياء",
        "name_en": "Chemistry",
        "language": "ar",
        "reason": "source file is legacy .doc (unreadable by python-docx)",
        "topics": [
            "الكيمياء الحرارية: المحتوى الحراري والإنثالبي وقانون هس",
            "معدل التفاعل الكيميائي والعوامل المؤثرة فيه",
            "الاتزان الكيميائي وثابت الاتزان ومبدأ لوشاتلييه",
            "الأحماض والقواعد: نظرياتها وقوة الحمض وحساب pH",
            "تفاعلات التعادل والمحاليل المنظِّمة (البفر)",
            "الكيمياء الكهربائية: خلايا جلفانية وتحليلية والتأكسد والاختزال",
            "التفاعلات النووية: الاضمحلال الإشعاعي وعمر النصف",
            "المحاليل: التركيز والمولارية وخصائص المحاليل التجمّعية",
            "الكيمياء العضوية: الهيدروكربونات والمجموعات الوظيفية",
            "التسمية الكيميائية ومعادلات التفاعل وموازنتها",
        ],
    },
}


def _extract_exam_context(keyword: str):
    """Extract grounding text from the subject's exam .docx via documents.py.
    Returns (text, source_filename) or (None, None) if no readable file."""
    matches = [
        p
        for p in glob.glob(str(DOCS_DIR / "*"))
        if keyword in os.path.basename(p) and p.lower().endswith(".docx")
    ]
    if not matches:
        return None, None
    path = matches[0]
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        text = extract_text(os.path.basename(path), data)
    except Exception:
        return None, os.path.basename(path)
    return text.strip()[:MAX_CONTEXT_CHARS], os.path.basename(path)


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written = []

    for subject_id, name_ar, name_en, keyword in _EXAM_SUBJECTS:
        context, source_file = _extract_exam_context(keyword)
        if context:
            asset = {
                "id": subject_id,
                "name_ar": name_ar,
                "name_en": name_en,
                "language": "en" if subject_id == "english" else "ar",
                "source": "exam",
                "source_file": source_file,
                "topics": [],
                "context": context,
            }
        else:
            # Fallback: readable file missing/empty → leave a minimal context so
            # the generator can still work from curriculum knowledge.
            asset = {
                "id": subject_id,
                "name_ar": name_ar,
                "name_en": name_en,
                "language": "en" if subject_id == "english" else "ar",
                "source": "curriculum",
                "source_file": source_file,
                "topics": [],
                "context": f"{name_en} — Saudi third-year secondary curriculum.",
            }
        _write(subject_id, asset, written)

    for subject_id, meta in _CURRICULUM_SUBJECTS.items():
        context = (
            f"{meta['name_ar']} — منهج الصف الثالث الثانوي (المسارات). "
            "أبرز الموضوعات:\n- " + "\n- ".join(meta["topics"])
        )
        asset = {
            "id": subject_id,
            "name_ar": meta["name_ar"],
            "name_en": meta["name_en"],
            "language": meta["language"],
            "source": "curriculum",
            "source_file": None,
            "source_note": meta["reason"],
            "topics": meta["topics"],
            "context": context,
        }
        _write(subject_id, asset, written)

    print(f"Wrote {len(written)} subject assets to {OUT_DIR}:")
    for name in written:
        print("  -", name)


def _write(subject_id: str, asset: dict, written: list) -> None:
    out_path = OUT_DIR / f"{subject_id}.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(asset, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    written.append(out_path.name)


if __name__ == "__main__":
    build()
