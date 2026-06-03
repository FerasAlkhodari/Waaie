import axios from 'axios';

const BACKEND_URL =
  process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';

// Ngrok's free tier serves an HTML interstitial warning page to browser-like
// requests; that page carries no CORS headers, so the browser surfaces it as a
// CORS failure. This header tells ngrok to skip the interstitial and forward
// straight to the FastAPI backend. Harmless when the backend isn't behind ngrok.
const NGROK_SKIP_HEADER = { 'ngrok-skip-browser-warning': 'true' };

// Every request carries the active session id BOTH as the X-Session-Id header
// and inside the payload (JSON field for /ask, form field for /ask-document),
// so the backend can read whichever it prefers. The backend keys its in-memory
// conversation history off this id, giving each client-side session its own
// multi-turn memory and uploaded-document context.

export async function askQuestion({ question, sessionId }) {
  const { data } = await axios.post(
    `${BACKEND_URL}/ask`,
    { question, session_id: sessionId },
    { headers: { 'X-Session-Id': sessionId, ...NGROK_SKIP_HEADER } },
  );
  return data;
}

export async function askDocument({ file, question, sessionId }) {
  const form = new FormData();
  form.append('file', file);
  form.append('question', question);
  form.append('session_id', sessionId);
  // Do NOT set Content-Type manually — the browser must add the multipart
  // boundary itself, or the upload will be unparseable on the server.
  const { data } = await axios.post(`${BACKEND_URL}/ask-document`, form, {
    headers: { 'X-Session-Id': sessionId, ...NGROK_SKIP_HEADER },
  });
  return data;
}

export { BACKEND_URL };
