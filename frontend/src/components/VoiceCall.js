import React, { useCallback, useEffect, useRef, useState } from 'react';
import VoiceClient from '../lib/voiceClient';
import BrandLogo from './BrandLogo';
import { PhoneOffIcon, SpinnerIcon, CloseIcon, MicIcon } from './icons';
import { FRIENDLY_ERROR } from '../lib/constants';

// Hard per-call cap, kept in sync with the server (VOICE_MAX_CALL_SECONDS).
// The client ends the call itself at the limit so the user sees a clean
// "timeout" cue instead of an abrupt socket close.
const MAX_CALL_SECONDS = 300;

// status: 'connecting' | 'active' | 'timeout' | 'error' | 'ended'
const LABELS = {
  connecting: 'جارٍ الاتصال…',
  active: 'المكالمة جارية',
  timeout: 'انتهت مدة المكالمة (٥ دقائق)',
  error: 'تعذّر بدء المكالمة',
  ended: 'انتهت المكالمة',
};

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Human-readable Arabic guidance keyed by the failure phase, with the raw
// error name/message appended so the exact cause is always visible. Used only
// for PRE-CONNECT setup failures (mic / audio / reaching the server); a failure
// that happens MID-CALL instead shows the friendly recovery notice (Criterion
// #4) so a dropped network chunk never dumps a technical error on the student.
const ERROR_HINTS = {
  mic: 'تعذّر الوصول إلى الميكروفون. تأكّد من السماح بالإذن ومن وجود ميكروفون متصل.',
  audio: 'تعذّر تشغيل نظام الصوت في المتصفح. جرّب متصفحًا حديثًا (Chrome/Edge/Firefox).',
  connection:
    'تعذّر الاتصال بخادم الصوت. تأكّد من تشغيل الخادم على المنفذ 8000.',
};

// GA Realtime event names for the assistant's spoken-text transcript (the exact
// words being voiced). The legacy beta names are accepted too so the preview
// keeps working across SDK versions.
const ASSISTANT_TRANSCRIPT_DELTA = new Set([
  'response.output_audio_transcript.delta',
  'response.audio_transcript.delta',
]);
const ASSISTANT_TRANSCRIPT_DONE = new Set([
  'response.output_audio_transcript.done',
  'response.audio_transcript.done',
]);

// Trace transcript deltas vs. audio playback when REACT_APP_VOICE_DEBUG=true.
const VDBG = process.env.REACT_APP_VOICE_DEBUG === 'true';

