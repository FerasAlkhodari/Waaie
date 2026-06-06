// Voice-answer capture for the quiz (بنك الأسئلة).
//
// The student taps a mic and speaks their answer naturally — a bare letter
// ("ألف"), a phrase ("الخيار الثاني"), "صح"/"خطأ", a full conversational
// sentence ("اممم اتوقع الجواب الصحيح هو فقرة الف"), or reads a choice aloud. We
// capture the WHOLE utterance and hand it up so the backend matcher can strip
// the padding and resolve it to an option index.
//
// Capture model — maximize raw dictation:
//   * continuous = true       → keep listening across pauses, not one word;
//   * interimResults = true   → stream partial words so the UI shows live text;
//   * maxAlternatives = 5     → keep an N-best set for server-side recovery.
// Because continuous mode never auto-stops, we finalize on a short SILENCE
// window after the student stops speaking (hands-free — no button press), with
// a hard watchdog as a safety cap and an explicit finalize() for a manual stop.
//
// It deliberately REUSES the lifecycle discipline of lib/voiceClient.js (the
// realtime-call client) rather than its transport: the same single-use
// `started`/`closed` guards that make teardown safe under React.StrictMode's
// mount → cleanup → mount dev cycle, an idempotent `stop()`, and phased error
// reporting (`{ name, message, phase }`) so the UI can show an accurate hint.
// The full-duplex WebSocket/PCM path in voiceClient.js is the wrong shape here:
// it streams audio to OpenAI Realtime and plays a spoken answer back, which
// would make the bot talk over a quiz; capturing one answer is all we need.

// Map the question language to a BCP-47 recognition locale.
const toRecognitionLang = (language) => (language === 'en' ? 'en-US' : 'ar-SA');

