import json
import re

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app
from tests.contract import EN_ANSWER, MIXED_IN_SCOPE_ANSWER, REFUSAL_MESSAGE

client = TestClient(app)


def _collect_sse(body):
    """Parse a Server-Sent Events body into a list of decoded event dicts."""
    events = []
    for line in body.splitlines():
        if line.startswith("data:"):
            events.append(json.loads(line[len("data:") :].strip()))
    return events


def test_root_index():
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert "endpoints" in body
    assert body["version"]


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["provider"] == "deepseek"
    assert body["model"]


def test_ask_question_success():
    response = client.post("/ask", json={"question": "What is the CPU?"})
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "success"
    assert data["data"]["language"] == "en"
    assert data["data"]["answer"], "Response should include a non-empty answer."


def test_ask_question_arabic():
    # End-to-end: Arabic question -> Arabic answer, flagged as Arabic.
    response = client.post("/ask", json={"question": "ما هو المعالج المركزي؟"})
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "success"
    assert data["data"]["language"] == "ar"
    assert re.search(r"[؀-ۿ]", data["data"]["answer"]), \
        "Arabic question should yield an Arabic answer."


def test_empty_question():
    # Empty strings are rejected by request validation (min_length=1).
    response = client.post("/ask", json={"question": ""})
    assert response.status_code == 422
    assert "detail" in response.json()


def test_oversized_question():
    # Questions over the max length are rejected by request validation.
    response = client.post("/ask", json={"question": "a" * 4001})
    assert response.status_code == 422


def test_ask_get_not_allowed():
    response = client.get("/ask")
    assert response.status_code == 405


# --------------------------------------------------------------------------- #
# Token streaming — POST /ask-stream emits SSE meta/delta/done frames.
# --------------------------------------------------------------------------- #

def test_ask_stream_success():
    response = client.post("/ask-stream", json={"question": "What is the CPU?"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _collect_sse(response.text)
    types = [e["type"] for e in events]

    # Protocol: a leading meta frame, one or more deltas, a terminal done frame.
    assert types[0] == "meta"
    assert types[-1] == "done"
    assert "delta" in types

    meta = events[0]
    assert meta["language"] == "en"
    assert meta["session_id"]

    # Deltas reconstruct the full in-scope answer.
    streamed = "".join(e["text"] for e in events if e["type"] == "delta").strip()
    assert streamed == EN_ANSWER


def test_ask_stream_arabic_language_flag():
    response = client.post(
        "/ask-stream", json={"question": "ما هو المعالج المركزي؟"}
    )
    assert response.status_code == 200
    events = _collect_sse(response.text)
    assert events[0]["type"] == "meta"
    assert events[0]["language"] == "ar"
    assert events[-1]["type"] == "done"


def test_ask_stream_invalid_input_rejected():
    # Validation still applies before streaming starts (empty question).
    response = client.post("/ask-stream", json={"question": ""})
    assert response.status_code == 422


def test_answer_events_is_async_generator():
    """Regression guard: the SSE generator MUST be an async generator.

    A *sync* generator wrapped in ``StreamingResponse`` silently yields an EMPTY
    body on newer runtimes (Python 3.14 / Starlette 1.x) — the endpoint returns
    200 but streams zero tokens, so the live chat typing/word-by-word stops.
    Pinning the async shape keeps that breakage from sneaking back in (it can
    pass by luck on older Python but breaks the deployed path)."""
    import inspect

    assert inspect.isasyncgenfunction(app_module._answer_events), (
        "_answer_events must be `async def` (an async generator); a sync "
        "generator produces an empty StreamingResponse body on Starlette 1.x."
    )


@pytest.mark.parametrize("invalid_input", [
    {"wrong_field": "question"},
    {},
    {"question": None},
])
def test_invalid_input(invalid_input):
    response = client.post("/ask", json=invalid_input)
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# Guardrail contract — the three core scope scenarios over HTTP (POST /ask).
# --------------------------------------------------------------------------- #

def test_scenario_a_in_scope_returns_200_and_structure():
    """(a) Valid in-scope query -> 200 OK with the full success envelope."""
    response = client.post(
        "/ask", json={"question": "Solve the equation x^2 - 5x + 6 = 0"}
    )
    assert response.status_code == 200

    body = response.json()
    assert body["status"] == "success"
    assert body["message"] == "Answer generated"
    assert set(body["data"]) == {"answer", "language"}
    assert body["data"]["language"] == "en"
    assert body["data"]["answer"].strip()
    assert body["data"]["answer"] != REFUSAL_MESSAGE


@pytest.mark.parametrize(
    "question",
    [
        "كيف أطبخ الكبسة؟",          # cooking (Arabic)
        "Give me a recipe for pasta",  # cooking (English -> refused in Arabic)
        "من فاز في مباراة كرة القدم؟",  # sports (out of curriculum scope)
    ],
)
def test_scenario_b_out_of_scope_exact_arabic_refusal(question):
    """(b) Out-of-scope -> 200 OK and body contains EXACTLY the refusal."""
    response = client.post("/ask", json={"question": question})
    assert response.status_code == 200

    answer = response.json()["data"]["answer"]
    assert answer == REFUSAL_MESSAGE
    assert answer.strip() == REFUSAL_MESSAGE  # zero additional text


def test_scenario_c_mixed_query_answers_in_scope_only():
    """(c) Mixed -> answers TCP/IP, never the pasta recipe."""
    response = client.post(
        "/ask",
        json={"question": "Explain TCP/IP and give me a pasta recipe"},
    )
    assert response.status_code == 200

    answer = response.json()["data"]["answer"]
    answer_lower = answer.lower()
    assert "tcp/ip" in answer_lower
    assert "pasta" not in answer_lower
    assert "recipe" not in answer_lower
    assert answer == MIXED_IN_SCOPE_ANSWER


# --------------------------------------------------------------------------- #
# Error mapping — upstream failure and health degradation.
# --------------------------------------------------------------------------- #

def test_upstream_failure_maps_to_502(monkeypatch):
    """Any non-ValueError from the model surfaces as 502 Bad Gateway."""
    def _boom(_question):
        raise RuntimeError("simulated DeepSeek outage")

    monkeypatch.setattr(app_module.mentor, "get_answer", _boom)

    response = client.post("/ask", json={"question": "What is TCP?"})
    assert response.status_code == 502
    assert "DeepSeek request failed" in response.json()["detail"]


def test_health_unhealthy_maps_to_503(monkeypatch):
    """If the DeepSeek client is missing, /health reports 503."""
    monkeypatch.setattr(app_module.mentor, "client", None)

    response = client.get("/health")
    assert response.status_code == 503
    assert "Unhealthy" in response.json()["detail"]
