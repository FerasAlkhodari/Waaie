import { useCallback, useEffect, useMemo, useState } from 'react';

// Versioned key so the schema can evolve without colliding with old data.
const STORAGE_KEY = 'chat_sessions_v1';
const DEFAULT_TITLE = 'محادثة جديدة';
const TITLE_MAX = 40;

// crypto.randomUUID is only available in secure contexts (https/localhost) on
// modern browsers. Fall back to an RFC4122-shaped id elsewhere so older or
// non-secure environments never crash.
function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the manual generator */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function blankSession() {
  return { id: newId(), title: DEFAULT_TITLE, timestamp: Date.now(), messages: [] };
}

function deriveTitle(messages, fallback = DEFAULT_TITLE) {
  const firstUser = messages.find((m) => m && m.sender === 'user' && m.text);
  if (!firstUser) return fallback;
  const text = String(firstUser.text).replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX).trim()}…` : text;
}

function mostRecent(list) {
  return list.reduce((a, b) => (b.timestamp > a.timestamp ? b : a), list[0]);
}

function loadSessions() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Keep only well-formed records so a corrupted entry can't poison the list.
    return parsed
      .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.messages))
      .map((s) => ({
        id: s.id,
        title: typeof s.title === 'string' ? s.title : DEFAULT_TITLE,
        timestamp: typeof s.timestamp === 'number' ? s.timestamp : Date.now(),
        messages: s.messages,
      }));
  } catch {
    return null;
  }
}

function saveSessions(sessions) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* over-quota or storage disabled — keep the in-memory state usable */
  }
}

export default function useSessions() {
  // Resolve the initial state exactly once: load existing sessions and activate
  // the most recent, or seed a single fresh session.
  const initial = useMemo(() => {
    const loaded = loadSessions();
    const list = loaded && loaded.length ? loaded : [blankSession()];
    return { list, activeId: mostRecent(list).id };
  }, []);

  const [sessions, setSessions] = useState(initial.list);
  const [activeSessionId, setActiveSessionId] = useState(initial.activeId);

  // Persist on every change.
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const createSession = useCallback(() => {
    const session = blankSession();
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    return session.id;
  }, []);

  const switchSession = useCallback((id) => {
    setActiveSessionId(id);
  }, []);

  const deleteSession = useCallback(
    (id) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const session = blankSession();
          setActiveSessionId(session.id);
          return [session];
        }
        setActiveSessionId((current) =>
          current === id ? mostRecent(next).id : current,
        );
        return next;
      });
    },
    [],
  );

  // Replace the active session's messages, refreshing its title + recency.
  const setActiveMessages = useCallback(
    (messages) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSessionId
            ? {
                id: s.id,
                title: deriveTitle(messages, s.title),
                timestamp: Date.now(),
                messages,
              }
            : s,
        ),
      );
    },
    [activeSessionId],
  );

  const activeSession =
    sessions.find((s) => s.id === activeSessionId) || sessions[0];

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    switchSession,
    deleteSession,
    setActiveMessages,
  };
}