// Resolve the vendor-prefixed constructor without touching globals at import
// time (so importing this module is safe everywhere, incl. tests/SSR).
function getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export default class QuizVoiceClient {
  // onStatus('listening' | 'stopped' | 'error'), onInterim(liveText),
  // onResult(finalText, alternatives[]), onError({ name, message, phase }).
  constructor({
    onStatus,
    onInterim,
    onResult,
    onError,
    language,
    maxMs,
    silenceMs,
  } = {}) {
    this.onStatus = onStatus || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onResult = onResult || (() => {});
    this.onError = onError || (() => {});
    this.lang = toRecognitionLang(language);
    // Hard safety cap so a stuck recognizer can't leave the mic UI spinning.
    this.maxMs = maxMs || 20000;
    // End-of-speech window: once the student stops talking for this long, the
    // full accumulated utterance is finalized and sent — the hands-free trigger.
    this.silenceMs = silenceMs || 1500;

    this.recognition = null;
    this.watchdog = null; // hard cap
    this.silenceTimer = null; // debounced end-of-speech finalizer
    // Single-use lifecycle guards (mirrors voiceClient.js). `started` blocks a
    // re-entrant start(); `closed` makes a stop() during teardown win the race.
    this.started = false;
    this.closed = false;
    this.gotResult = false;
    // Accumulated capture for the continuous session (flushed on every start()).
    this.finalText = '';
    this.lastInterim = '';
    this.altSet = new Set();
  }

  static isSupported() {
    return Boolean(getRecognitionCtor());
  }

  _fail(err, phase) {
    const name = err?.name || 'Error';
    const message = err?.message || String(err);
    // eslint-disable-next-line no-console
    console.error(`[QuizVoiceClient] ${phase} failure: ${name} — ${message}`);
    this.onError({ name, message, phase });
    this.onStatus('error');
  }

  start() {
    if (this.started) return;
    this.started = true;
    // Idempotent buffer flush: a new listen starts with NO carry-over from a
    // previous question's capture, so a stale hypothesis can't ghost-fire.
    this.finalText = '';
    this.lastInterim = '';
    this.altSet = new Set();
    this.gotResult = false;

    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this._fail(
        Object.assign(new Error('Speech recognition is not supported in this browser.'), {
          name: 'NotSupportedError',
        }),
        'unsupported',
      );
      return;
    }

    let recognition;
    try {
      recognition = new Ctor();
    } catch (err) {
      this._fail(err, 'init');
      return;
    }

    // Aborted before we even wired up (StrictMode cleanup mid-start): bail.
    if (this.closed) return;

    recognition.lang = this.lang;
    // Capture EVERYTHING the student says, continuously, with live partials and
    // a wide N-best — the raw-dictation requirement.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;

    recognition.onstart = () => {
      if (this.closed) return;
      this.onStatus('listening');
    };

    recognition.onresult = (event) => {
      if (this.closed) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const best = (result[0]?.transcript || '').trim();
          if (best) this.finalText = `${this.finalText} ${best}`.trim();
          // Collect this segment's N-best hypotheses for server-side recovery.
          for (let j = 0; j < result.length; j += 1) {
            const alt = (result[j]?.transcript || '').trim();
            if (alt) this.altSet.add(alt);
          }
        } else {
          interim += result[0]?.transcript || '';
        }
      }
      this.lastInterim = interim.trim();
      // Live transcript = everything finalized so far + the current partial, so
      // the student SEES the mic capturing all their words in real time.
      const live = this._captured();
      if (live) this.onInterim(live);
      // Any speech activity (re)arms the end-of-speech timer.
      this._armSilenceTimer();
    };

    recognition.onerror = (event) => {
      if (this.closed) return;
      const code = event?.error || 'error';
      // We aborted on purpose (stop()/teardown) — not a real failure.
      if (code === 'aborted') return;
      // "no-speech" is a soft outcome: if we already captured something, send
      // it; otherwise emit an empty result so the UI shows the gentle retry.
      if (code === 'no-speech') {
        if (this._captured()) {
          this._finalize();
          return;
        }
        this.gotResult = true;
        this.onResult('');
        this.stop();
        return;
      }
      const phase =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'mic'
          : code === 'audio-capture'
            ? 'mic'
            : code === 'network'
              ? 'network'
              : 'recognition';
      this._fail(Object.assign(new Error(`Speech recognition error: ${code}`), { name: code }), phase);
      this.stop();
    };

    recognition.onend = () => {
      this._clearWatchdog();
      this._clearSilenceTimer();
      if (this.closed) return;
      // The engine stopped on its own (some browsers end after a long pause even
      // with continuous): emit whatever we captured, else an empty retry.
      if (!this.gotResult) {
        if (this._captured()) {
          this._finalize();
          return;
        }
        this.onResult('');
      }
      this.onStatus('stopped');
    };

    this.recognition = recognition;
    this._armWatchdog();

    try {
      recognition.start();
    } catch (err) {
      // start() throws if called twice in quick succession; treat as init fail.
      this._fail(err, 'init');
      this.stop();
    }
  }

  // The full utterance captured so far (finalized segments + live partial).
  _captured() {
    return `${this.finalText} ${this.lastInterim}`.trim();
  }

  // Emit the accumulated utterance (+ N-best) once, then tear down.
  _finalize() {
    if (this.closed || this.gotResult) return;
    const value = this._captured();
    this.gotResult = true;
    this.onResult(value, Array.from(this.altSet));
    this.stop();
  }

  // Public: the student tapped "stop" — submit whatever has been captured now
  // (or a clean empty result if they said nothing).
  finalize() {
    if (this.closed || this.gotResult) return;
    if (this._captured()) {
      this._finalize();
    } else {
      this.gotResult = true;
      this.onResult('');
      this.stop();
    }
  }

  _armSilenceTimer() {
    this._clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.closed || this.gotResult) return;
      // Stopped speaking → finalize the full utterance hands-free.
      this._finalize();
    }, this.silenceMs);
  }

  _clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  _armWatchdog() {
    this._clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (this.closed || this.gotResult) return;
      // Hit the hard cap: send anything captured so far, else an empty retry.
      if (this._captured()) {
        this._finalize();
      } else {
        this.gotResult = true;
        this.onResult('');
        this.stop();
      }
    }, this.maxMs);
  }

  _clearWatchdog() {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  // Idempotent teardown: detach handlers and abort the recognizer so the mic is
  // released immediately. Safe to call from any path (result, error, unmount).
  stop() {
    this.closed = true;
    this._clearWatchdog();
    this._clearSilenceTimer();
    const recognition = this.recognition;
    if (recognition) {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    }
    this.recognition = null;
  }
}
