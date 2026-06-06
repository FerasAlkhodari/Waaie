"""Shared pytest setup: offline key + guardrail-aware DeepSeek patch.

These tests run fully offline and without a real DeepSeek API key. We set a
dummy key and replace ``openai.OpenAI`` with the guardrail-aware ``FakeClient``
from ``tests.contract`` so ``chat.completions.create`` emulates the scope
contract encoded in ``model.SYSTEM_INSTRUCTION`` — with zero network calls.

The patch is applied at import time — before any test module imports ``app``
(which builds a DeepSeekMentor at module load) — so the real network client is
never constructed.
"""

import os
import sys
import warnings
from pathlib import Path

import pytest

# Make the backend package importable (model.py, app.py live one level up).
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# A dummy key satisfies DeepSeekMentor's fail-fast check without being real.
os.environ.setdefault("DEEPSEEK_API_KEY", "test-key-not-real")

import openai  # noqa: E402

from tests.contract import FakeClient  # noqa: E402

# Patch the SDK entry point so no real network client is ever created. This
# runs before any test imports ``model``/``app``, so model.py's
# ``from openai import OpenAI`` picks up the fake.
openai.OpenAI = FakeClient


@pytest.fixture(autouse=True)
def ignore_warnings():
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=FutureWarning)
        warnings.filterwarnings("ignore", category=UserWarning)
        warnings.filterwarnings("ignore", category=DeprecationWarning)
        yield


@pytest.fixture(autouse=True)
def disable_rate_limiter():
    """Turn the per-client rate limiter OFF for the test process only.

    The limiter's in-memory window is shared across the whole session, so a suite
    that legitimately calls a rate-limited endpoint more than RATE_LIMIT times
    would otherwise get spurious 429s — an artefact of test volume, not of the
    behaviour under test (no test asserts rate limiting). Production keeps the
    limiter fully enabled; only this process disables it.
    """
    try:
        from app import limiter

        limiter.enabled = False
    except Exception:  # pragma: no cover - app import is exercised everywhere else
        pass
    yield
