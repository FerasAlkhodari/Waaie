import os
import re
from typing import Dict, Optional

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-2.5-flash"

SYSTEM_INSTRUCTION = (
    "You are Waaie (واعي), a professional, friendly, and expert IT and "
    "Cybersecurity instructor. Your primary job is to explain computing "
    "concepts to students ranging from absolute beginners to intermediate "
    "learners. You must masterfully cover topics like computer hardware, "
    "peripheral devices, operating systems, networking basics (OSI layers, "
    "protocols, ports), and cybersecurity fundamentals (the CIA triad, "
    "malware, phishing). Always reply fluently and naturally in the exact "
    "language the student uses (Arabic or English). Use clear explanations, "
    "structured bullet points, and code blocks where necessary to optimize "
    "learning.\n\n"
    "STRICT SCOPE — this is a hard rule you must never break:\n"
    "You ONLY answer questions within Computer Science and Information "
    "Technology. In-scope domains include: programming and software "
    "engineering, algorithms and data structures, computer hardware and "
    "architecture, operating systems, computer networking, databases, "
    "DevOps and cloud, cybersecurity, and artificial intelligence / machine "
    "learning.\n"
    "You MUST politely refuse anything outside this scope — for example "
    "cooking, history, geography, sports, politics, medicine, general life "
    "advice, or pure mathematics (such as calculus, differentiation, or "
    "integration) UNLESS the math is framed directly within a Computer "
    "Science or Machine Learning context.\n"
    "When a request is out of scope, do NOT attempt to answer it. Decline "
    "elegantly and in Arabic with exactly this message:\n"
    '"أنا هنا كمساعد ومتخصص في مجالات علوم الحاسب وتقنية المعلومات فقط. '
    'يسعدني الإجابة على أي سؤال يخص البرمجة، الشبكات، أو الأمن السيبراني!"\n'
    "Do not add any other explanation or content when refusing. If a "
    "question mixes in-scope and out-of-scope parts, answer only the "
    "in-scope part and ignore the rest."
)

_ARABIC_RE = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿ]")


def detect_language(text: str) -> str:
    """Return 'ar' if the text contains Arabic script, otherwise 'en'."""
    return "ar" if _ARABIC_RE.search(text or "") else "en"


class GeminiMentor:
    """Thin wrapper around the Google Gemini API for the Waaie persona.

    The API key is read exclusively from the environment so it never has to
    live in source. Construction fails fast if the key is missing.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ):
        api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is required. "
                "Copy backend/.env.example to backend/.env and set it."
            )

        self.model = model or os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
        self.client = genai.Client(api_key=api_key)

    def get_answer(self, question: str) -> Dict[str, str]:
        if not question or not question.strip():
            raise ValueError("Question cannot be empty")

        language = detect_language(question)

        response = self.client.models.generate_content(
            model=self.model,
            contents=question,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
            ),
        )

        answer = (response.text or "").strip()
        if not answer:
            raise RuntimeError("Gemini returned an empty response")

        return {"answer": answer, "language": language}
