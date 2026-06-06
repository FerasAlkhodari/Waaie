import { BACKEND_URL } from './sessionApi';

// Realtime voice client for the Waaie /voice WebSocket proxy.
//
// What it does:
//   * opens a WebSocket to the backend (which bridges to OpenAI Realtime),
//   * captures the microphone, resamples it to 24 kHz mono PCM16, and streams
//     each chunk as a BINARY frame (the server wraps it for OpenAI),
//   * receives OpenAI server events as JSON TEXT frames and plays the audio
//     deltas back through the Web Audio API with gap-free scheduling,
//   * supports barge-in: when the server detects the user started speaking,
//     any queued assistant audio is flushed so the user can interrupt.
//
// OpenAI Realtime uses 24 kHz mono PCM16 for both directions, so we capture and
// play at 24 kHz. The server key never reaches the browser — auth happens
// server-side inside the proxy.

const SAMPLE_RATE = 24000;

// App-level keep-alive period (ms). Browsers can't send WebSocket protocol
// pings, so we emit a tiny client.ping frame this often; the server answers on
// its own cadence with server.ping. Without this an idle stretch (assistant
// silent) trips a proxy/idle read-timeout and drops the call after ~1 minute.
const HEARTBEAT_MS = 15000;

// Safety net against an indefinite "connecting" hang. Once the mic is granted,
// the socket should open in well under a second; if `onopen` hasn't fired
// within this window we give up and route to the friendly error notice instead
// of spinning forever. Generous so a momentarily slow network never trips it.
const CONNECT_TIMEOUT_MS = 12000;

// Flip to true to trace the voice handshake in the browser console.
const VOICE_DEBUG =
  typeof process !== 'undefined' &&
  process.env &&
  process.env.REACT_APP_VOICE_DEBUG === 'true';
const vlog = (...args) => {
  if (VOICE_DEBUG) console.debug('[voice]', ...args);
};

// Swap an http(s) origin to its ws(s) equivalent: https -> wss, http -> ws.
// This single transform is what lets the Ngrok HTTPS tunnel
// (https://xxxx.ngrok-free.app) drive the voice socket in production with zero
// code change — only the REACT_APP_BACKEND_URL value differs between builds.
const toWebSocketScheme = (origin) =>
  origin.replace(/^http(s)?:\/\//i, (_match, secure) =>
    secure ? 'wss://' : 'ws://',
  );

// Build the absolute ws(s):// URL, appending ?session=<id> so the backend can
// recall this session's document + chat history for context injection.
//
// The base is taken ENTIRELY from REACT_APP_BACKEND_URL (via BACKEND_URL): set
// it to the Ngrok HTTPS URL in production, or http://localhost:8000 (or leave
// it unset) in local dev. No backend host is ever hardcoded here.
const wsUrl = (sessionId) => {
  const raw = (BACKEND_URL || '').trim();
  const suffix = sessionId
    ? `?session=${encodeURIComponent(sessionId)}`
    : '';

  // Relative base (e.g. "/api" behind a reverse proxy): the WebSocket
  // constructor requires an ABSOLUTE ws(s):// URL, so resolve it against the
  // current page origin and match the page's TLS (https page -> wss socket).
  if (!/^https?:\/\//i.test(raw)) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const path = raw.replace(/\/$/, '');
    return `${scheme}://${window.location.host}${path}/voice${suffix}`;
  }

  // Absolute base (Ngrok HTTPS in prod, http://localhost in dev): convert the
  // scheme to ws(s) and drop any trailing slash.
  let ws = toWebSocketScheme(raw).replace(/\/$/, '');

  // Local-dev only: on Windows the browser often resolves `localhost` to IPv6
  // (::1) first while uvicorn listens on IPv4 (127.0.0.1), so the WS handshake
  // dies before it opens (close code 1006). Pin loopback to 127.0.0.1. This
  // rewrites ONLY localhost/[::1]; remote Ngrok / custom-domain hosts pass
  // through untouched, so it is completely inert in production.
  ws = ws
    .replace('://localhost', '://127.0.0.1')
    .replace('://[::1]', '://127.0.0.1');

  return `${ws}/voice${suffix}`;
};

