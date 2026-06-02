"""In-memory, per-session conversation memory for Waaie.

Lightweight and process-local: maps a ``session_id`` to its recent chat turns
and to the text of any document uploaded in that session. History is capped to
the last ``max_messages`` entries so token usage stays bounded no matter how
long a conversation runs.

This is intentionally simple (a dict guarded by a lock) — suitable for a
single-process dev/Coolify deployment. For multi-worker or multi-instance
deployments, swap this implementation for Redis or a database without changing
the call sites in ``app.py``.
"""

import threading
from typing import Dict, List, Optional, TypedDict


class Message(TypedDict):
    role: str
    content: str


class _Session:
    __slots__ = ("messages", "document")

    def __init__(self) -> None:
        self.messages: List[Message] = []
        self.document: Optional[str] = None


class SessionStore:
    def __init__(self, max_messages: int = 20) -> None:
        # 20 messages == the last 10 user/assistant turns. The current question
        # is always sent on top of this window, so the model sees recent
        # context without unbounded prompt growth.
        self.max_messages = max_messages
        self._sessions: Dict[str, _Session] = {}
        self._lock = threading.Lock()

    def _get_or_create(self, session_id: str) -> _Session:
        session = self._sessions.get(session_id)
        if session is None:
            session = _Session()
            self._sessions[session_id] = session
        return session

    def history(self, session_id: str) -> List[Message]:
        """Recent prior turns for this session (excludes the system prompt)."""
        with self._lock:
            session = self._sessions.get(session_id)
            return list(session.messages) if session else []

    def document(self, session_id: str) -> Optional[str]:
        """Text of the document uploaded earlier in this session, if any."""
        with self._lock:
            session = self._sessions.get(session_id)
            return session.document if session else None

    def set_document(self, session_id: str, text: str) -> None:
        with self._lock:
            self._get_or_create(session_id).document = text

    def add_turn(self, session_id: str, question: str, answer: str) -> None:
        """Append one user->assistant exchange, then trim to the window.

        Only the raw question text is stored (never the full document body),
        so re-sending history stays cheap; the document is supplied separately
        and just once per turn.
        """
        with self._lock:
            session = self._get_or_create(session_id)
            session.messages.append({"role": "user", "content": question})
            session.messages.append({"role": "assistant", "content": answer})
            if len(session.messages) > self.max_messages:
                session.messages = session.messages[-self.max_messages :]
