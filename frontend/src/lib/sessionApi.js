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

// --- Token streaming (Server-Sent Events) -----------------------------------
// The streaming endpoints push the answer as it is generated, framed as SSE
// `data: {json}` lines (see backend app.py `_answer_events`). We read the
// response body incrementally and invoke `onDelta(textChunk)` for each token as
// it arrives. The returned promise RESOLVES when the stream finishes cleanly
// and REJECTS on a non-OK status, a transport break, or an in-band `error`
// frame — so the caller's existing catch can show the localized fallback
// whether the stream failed to initialize or broke midway.

async function consumeSSE(response, { onMeta, onDelta }) {
  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let errored = false;

  // Parse every complete `\n\n`-terminated frame currently in the buffer.
  const drain = () => {
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      let evt;
      try {
        evt = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue; // ignore malformed/partial frames defensively
      }
      if (evt.type === 'meta') onMeta?.(evt);
      else if (evt.type === 'delta') onDelta?.(evt.text);
      else if (evt.type === 'error') errored = true;
      // 'done' needs no action — the read loop ends when the body closes.
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drain();
    if (errored) break;
  }
  buffer += decoder.decode();
  drain();

  if (errored) {
    throw new Error('Stream signalled an error');
  }
}

export async function askQuestionStream({ question, sessionId, onMeta, onDelta }) {
  const response = await fetch(`${BACKEND_URL}/ask-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Id': sessionId,
      ...NGROK_SKIP_HEADER,
    },
    body: JSON.stringify({ question, session_id: sessionId }),
  });
  await consumeSSE(response, { onMeta, onDelta });
}

export async function askDocumentStream({
  file,
  question,
  sessionId,
  onMeta,
  onDelta,
}) {
  const form = new FormData();
  form.append('file', file);
  form.append('question', question);
  form.append('session_id', sessionId);
  // Do NOT set Content-Type manually — the browser must add the multipart
  // boundary itself, or the upload will be unparseable on the server.
  const response = await fetch(`${BACKEND_URL}/ask-document-stream`, {
    method: 'POST',
    headers: { 'X-Session-Id': sessionId, ...NGROK_SKIP_HEADER },
    body: form,
  });
  await consumeSSE(response, { onMeta, onDelta });
}

export { BACKEND_URL };
