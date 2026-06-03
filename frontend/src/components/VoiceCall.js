import React, { useCallback, useEffect, useRef, useState } from 'react';
import VoiceClient from '../lib/voiceClient';
import BrandLogo from './BrandLogo';
import { PhoneOffIcon, SpinnerIcon, CloseIcon } from './icons';

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
// error name/message appended so the exact cause is always visible.
const ERROR_HINTS = {
  mic: 'تعذّر الوصول إلى الميكروفون. تأكّد من السماح بالإذن ومن وجود ميكروفون متصل.',
  audio: 'تعذّر تشغيل نظام الصوت في المتصفح. جرّب متصفحًا حديثًا (Chrome/Edge/Firefox).',
  connection:
    'تعذّر الاتصال بخادم الصوت. تأكّد من تشغيل الخادم على المنفذ 8000.',
};

function VoiceCall({ onClose }) {
  const [status, setStatus] = useState('connecting');
  const [elapsed, setElapsed] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [errorInfo, setErrorInfo] = useState(null); // { name, message, phase }

  const clientRef = useRef(null);
  const timerRef = useRef(null);
  // Tracks whether we reached the cap, so a server close reads as "timeout".
  const elapsedAtCapRef = useRef(false);
  // Latest status without re-subscribing the interval each tick.
  const statusRef = useRef('connecting');
  statusRef.current = status;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

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
    },
    [clearTimer],
  );

  useEffect(() => {
    let cancelled = false;

    const client = new VoiceClient({
      onError: (info) => {
        if (!cancelled) setErrorInfo(info);
      },
      onStatus: (s) => {
        if (cancelled) return;
        if (s === 'connected') {
          setStatus('active');
        } else if (s === 'error') {
          endCall('error');
        } else if (s === 'closed') {
          // A server-side close (incl. the 5-min cap) while we still think the
          // call is live: treat as timeout if we're at the cap, else ended.
          if (statusRef.current === 'active' || statusRef.current === 'connecting') {
            endCall(elapsedAtCapRef.current ? 'timeout' : 'ended');
          }
        }
      },
      onEvent: (event) => {
        if (cancelled) return;
        // Light speaking indicator driven by the assistant's audio stream
        // (GA Realtime event names: response.output_audio.delta / .done).
        if (event.type === 'response.output_audio.delta') setSpeaking(true);
        else if (
          event.type === 'response.output_audio.done' ||
          event.type === 'response.done'
        ) {
          setSpeaking(false);
        }
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLive = status === 'connecting' || status === 'active';
  const isTerminal = status === 'timeout' || status === 'error' || status === 'ended';

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-5 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="مكالمة صوتية مع واعي"
    >
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-slate-800/70 bg-slate-900/80 px-8 py-10 text-center shadow-panel">
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
          {status === 'error' && (
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

        {/* Actions */}
        {isLive ? (
          <button
            type="button"
            onClick={() => endCall('ended')}
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
