import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from documents import SUPPORTED_EXTENSIONS, DocumentParseError, extract_text
from model import DeepSeekMentor

load_dotenv()

# Per-client rate limit, configurable via the RATE_LIMIT env var.
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Waaie API",
    description=(
        "DeepSeek-powered AI study mentor for Saudi high school subjects — "
        "Mathematics, Physics, Chemistry, Biology/Earth & Space Sciences, and "
        "Digital Technology & Computer Science (Arabic & English)."
    ),
    version="2.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Minimal security headers on every response.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

# Setup CORS — origins are configurable via the CORS_ORIGINS env var
# (comma-separated). Defaults to the local React dev server.
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the DeepSeek-backed mentor. Fails fast if DEEPSEEK_API_KEY is unset.
mentor = DeepSeekMentor()


RATE_LIMIT = os.getenv("RATE_LIMIT", "20/minute")

# Maximum accepted upload size for /ask-document (bytes). Configurable via env.
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024

# Default prompt used when a document is uploaded without a typed question.
DEFAULT_DOC_PROMPT = "لخّص محتوى هذا المستند وأبرز أهم النقاط الدراسية فيه."


class Question(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description=(
            "A Saudi high-school subject question — Mathematics, Physics, "
            "Chemistry, Biology/Earth & Space Sciences, or Digital "
            "Technology & Computer Science — to ask the mentor."
        ),
    )

    model_config = {
        "json_schema_extra": {
            "example": {"question": "اشرح قانون نيوتن الثاني للحركة مع مثال"}
        }
    }


@app.get("/")
async def root():
    return {
        "message": "Welcome to the Waaie API",
        "version": "2.0.0",
        "endpoints": {
            "POST /ask": (
                "Ask a Saudi high-school subject question — math, physics, "
                "chemistry, biology/earth & space, or digital technology "
                "(Arabic or English)"
            ),
            "POST /ask-document": (
                "Upload a study document ("
                + ", ".join(SUPPORTED_EXTENSIONS)
                + ") and ask a question about its contents"
            ),
            "GET /health": "Check API health status",
        },
    }


@app.post("/ask")
@limiter.limit(RATE_LIMIT)
async def ask_question(request: Request, question: Question):
    try:
        result = mentor.get_answer(question.question)
        return {
            "status": "success",
            "message": "Answer generated",
            "data": {
                "answer": result["answer"],
                "language": result["language"],
            },
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {e}")


@app.post("/ask-document")
@limiter.limit(RATE_LIMIT)
async def ask_document(
    request: Request,
    file: UploadFile = File(...),
    question: str = Form(""),
):
    data = await file.read()

    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File is too large. The maximum size is {limit_mb} MB.",
        )

    try:
        document_text = extract_text(file.filename, data)
    except DocumentParseError as de:
        raise HTTPException(status_code=400, detail=str(de))

    prompt = question.strip() or DEFAULT_DOC_PROMPT

    try:
        result = mentor.get_answer(prompt, context=document_text)
        return {
            "status": "success",
            "message": "Answer generated from document",
            "data": {
                "answer": result["answer"],
                "language": result["language"],
                "filename": file.filename,
            },
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {e}")


@app.get("/ask")
async def ask_not_allowed():
    raise HTTPException(
        status_code=405,
        detail=(
            "Method Not Allowed. Use POST to /ask with a JSON body "
            "containing your question."
        ),
    )


@app.get("/health")
async def health_check():
    try:
        assert mentor.client is not None
        return {
            "status": "healthy",
            "model": mentor.model,
            "provider": "deepseek",
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Service Unhealthy: {str(e)}",
        )
