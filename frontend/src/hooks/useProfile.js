import { useCallback, useState } from 'react';

// Lightweight, local-only onboarding identity. Persisted to localStorage so a
// student doesn't re-enter their name/email on every refresh during a session.
// Nothing is sent to the server — this is purely a personalization touch.
const STORAGE_KEY = 'waaie_profile_v1';

function loadProfile() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Only accept a well-formed record so a corrupted entry can't wedge the
    // app behind a broken gate.
    if (
      parsed &&
      typeof parsed.name === 'string' &&
      typeof parsed.email === 'string' &&
      parsed.name.trim() &&
      parsed.email.trim()
    ) {
      return { name: parsed.name, email: parsed.email };
    }
    return null;
  } catch {
    return null;
  }
}

export default function useProfile() {
  // Resolve from storage exactly once on mount.
  const [profile, setProfile] = useState(loadProfile);

  const saveProfile = useCallback((next) => {
    const clean = {
      name: String(next?.name ?? '').trim(),
      email: String(next?.email ?? '').trim(),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* storage disabled / over quota — keep the in-memory profile usable */
    }
    setProfile(clean);
  }, []);

  const clearProfile = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    setProfile(null);
  }, []);

  return { profile, saveProfile, clearProfile };
}
