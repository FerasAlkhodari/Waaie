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

const wsUrl = () => {
  const raw = (BACKEND_URL || '').trim();

  // Production behind nginx uses a RELATIVE base ("/api"). The WebSocket
  // constructor requires an ABSOLUTE ws(s):// URL, so resolve it against the
  // current page origin and match the page's TLS (https -> wss).
  if (!/^https?:\/\//i.test(raw)) {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const path = raw.replace(/\/$/, '');
    return `${scheme}://${window.location.host}${path}/voice`;
  }

  // Absolute base: http -> ws, https -> wss, then drop any trailing slash.
  let ws = raw.replace(/^http/i, 'ws').replace(/\/$/, '');
  // Force IPv4 loopback for local dev. On Windows the browser often resolves
  // `localhost` to IPv6 (::1) FIRST, while uvicorn listens only on IPv4
  // (127.0.0.1); the WS handshake then dies before it opens (close code 1006).
  // Pinning 127.0.0.1 removes that ambiguity. Non-local hosts are untouched.
  ws = ws.replace('://localhost', '://127.0.0.1').replace('://[::1]', '://127.0.0.1');
  return `${ws}/voice`;
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
  constructor({ onEvent, onStatus, onError } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});

    this.ws = null;
    this.wsOpened = false; // distinguishes a connect failure from a later drop
    this.micStream = null;
    this.audioCtx = null; // one context for both capture and playback
    this.processor = null;
    this.sourceNode = null;

    this.playHead = 0; // next scheduled start time (seconds, audioCtx clock)
    this.scheduled = new Set(); // live AudioBufferSourceNodes, for barge-in flush
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
    } catch (err) {
      // NotAllowedError, NotFoundError, NotReadableError, etc.
      this._fail(err, 'mic');
      throw err;
    }

    // 2) Audio graph — a single context at its NATIVE sample rate. We do NOT
    // force 24 kHz on the context (some browsers reject a strict rate and the
    // constructor throws); instead we resample mic input down to 24 kHz before
    // sending, and create playback buffers at 24 kHz which Web Audio resamples
    // up to the context rate automatically.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio API is not supported.');
      this.audioCtx = new Ctx();
      // Created inside the click gesture, but resume() anyway in case the
      // browser starts it suspended.
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }
    } catch (err) {
      this._fail(err, 'audio');
      throw err;
    }

    // 3) WebSocket to the backend proxy.
    try {
      this.ws = new WebSocket(wsUrl());
    } catch (err) {
      this._fail(err, 'connection');
      throw err;
    }
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.wsOpened = true;
      this.onStatus('connected');
      this._startCapture();
    };
    this.ws.onmessage = (e) => this._handleServerEvent(e.data);
    this.ws.onerror = () => {
      // The error event carries no detail (browser security); infer from state.
      if (!this.wsOpened) {
        this._fail(
          new Error(
            `Could not reach the voice backend at ${wsUrl()}. Is the server running?`,
          ),
          'connection',
        );
      }
    };
    this.ws.onclose = (e) => {
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

  _handleServerEvent(raw) {
    if (typeof raw !== 'string') return; // proxy sends JSON text frames
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

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
    src.start(startAt);
    this.playHead = startAt + buffer.duration;

    this.scheduled.add(src);
    src.onended = () => this.scheduled.delete(src);
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
  }

  // Idempotent teardown: stop mic, tear down audio graph, close the socket,
  // and null every reference so nothing keeps the audio hardware alive.
  stop() {
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