function VoiceCall({
  onClose,
  sessionId,
  history,
  onCallStart,
  onCallEnd,
  onVoiceTurns,
}) {
  const [status, setStatus] = useState('connecting');
  const [elapsed, setElapsed] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null); // { name, message, phase }
  // Live transcript for the CURRENT turn, mirrored from the refs below so the
  // overlay re-renders word-by-word as deltas arrive.
  const [userText, setUserText] = useState(''); // transcribed question
  const [botText, setBotText] = useState(''); // VISIBLE answer, paced to audio
  // True while the assistant's answer is still being revealed (drives the caret).
  const [revealing, setRevealing] = useState(false);
  // Set when a mid-call failure (network drop / upstream error) is shielded
  // behind the friendly recovery notice instead of a raw error.
  const [friendlyError, setFriendlyError] = useState(false);

  const clientRef = useRef(null);
  const timerRef = useRef(null);
  // Tracks whether we reached the cap, so a server close reads as "timeout".
  const elapsedAtCapRef = useRef(false);
  // True once the user pressed "end" — so the ensuing socket close reads as a
  // clean hang-up, not an unexpected mid-call drop.
  const userEndedRef = useRef(false);
  // Latest status without re-subscribing the interval each tick.
  const statusRef = useRef('connecting');
  statusRef.current = status;

  // --- Transcript accumulation ------------------------------------------------
  // userAcc/botAcc hold the in-flight turn's text; turnsRef collects every
  // completed {user, assistant} exchange to merge into the main chat on hang-up.
  // pendingUserTurnRef backfills a turn whose whisper transcription landed AFTER
  // the assistant's response.done (the two streams finish independently).
  const userAccRef = useRef('');
  const botAccRef = useRef(''); // FULL transcript (for commit), accrued from deltas
  const turnsRef = useRef([]);
  const pendingUserTurnRef = useRef(null);
  const committedRef = useRef(false);
  // Audio-paced reveal bookkeeping for the current turn.
  const revealedWordsRef = useRef(0); // words currently shown (monotonic)
  const responseDoneRef = useRef(false); // model finished emitting this answer
  const turnFlushedRef = useRef(false); // this turn already pushed to turnsRef
  const revealingRef = useRef(false); // mirror of `revealing` for the rAF loop
  const previewRef = useRef(null);
  // Whether the preview is pinned to its latest line. Goes false the moment the
  // user scrolls up to re-read, so streaming tokens don't yank the view back.
  const previewStickRef = useRef(true);

  // Context captured at mount — the call starts immediately, so these are the
  // session id + visible chat history at the moment the user opened the call.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const historyRef = useRef(history);
  historyRef.current = history;

  // Lifecycle callbacks via refs so the once-only mount effect always calls the
  // latest handler without re-running. Guard flags make the chat logs fire
  // exactly once: a start log on connect, an end log on the terminal state.
  const onCallStartRef = useRef(onCallStart);
  onCallStartRef.current = onCallStart;
  const onCallEndRef = useRef(onCallEnd);
  onCallEndRef.current = onCallEnd;
  const onVoiceTurnsRef = useRef(onVoiceTurns);
  onVoiceTurnsRef.current = onVoiceTurns;
  const startLoggedRef = useRef(false);
  const endLoggedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Record the current turn (full question + full answer) into the completed
  // list. The assistant text is the gate. Guarded so a turn is pushed at most
  // once (response.done OR a hang-up mid-answer, whichever comes first). The
  // accumulators are intentionally NOT cleared here — the reveal loop keeps
  // reading botAccRef until the audio finishes; beginTurn resets for next turn.
  const flushTurn = useCallback(() => {
    if (turnFlushedRef.current) return;
    const assistant = botAccRef.current.trim();
    if (!assistant) return;
    const user = userAccRef.current.trim();
    const turn = { user, assistant };
    turnsRef.current.push(turn);
    // If the question transcription hasn't arrived yet, remember this turn so a
    // late input_audio_transcription.completed can backfill it.
    pendingUserTurnRef.current = user ? null : turn;
    turnFlushedRef.current = true;
  }, []);

  // Commit the whole call's dialogue into the main chat exactly once: flush any
  // in-progress turn first (covers a hang-up mid-answer), then hand the turns to
  // the parent. Safe to call from every teardown path.
  const commitTurns = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    flushTurn();
    if (turnsRef.current.length > 0) {
      onVoiceTurnsRef.current?.(turnsRef.current);
    }
  }, [flushTurn]);

  // Tear the call down and settle on a terminal status. Idempotent.
  const endCall = useCallback(
    (reason) => {
      clearTimer();
      if (clientRef.current) {
        clientRef.current.stop();
        clientRef.current = null;
      }
      setStatus((prev) =>
        prev === 'timeout' || prev === 'error' || prev === 'ended'
          ? prev
          : reason,
      );
      // The call is over — stop the caret/reveal animation.
      revealingRef.current = false;
      setRevealing(false);
      // Merge the transcript into the persistent chat BEFORE the "call ended"
      // system pill, so the dialogue is ordered correctly in the history.
      commitTurns();
      // Log the call end into the chat exactly once — and only if it actually
      // started (a call that never connected shouldn't emit an "ended" log).
      if (startLoggedRef.current && !endLoggedRef.current) {
        endLoggedRef.current = true;
        onCallEndRef.current?.();
      }
    },
    [clearTimer, commitTurns],
  );

  // Begin a fresh turn: clear the live preview, accumulators, and reveal/audio
  // bookkeeping. Driven by the server's VAD (speech_started) so each spoken
  // question starts clean.
  const beginTurn = useCallback(() => {
    userAccRef.current = '';
    botAccRef.current = '';
    pendingUserTurnRef.current = null;
    revealedWordsRef.current = 0;
    responseDoneRef.current = false;
    turnFlushedRef.current = false;
    revealingRef.current = false;
    setRevealing(false);
    setUserText('');
    setBotText('');
    // Re-anchor the audio playback clock for the upcoming utterance.
    clientRef.current?.resetAudioClock?.();
  }, []);

  // Interpret one OpenAI Realtime event for the live transcript preview.
  const handleTranscriptEvent = useCallback((event) => {
    const { type } = event;

    // A new user turn begins (server VAD detected speech). The previous turn was
    // already flushed on its response.done; reset the preview for the new one.
    if (type === 'input_audio_buffer.speech_started') {
      beginTurn();
      return;
    }

    // The user's question, transcribed by whisper — may stream as deltas and/or
    // arrive whole in a completed event.
    if (type === 'conversation.item.input_audio_transcription.delta') {
      if (event.delta) {
        userAccRef.current += event.delta;
        setUserText(userAccRef.current);
      }
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = (event.transcript || '').trim();
      if (transcript) {
        userAccRef.current = transcript;
        setUserText(transcript);
        // Backfill a turn that was committed before this transcription landed.
        if (pendingUserTurnRef.current && !pendingUserTurnRef.current.user) {
          pendingUserTurnRef.current.user = transcript;
          pendingUserTurnRef.current = null;
        }
      }
      return;
    }

    // The assistant's spoken words. These deltas arrive SECONDS ahead of the
    // audio, so we only accumulate the full text here (for the commit) and let
    // the reveal loop expose it in step with playback — never dump it at once.
    if (ASSISTANT_TRANSCRIPT_DELTA.has(type)) {
      if (event.delta) {
        botAccRef.current += event.delta;
        if (!revealingRef.current) {
          revealingRef.current = true;
          setRevealing(true);
        }
        if (VDBG) {
          const c = clientRef.current?.getPlaybackClock?.() || {};
          // eslint-disable-next-line no-console
          console.debug(
            '[voice] transcript.delta',
            JSON.stringify(event.delta),
            `played=${(c.playedSec || 0).toFixed(2)}s sched=${(
              c.scheduledSec || 0
            ).toFixed(2)}s`,
          );
        }
      }
      return;
    }
    if (ASSISTANT_TRANSCRIPT_DONE.has(type)) {
      // Fill the full text only if (unusually) no deltas streamed at all; the
      // reveal loop still paces it to the audio.
      if (!botAccRef.current && event.transcript) {
        botAccRef.current = event.transcript.trim();
      }
      return;
    }

    // The assistant finished emitting this answer. Record the turn now (the full
    // text is in botAccRef); the audio keeps playing and the reveal loop
    // continues exposing words until it drains.
    if (type === 'response.done') {
      responseDoneRef.current = true;
      flushTurn();
    }
  }, [beginTurn, flushTurn]);

  useEffect(() => {
    let cancelled = false;

    // Re-arm the commit + transcript state on every (re)mount. Under React
    // StrictMode the dev cycle is mount -> cleanup -> mount, and the cleanup
    // runs commitTurns() once (with no turns yet), which would otherwise leave
    // committedRef stuck `true` and silently swallow the REAL call's turns on
    // hang-up. Resetting here guarantees the genuine dialogue is injected.
    committedRef.current = false;
    turnsRef.current = [];
    userAccRef.current = '';
    botAccRef.current = '';
    pendingUserTurnRef.current = null;
    revealedWordsRef.current = 0;
    responseDoneRef.current = false;
    turnFlushedRef.current = false;
    revealingRef.current = false;

    const client = new VoiceClient({
      // Prime the proxy with the session id (document memory) + visible chat
      // history (transcript) so the voice bot continues the conversation.
      context: { sessionId: sessionIdRef.current, history: historyRef.current },
      onError: (info) => {
        if (!cancelled) setErrorInfo(info);
      },
      onStatus: (s) => {
        if (cancelled) return;
        if (process.env.REACT_APP_VOICE_DEBUG === 'true') {
          // eslint-disable-next-line no-console
          console.debug('[voice] status ->', s);
        }
        if (s === 'connected') {
          setStatus('active');
          // Inject the "call started" system log into the chat once.
          if (!startLoggedRef.current) {
            startLoggedRef.current = true;
            onCallStartRef.current?.();
          }
        } else if (s === 'error') {
          // Pre-connect setup failure (mic/audio/reaching the server): keep the
          // specific technical hint (errorInfo.phase drives ERROR_HINTS).
          endCall('error');
        } else if (s === 'closed') {
          // A server-side close while we still think the call is live.
          if (
            statusRef.current === 'active' ||
            statusRef.current === 'connecting'
          ) {
            if (elapsedAtCapRef.current) {
              endCall('timeout');
            } else if (userEndedRef.current) {
              endCall('ended');
            } else {
              // Unexpected mid-call drop — shield it behind the friendly notice
              // (Criterion #4) instead of letting the call state break.
              setFriendlyError(true);
              endCall('error');
            }
          }
        }
      },
      onEvent: (event) => {
        if (cancelled) return;

        // An upstream error event. Only shield-and-end if it lands BEFORE the
        // call is active (a connect-time failure). Once active, OpenAI may emit
        // non-fatal error events (e.g. a no-op cancel) that must NOT tear down a
        // working call — and a genuinely fatal error also drops the socket,
        // which the onStatus('closed') path already shields with the notice.
        if (event.type === 'error') {
          if (statusRef.current !== 'active') {
            setFriendlyError(true);
            endCall('error');
          }
          return;
        }

        // Light speaking indicator driven by the assistant's audio stream
        // (GA Realtime event names: response.output_audio.delta / .done).
        if (event.type === 'response.output_audio.delta') setSpeaking(true);
        else if (
          event.type === 'response.output_audio.done' ||
          event.type === 'response.done'
        ) {
          setSpeaking(false);
        }

        // Drive the live text preview from the same stream as the audio.
        handleTranscriptEvent(event);
      },
    });

    clientRef.current = client;

    client
      .start()
      .then(() => {
        if (cancelled) return;
        // Begin the elapsed timer; enforce the hard cap client-side.
        timerRef.current = setInterval(() => {
          setElapsed((prev) => {
            const next = prev + 1;
            if (next >= MAX_CALL_SECONDS) {
              elapsedAtCapRef.current = true;
              endCall('timeout');
            }
            return next;
          });
        }, 1000);
      })
      .catch(() => {
        // getUserMedia denied / no device / insecure context.
        if (!cancelled) endCall('error');
      });

    return () => {
      cancelled = true;
      clearTimer();
      if (clientRef.current) {
        clientRef.current.stop();
        clientRef.current = null;
      }
      // Safety net: if the panel unmounts without a terminal status (e.g. the
      // session was switched mid-call), still merge whatever was captured.
      commitTurns();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether the user is at the bottom of the preview; once they scroll up
  // to re-read, freeze the auto-follow until they return to the bottom.
  const handlePreviewScroll = useCallback((e) => {
    const el = e.currentTarget;
    previewStickRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  // Follow the latest transcript line as text streams in — but ONLY while the
  // user is still pinned to the bottom (interruption-free auto-scroll).
  useEffect(() => {
    const el = previewRef.current;
    if (el && previewStickRef.current) el.scrollTop = el.scrollHeight;
  }, [userText, botText]);

  // Audio-paced reveal. The transcript text is fully buffered in botAccRef
  // within a second or two, but the VOICE takes much longer to speak it. Each
  // frame we expose only the fraction of words equal to how much audio has
  // actually been heard (playedSec / scheduledSec) — so "أهلاً" shows while
  // "أهلاً" is spoken, and the rest builds up in lockstep instead of snapping
  // in as one block. Monotonic, so revealed text never jumps backward.
  useEffect(() => {
    if (status !== 'active') return undefined;
    let raf;
    const tick = () => {
      const client = clientRef.current;
      const full = botAccRef.current;
      if (client && full) {
        const tokens = full.split(/\s+/).filter(Boolean);
        const total = tokens.length;
        const { playedSec, scheduledSec } = client.getPlaybackClock?.() || {
          playedSec: 0,
          scheduledSec: 0,
        };

        let target;
        if (scheduledSec > 0.05) {
          target = Math.floor(Math.min(1, playedSec / scheduledSec) * total);
        } else if (responseDoneRef.current) {
          target = total; // no audio ever arrived — reveal in full (fallback)
        } else {
          target = 0; // audio not playing yet — keep the preview empty
        }
        target = Math.min(total, Math.max(revealedWordsRef.current, target));

        if (target !== revealedWordsRef.current) {
          revealedWordsRef.current = target;
          setBotText(tokens.slice(0, target).join(' '));
        }

        // Caret off once the whole answer has been spoken and shown.
        const drained =
          scheduledSec <= 0.05 || playedSec >= scheduledSec - 0.05;
        if (
          revealingRef.current &&
          responseDoneRef.current &&
          total > 0 &&
          target >= total &&
          drained
        ) {
          revealingRef.current = false;
          setRevealing(false);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const isLive = status === 'connecting' || status === 'active';
  const isTerminal =
    status === 'timeout' || status === 'error' || status === 'ended';
  const hasTranscript = Boolean(userText || botText);
  // Show the friendly recovery notice for a shielded mid-call failure; fall back
  // to the specific technical hint for a pre-connect setup error.
  const showFriendly = status === 'error' && friendlyError;
  const showTechnicalError = status === 'error' && !friendlyError;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-5 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="مكالمة صوتية مع واعي"
    >
      <div className="glass relative flex w-full max-w-sm animate-pop-in flex-col items-center gap-6 overflow-hidden rounded-3xl px-8 py-10 text-center shadow-card shadow-inner-hi">
        {/* top accent hairline */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/60 to-transparent" />
        {/* Close (terminal states) */}
        {isTerminal && (
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-slate-200"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        )}

        {/* Avatar with pulsing rings while active */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          {status === 'active' && (
            <>
              <span className="absolute inset-0 rounded-full bg-accent/20 animate-ping" />
              <span
                className={`absolute inset-2 rounded-full bg-accent/10 transition-transform duration-300 ${
                  speaking ? 'scale-110' : 'scale-100'
                }`}
              />
            </>
          )}
          <div
            className={`relative flex h-20 w-20 items-center justify-center rounded-full border ${
              status === 'error'
                ? 'border-rose-500/40 bg-rose-500/10'
                : 'border-accent/40 bg-slate-950/60'
            }`}
          >
            {status === 'connecting' ? (
              <SpinnerIcon className="h-8 w-8 animate-spin text-accent" />
            ) : (
              <BrandLogo className="h-12 w-12" />
            )}
          </div>
        </div>

        {/* Status + timer */}
        <div className="space-y-1.5">
          <p className="text-base font-bold text-slate-100">{LABELS[status]}</p>
          {status === 'active' && (
            <p className="font-mono text-sm tabular-nums text-accent">
              {formatElapsed(elapsed)}
            </p>
          )}
          {status === 'active' && (
            <div
              className="flex items-end justify-center gap-1 pt-1"
              aria-hidden="true"
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`w-1 origin-bottom rounded-full bg-gradient-to-t from-accent-deep to-accent-soft transition-all duration-300 ${
                    speaking ? 'h-5 animate-bar-dance' : 'h-1.5 opacity-40'
                  }`}
                  style={
                    speaking ? { animationDelay: `${i * 0.12}s` } : undefined
                  }
                />
              ))}
            </div>
          )}
          {/* Friendly recovery notice — shielded mid-call failure (Criterion #4) */}
          {showFriendly && (
            <p className="mx-auto max-w-[18rem] text-xs leading-relaxed text-slate-300">
              {FRIENDLY_ERROR}
            </p>
          )}
          {/* Technical hint — pre-connect setup failure only */}
          {showTechnicalError && (
            <div className="space-y-2">
              <p className="max-w-[16rem] text-xs leading-relaxed text-slate-400">
                {(errorInfo && ERROR_HINTS[errorInfo.phase]) ||
                  'حدث خطأ غير متوقع أثناء بدء المكالمة.'}
              </p>
              {errorInfo && (
                <p
                  dir="ltr"
                  className="mx-auto max-w-[18rem] break-words rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-left font-mono text-[0.7rem] leading-relaxed text-rose-300/90"
                >
                  {errorInfo.name}: {errorInfo.message}
                </p>
              )}
            </div>
          )}
          {status === 'active' && (
            <p className="text-xs text-slate-500">
              تحدّث بشكل طبيعي — يمكنك المقاطعة في أي وقت.
            </p>
          )}
        </div>

        {/* Live transcript preview — streams word-by-word in lockstep with the
            audio (Criterion #1/#2). Shown while live or once a turn has text. */}
        {(status === 'active' || (isTerminal && hasTranscript)) && (
          <div
            ref={previewRef}
            onScroll={handlePreviewScroll}
            className="scrollbar-elegant max-h-40 w-full space-y-3 overflow-y-auto rounded-2xl border border-slate-800/70 bg-slate-950/50 px-4 py-3 text-right"
          >
            {!hasTranscript ? (
              <p className="text-xs leading-relaxed text-slate-500">
                النص المباشر للمكالمة سيظهر هنا أثناء حديثكما…
              </p>
            ) : (
              <>
                {userText && (
                  <div className="flex items-start justify-end gap-2">
                    <p className="text-[0.8rem] leading-relaxed text-slate-300">
                      {userText}
                    </p>
                    <MicIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </div>
                )}
                {botText && (
                  <div className="flex items-start gap-2">
                    <BrandLogo className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-[0.85rem] font-medium leading-relaxed text-accent-soft">
                      {botText}
                      {revealing && (
                        <span className="mr-0.5 inline-block h-[1em] w-[2px] translate-y-[0.1em] animate-pulse rounded-full bg-accent align-text-bottom" />
                      )}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Actions */}
        {isLive ? (
          <button
            type="button"
            onClick={() => {
              userEndedRef.current = true;
              endCall('ended');
            }}
            aria-label="إنهاء المكالمة"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-all hover:bg-rose-500 active:scale-95"
          >
            <PhoneOffIcon className="h-6 w-6" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-6 py-2.5 text-sm font-semibold text-slate-200 transition-all hover:border-accent/50 hover:text-accent"
          >
            إغلاق
          </button>
        )}
      </div>
    </div>
  );
}

export default VoiceCall;
