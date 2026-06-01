import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from model import GeminiMentor

load_dotenv()

# Per-client rate limit, configurable via the RATE_LIMIT env var.
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Waaie API",
    description="Gemini-powered IT & Cybersecurity tutor (Arabic & English)",
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

# Initialize the Gemini-backed mentor. Fails fast if GEMINI_API_KEY is unset.
mentor = GeminiMentor()


RATE_LIMIT = os.getenv("RATE_LIMIT", "20/minute")


class Question(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=4000,
        description="The IT / Cybersecurity question to ask the mentor.",
    )

    model_config = {
        "json_schema_extra": {
            "example": {"question": "What is the CIA triad in cybersecurity?"}
        }
    }


@app.get("/")
async def root():
    return {
        "message": "Welcome to the Waaie API",
        "version": "2.0.0",
        "endpoints": {
            "POST /ask": "Ask an IT / Cybersecurity question (Arabic or English)",
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
        raise HTTPException(status_code=502, detail=f"Gemini request failed: {e}")


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
            "provider": "gemini",
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Service Unhealthy: {str(e)}",
        )
