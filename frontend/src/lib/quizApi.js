import axios from 'axios';

import { BACKEND_URL } from './sessionApi';

// Same ngrok interstitial bypass the chat client uses (harmless off ngrok).
const NGROK_SKIP_HEADER = { 'ngrok-skip-browser-warning': 'true' };

// --- Interactive Question Generator (صانع الأسئلة التفاعلي) -------------------
// The quiz is fully stateless on the server: the whole quiz state (subject,
// difficulty, length, index, score) round-trips in these payloads, and each
// question's correct answer rides back inside the opaque `token`.

export async function fetchQuizSubjects() {
  const { data } = await axios.get(`${BACKEND_URL}/quiz/subjects`, {
    headers: { ...NGROK_SKIP_HEADER },
  });
  return data.subjects;
}

// Generate the WHOLE quiz in one bulk call — the "يتم صناعة الأسئلة..." step.
// Returns the full array of pre-sealed question payloads; the client then
// advances between them with zero latency and only grades per answer. `total`
// in the response reflects how many questions were actually built.
export async function startQuiz({ subject, difficulty, total }) {
  const { data } = await axios.post(
    `${BACKEND_URL}/quiz/start`,
    { subject, difficulty, total },
    { headers: { ...NGROK_SKIP_HEADER } },
  );
  return data.questions;
}

// Resolve a spoken answer to an option index (instant, server-side, no model
// call). `alternatives` are the STT engine's N-best hypotheses, tried in order
// if the primary transcript misses. Returns { index, transcript, matched_via };
// index === -1 means nothing matched confidently.
export async function matchVoiceAnswer({
  transcript,
  alternatives = [],
  options,
  language,
}) {
  const { data } = await axios.post(
    `${BACKEND_URL}/quiz/voice-match`,
    { transcript, alternatives, options, language },
    { headers: { ...NGROK_SKIP_HEADER } },
  );
  return data;
}

// Generate one question — the "يتم صناعة السؤال..." step. `number` is 1-based;
// `asked` is the list of already-shown question texts (anti-repetition).
export async function generateQuizQuestion({
  subject,
  difficulty,
  total,
  number,
  asked,
}) {
  const { data } = await axios.post(
    `${BACKEND_URL}/quiz/question`,
    { subject, difficulty, total, number, asked },
    { headers: { ...NGROK_SKIP_HEADER } },
  );
  return data.question;
}

// Grade one answer (instant — no model call). Returns
// { result: {correct, correct_index, explanation, number}, quiz: {...}, final }.
export async function gradeQuizAnswer({ quiz, token, selected }) {
  const { data } = await axios.post(
    `${BACKEND_URL}/quiz/answer`,
    { quiz, token, selected },
    { headers: { ...NGROK_SKIP_HEADER } },
  );
  return data;
}