// --- encoding helpers ---------------------------------------------------------

// Downsample a Float32 buffer from inputRate to SAMPLE_RATE (linear interp).
function downsample(input, inputRate) {
  if (inputRate === SAMPLE_RATE) return input;
  const ratio = inputRate / SAMPLE_RATE;
  const outLength = Math.round(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = idx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

// Float32 [-1,1] -> little-endian PCM16 ArrayBuffer.
function floatToPCM16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

// base64 PCM16 -> Float32 [-1,1] for playback.
function base64PCM16ToFloat32(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) float32[i] = pcm[i] / 0x8000;
  return float32;
}

export default class VoiceClient {
  constructor({ onEvent, onStatus, onError, context } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});
    // { sessionId, history } — sessionId keys the backend's document memory;
    // history is the visible chat handed to the proxy on open for context.
    this.context = context || {};

    this.ws = null;
    this.url = null; // resolved ws URL; reused in error messages
    this.heartbeatTimer = null; // client.ping interval (keep-alive)
    this.connectTimer = null; // watchdog: aborts an indefinite "connecting" hang
    this.wsOpened = false; // distinguishes a connect failure from a later drop
    // Single-use lifecycle guards. `started` blocks a re-entrant start() on this
    // same instance; `closed` is set by stop() so an in-flight start() that is
    // still awaiting (mic / audio) aborts instead of opening a ghost socket +
    // capture node. Critical under React StrictMode, which in dev mounts ->
    // cleans up -> mounts again, calling start() then stop() while the first
    // start() is mid-await (its ws/micStream not yet assigned, so that stop()
    // can't see them to tear them down).
    this.started = false;
    this.closed = false;
    this.micStream = null;
    this.audioCtx = null; // one context for both capture and playback
    this.processor = null;
    this.sourceNode = null;

    this.playHead = 0; // next scheduled start time (seconds, audioCtx clock)
    this.scheduled = new Set(); // live AudioBufferSourceNodes, for barge-in flush
    // audioCtx clock time at which the CURRENT spoken utterance's playback
    // begins. Null between utterances. Lets the UI pace the transcript reveal to
    // how much audio has actually been heard (see getPlaybackClock).
    this.audioStartedAt = null;
  }

  // Normalize and surface a failure: log the real error, report it with a phase
  // ('mic' | 'audio' | 'connection') so the UI can show an accurate message,
  // then flip status to error.
  _fail(err, phase) {
    const name = err?.name || 'Error';
    const message = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.error(`[VoiceClient] ${phase} failure: ${name} — ${message}`, err);
    this.onError({ name, message, phase });
    this.onStatus('error');
  }

  async start() {
    // Re-entrancy guard: a client is single-use. A second start() on the SAME
    // instance is ignored (the duplicate-init lock).
    if (this.started) return;
    this.started = true;

    this.onStatus('connecting');

    // 1) Microphone — guard for insecure context / unsupported browser, then
    // request the stream. Any rejection here is a mic/permission problem.
    if (!navigator.mediaDevices?.getUserMedia) {
      const err = new Error(
        'getUserMedia is unavailable (needs a secure context: https or localhost).',
      );
      err.name = 'NotSupportedError';
      this._fail(err, 'mic');
      throw err;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      vlog('mic granted');
    } catch (err) {
      // NotAllowedError, NotFoundError, NotReadableError, etc.
      this._fail(err, 'mic');
      throw err;
    }

    // Aborted while the mic prompt was open (stop() ran during the await):
    // release the freshly granted stream and bail before building anything.
    if (this.closed) {
      this.stop();
      return;
    }

    // Mic is in hand; from here opening the socket should be near-instant. Arm
    // the watchdog so a stall in audio/WS setup can't leave the UI spinning on
    // "connecting" forever — it fails cleanly into the friendly notice instead.
    this._armConnectWatchdog();

    // 2) Audio graph — a single context at its NATIVE sample rate. We do NOT
    // force 24 kHz on the context (some browsers reject a strict rate and the
    // constructor throws); instead we resample mic input down to 24 kHz before
    // sending, and create playback buffers at 24 kHz which Web Audio resamples
    // up to the context rate automatically.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio API is not supported.');
      this.audioCtx = new Ctx();
      // Resume WITHOUT awaiting. This effect runs after render, outside the
      // click's user-gesture window, so a suspended context's resume() can stay
      // PENDING indefinitely — and awaiting it here previously stalled the whole
      // call on "connecting", never reaching the WebSocket. Fire-and-forget: the
      // context resumes on its own (and again when the first audio chunk plays),
      // so the socket opens immediately and the UI transitions right away.
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
    } catch (err) {
      this._fail(err, 'audio');
      throw err;
    }

    // Aborted during audio setup (the StrictMode cleanup case): do NOT open the
    // socket. This is the load-bearing check — without it the WS opens here
    // AFTER stop() already ran, leaving a ghost session that talks over the real
    // one and survives hang-up.
    if (this.closed) {
      this.stop();
      return;
    }

    // 3) WebSocket to the backend proxy. Resolve the URL once (with the
    // ?session= param) so onopen/onerror all reference the same target.
    this.url = wsUrl(this.context.sessionId);
    vlog('opening socket', this.url);
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this._fail(err, 'connection');
      throw err;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this._clearConnectWatchdog();
      this.wsOpened = true;
      vlog('socket OPEN -> connected');
      this.onStatus('connected');
      // Hand the visible chat history to the proxy BEFORE any audio, so it gets
      // folded into the OpenAI session.update and the bot starts aware of the
      // typed conversation. Then begin capture and the keep-alive heartbeat.
      this._sendContext();
      this._startCapture();
      this._startHeartbeat();
    };
    this.ws.onmessage = (e) => this._handleServerEvent(e.data);
    this.ws.onerror = () => {
      vlog('socket ERROR (wsOpened=' + this.wsOpened + ')');
      // The error event carries no detail (browser security); infer from state.
      if (!this.wsOpened) {
        this._clearConnectWatchdog();
        this._fail(
          new Error(
            `Could not reach the voice backend at ${this.url}. Is the server running?`,
          ),
          'connection',
        );
      }
    };
    this.ws.onclose = (e) => {
      vlog('socket CLOSE code=' + e.code + ' wsOpened=' + this.wsOpened);
      this._clearConnectWatchdog();
      // A close before open is a connection failure, not a normal hang-up.
      if (!this.wsOpened) {
        this._fail(
          new Error(
            `Voice socket closed before connecting (code ${e.code}${
              e.reason ? `: ${e.reason}` : ''
            }).`,
          ),
          'connection',
        );
      } else {
        this.onStatus('closed');
      }
      this.stop();
    };
  }

  _startCapture() {
    const ctx = this.audioCtx;
    this.sourceNode = ctx.createMediaStreamSource(this.micStream);
    // ScriptProcessor is deprecated but is the most broadly supported way to
    // pull raw PCM in a CRA app without shipping an AudioWorklet asset.
    this.processor = ctx.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = event.inputBuffer.getChannelData(0);
      const down = downsample(input, ctx.sampleRate);
      this.ws.send(floatToPCM16(down)); // binary frame -> server -> OpenAI
    };

    this.sourceNode.connect(this.processor);
    // Route through a muted gain so onaudioprocess fires without echoing mic.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.processor.connect(sink);
    sink.connect(ctx.destination);
  }

  // Send the one-shot context frame: the visible chat history the proxy folds
  // into the OpenAI session. The server also supplies any uploaded-document
  // text on its side (keyed by sessionId), so this only carries the transcript.
  _sendContext() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const history = Array.isArray(this.context.history)
      ? this.context.history
      : [];
    try {
      this.ws.send(JSON.stringify({ type: 'client.context', history }));
    } catch {
      /* non-fatal: server falls back to its own stored history */
    }
  }

  // App-level keep-alive. Browsers can't emit WS protocol pings, so send a tiny
  // JSON frame the server swallows; keeps the call from being reaped as idle.
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'client.ping' }));
        } catch {
          /* noop — a failed ping just means the socket is gone */
        }
      }
    }, HEARTBEAT_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Watchdog for the "connecting" phase: if the socket hasn't reached onopen
  // within CONNECT_TIMEOUT_MS, abort instead of hanging forever. Surfaces as a
  // 'connection' failure so the UI shows the friendly recovery notice (error
  // shielding) rather than an endless spinner.
  _armConnectWatchdog() {
    this._clearConnectWatchdog();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.wsOpened || this.closed) return;
      vlog('connect watchdog FIRED — socket never opened');
      this._fail(
        new Error(
          `Voice connection stalled — the socket did not open within ${
            CONNECT_TIMEOUT_MS / 1000
          }s.`,
        ),
        'connection',
      );
      this.stop();
    }, CONNECT_TIMEOUT_MS);
  }

  _clearConnectWatchdog() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  _handleServerEvent(raw) {
    if (typeof raw !== 'string') return; // proxy sends JSON text frames
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    // Proxy keep-alive heartbeat — swallow it; it's not an OpenAI event and
    // must never reach the UI.
    if (event.type === 'server.ping') return;

    switch (event.type) {
      // GA Realtime streams assistant audio as response.output_audio.delta
      // (the legacy beta name was response.audio.delta).
      case 'response.output_audio.delta':
        if (event.delta) this._enqueueAudio(event.delta);
        break;
      // Barge-in: user started talking -> drop any assistant audio still queued.
      case 'input_audio_buffer.speech_started':
        this._flushPlayback();
        break;
      default:
        break;
    }

    // Surface every event (transcripts, errors, lifecycle) to the UI.
    this.onEvent(event);
  }

  _enqueueAudio(b64) {
    const ctx = this.audioCtx;
    if (!ctx) return;
    const float32 = base64PCM16ToFloat32(b64);
    // Buffer is authored at 24 kHz; Web Audio resamples it to the context rate.
    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const startAt = Math.max(this.playHead, ctx.currentTime);
    // First chunk of a new utterance: anchor the playback clock here so the UI
    // can measure "how much has actually been spoken" from this instant.
    if (this.audioStartedAt === null) this.audioStartedAt = startAt;
    src.start(startAt);
    this.playHead = startAt + buffer.duration;
    vlog(
      'audio chunk +' + buffer.duration.toFixed(3) + 's',
      'scheduledEnd=' + (this.playHead - this.audioStartedAt).toFixed(2) + 's',
    );

    this.scheduled.add(src);
    src.onended = () => this.scheduled.delete(src);
  }

  // Playback clock for the current utterance, in seconds:
  //  * playedSec   — how much audio has actually been heard so far
  //  * scheduledSec — how much audio has been scheduled (received) so far
  // The UI reveals transcript words by the ratio of these two, so text expands
  // in lockstep with the speaker instead of dumping ahead of the voice.
  getPlaybackClock() {
    const ctx = this.audioCtx;
    if (!ctx || this.audioStartedAt === null) {
      return { playedSec: 0, scheduledSec: 0 };
    }
    const playedSec = Math.max(0, ctx.currentTime - this.audioStartedAt);
    const scheduledSec = Math.max(0, this.playHead - this.audioStartedAt);
    return { playedSec, scheduledSec };
  }

  // Re-anchor the clock for the next utterance (called at each new turn).
  resetAudioClock() {
    this.audioStartedAt = null;
  }

  _flushPlayback() {
    this.scheduled.forEach((src) => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    });
    this.scheduled.clear();
    this.playHead = this.audioCtx ? this.audioCtx.currentTime : 0;
    // Barge-in / interruption: the current utterance is gone, so re-anchor.
    this.audioStartedAt = null;
  }

  // Idempotent teardown: stop mic, tear down audio graph, close the socket,
  // and null every reference so nothing keeps the audio hardware alive.
  stop() {
    // Mark closed FIRST so an in-flight start() awaiting mic/audio sees it and
    // aborts, instead of resurrecting the socket/capture node after teardown.
    this.closed = true;
    this._clearConnectWatchdog();
    this._stopHeartbeat();

    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
    }
    this._flushPlayback();
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
    }

    this.processor = null;
    this.sourceNode = null;
    this.micStream = null;
    this.audioCtx = null;
    this.ws = null;
    this.wsOpened = false;
  }
}
