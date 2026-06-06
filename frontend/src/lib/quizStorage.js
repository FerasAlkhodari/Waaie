// Local persistence for in-progress quizzes (بنك الأسئلة) — Session Resume.
//
// The quiz is 100% stateless on the server: the entire run (the pre-fetched,
// pre-sealed questions + the running index/score + the per-question review) is
// generated once and then lives only in the browser. We mirror that live state
// into localStorage on every transition, so closing the tab or navigating away
// mid-quiz loses nothing.
//
// Quizzes are keyed BY SUBJECT — `{ physics: state, chemistry: state }` — so an
// unfinished physics quiz is NOT clobbered when the student starts chemistry;
// the home screen can offer a resume card for each unfinished subject at once.
// The sealed tokens are stored verbatim and still verify on resume (QUIZ_SECRET
// is stable server-side), so resuming needs NO new model call.
//
// Everything is defensive: storage can be unavailable (private mode, quota), and
// a payload from an older/incompatible build must never crash the panel — any
// problem simply means "nothing resumable".

const STORAGE_KEY = 'waaie.quiz.active.v2';
const SCHEMA_VERSION = 2;

function safeLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Accessing localStorage can throw in sandboxed iframes / blocked cookies.
    return null;
  }
}

// Minimal shape guard: a resumable quiz must know its subject, carry its
// questions, and still be unfinished. Anything off → treat as not resumable.
function isResumable(state) {
  return Boolean(
    state &&
      state.config &&
      typeof state.config.subject === 'string' &&
      Array.isArray(state.questions) &&
      state.questions.length > 0 &&
      Number.isInteger(state.index) &&
      state.index >= 0 &&
      state.index < state.questions.length,
  );
}

// Read the whole subject→record map, defensively. Returns {} on any problem.
function readAll() {
  const store = safeLocalStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.v !== SCHEMA_VERSION ||
      !parsed.quizzes ||
      typeof parsed.quizzes !== 'object'
    ) {
      return {};
    }
    return parsed.quizzes;
  } catch {
    return {};
  }
}

function writeAll(quizzes) {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ v: SCHEMA_VERSION, quizzes }));
  } catch {
    // Quota / serialization failure is non-fatal — the quiz keeps working in
    // memory; only resume-after-close is lost.
  }
}

// Persist (or update) the live quiz for one subject. `payload` carries
// everything needed to resume with no network call: the config, the pre-sealed
// questions, the current index, the score, and the review so far.
export function saveActiveQuiz(subject, payload) {
  if (!subject || !payload) return;
  const quizzes = readAll();
  quizzes[subject] = { ...payload, subject, savedAt: Date.now() };
  writeAll(quizzes);
}

// The saved quiz for one subject, if it exists AND is still resumable, else null.
export function loadActiveQuiz(subject) {
  const record = readAll()[subject];
  return isResumable(record) ? record : null;
}

// Every resumable quiz, most-recently-saved first — drives the home resume list.
export function loadAllActiveQuizzes() {
  const quizzes = readAll();
  return Object.values(quizzes)
    .filter(isResumable)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

// Drop one subject's saved quiz (on completion / discard / fresh restart). Pass
// no subject to clear them all.
export function clearActiveQuiz(subject) {
  const quizzes = readAll();
  if (subject == null) {
    writeAll({});
    return;
  }
  if (quizzes[subject]) {
    delete quizzes[subject];
    writeAll(quizzes);
  }
}
