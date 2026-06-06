import React, { useCallback, useEffect, useRef, useState } from 'react';
import QuizVoiceClient from '../lib/quizVoiceClient';
import { matchVoiceAnswer } from '../lib/quizApi';
import { MicIcon, SpinnerIcon, ArrowLeftIcon } from './icons';

// Hands-free answering with a foolproof fallback. The student taps the mic and
// speaks the option (the letter "ألف", "خيار ب", "صح/خطأ", or reads a choice);
// the backend matcher resolves it to a choice index and we select it. Reuses the
// StrictMode-safe capture client (lib/quizVoiceClient) and matches Waaie's
// Slate/Teal language.
//
// Robustness (native SpeechRecognition can be unsupported, blocked, or drop its
// connection locally):
//   * every failure surfaces a clear, phase-specific message — never silent;
//   * a TEXT fallback ("اكتب إجابتك") is always one tap away and auto-opens on a
//     hard failure or when speech isn't supported — typed text runs through the
//     SAME `/quiz/voice-match` matcher, so the feature ALWAYS works;
//   * it is fully isolated from the realtime chat voice client (a separate
//     SpeechRecognition instance, torn down on unmount) — no shared state, no
//     conflict with an in-call mic.
function QuizVoiceButton({ options, language = 'ar', disabled = false, onPick }) {
  const [phase, setPhase] = useState('idle'); // idle | listening | matching
  const [interim, setInterim] = useState('');
  const [hint, setHint] = useState('');
  // The text fallback is open from the start when speech isn't supported, so an
  // unsupported browser (e.g. Firefox) has a working answer path immediately.
  const [showText, setShowText] = useState(() => !QuizVoiceClient.isSupported());
  const [textValue, setTextValue] = useState('');

  const clientRef = useRef(null);
  // Always-current props for the capture callbacks (the client is built once).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const languageRef = useRef(language);
  languageRef.current = language;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const supported = QuizVoiceClient.isSupported();

  const teardownClient = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stop();
      clientRef.current = null;
    }
  }, []);

  // Stop the recognizer if the question unmounts (advance / exit) mid-listen.
  useEffect(() => teardownClient, [teardownClient]);

  // New question (options changed): flush any in-flight listen and transient UI
  // so a previous attempt's transcript can't ghost into this one.
  useEffect(() => {
    teardownClient();
    setPhase('idle');
    setInterim('');
    setHint('');
    setTextValue('');
  }, [options, teardownClient]);

  // Resolve a transcript (spoken OR typed) to an option via the backend matcher.
  const resolveTranscript = useCallback(async (text, alternatives = []) => {
    if (!text) {
      setPhase('idle');
      setInterim('');
      setHint('لم ألتقط صوتًا واضحًا، حاول مرة أخرى أو اكتب إجابتك.');
      setShowText(true);
      return;
    }
    setPhase('matching');
    setInterim('');
    try {
      const { index } = await matchVoiceAnswer({
        transcript: text,
        alternatives,
        options: optionsRef.current,
        language: languageRef.current,
      });
      if (Number.isInteger(index) && index >= 0) {
        setHint('');
        setTextValue('');
        setShowText(false);
        setPhase('idle');
        onPickRef.current?.(index);
      } else {
        setPhase('idle');
        // Lone letters trip speech engines — steer toward a phrase, keep text open.
        setHint(
          `سمعت «${text}». جرّب أن تقول «الخيار الأول» أو «الإجابة الثانية»، أو اكتب إجابتك.`,
        );
        setShowText(true);
      }
    } catch {
      setPhase('idle');
      setHint('تعذّر التحقق من إجابتك، حاول مرة أخرى أو اكتب إجابتك.');
      setShowText(true);
    }
  }, []);

  const startListening = useCallback(() => {
    teardownClient();
    setHint('');
    setInterim('');
    const client = new QuizVoiceClient({
      language: languageRef.current,
      onStatus: (s) => {
        if (s === 'listening') setPhase('listening');
      },
      onInterim: (text) => setInterim(text),
      onResult: (text, alternatives) =>
        resolveTranscript(text.trim(), alternatives),
      onError: ({ phase: failPhase }) => {
        setPhase('idle');
        setInterim('');
        // Clear, specific message per failure — and open the text fallback so the
        // student is never stuck.
        if (failPhase === 'mic') {
          setHint('تعذّر الوصول إلى الميكروفون. اسمح بالإذن أو اكتب إجابتك.');
        } else if (failPhase === 'network') {
          setHint('تعذّر الاتصال بخدمة التعرّف على الصوت. تحقّق من الإنترنت أو اكتب إجابتك.');
        } else if (failPhase === 'unsupported') {
          setHint('الإدخال الصوتي غير مدعوم في هذا المتصفح. اكتب إجابتك.');
        } else {
          setHint('تعذّر التعرّف على الصوت. حاول مجددًا أو اكتب إجابتك.');
        }
        setShowText(true);
      },
    });
    clientRef.current = client;
    client.start();
  }, [resolveTranscript, teardownClient]);

  const handleMicClick = useCallback(() => {
    if (disabled || phase === 'matching') return;
    if (!supported) {
      setShowText(true);
      setHint('الإدخال الصوتي غير مدعوم في هذا المتصفح. اكتب إجابتك بدلاً من ذلك.');
      return;
    }
    if (phase === 'listening') {
      // Continuous capture: tapping again means "I'm done" — submit whatever was
      // captured rather than discarding it.
      if (clientRef.current) {
        clientRef.current.finalize();
      } else {
        teardownClient();
        setPhase('idle');
        setInterim('');
      }
      return;
    }
    startListening();
  }, [disabled, phase, supported, startListening, teardownClient]);

  const submitText = useCallback(() => {
    const value = textValue.trim();
    if (!value || disabled || phase === 'matching') return;
    resolveTranscript(value, []);
  }, [textValue, disabled, phase, resolveTranscript]);

  const listening = phase === 'listening';
  const matching = phase === 'matching';

  const micClass = listening
    ? 'border-accent/60 bg-accent/10 text-accent shadow-glow-accent'
    : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-accent/40 hover:text-accent';

  return (
    <div className="mt-3">
      {/* Mic button — only when speech is actually supported. */}
      {supported && (
        <button
          type="button"
          onClick={handleMicClick}
          disabled={disabled || matching}
          aria-pressed={listening}
          aria-label="الإجابة بالصوت"
          className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${micClass}`}
        >
          {matching ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              أتعرّف على إجابتك…
            </>
          ) : listening ? (
            <>
              <span className="relative flex h-4 w-4 items-center justify-center">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/40" />
                <MicIcon className="relative h-4 w-4" />
              </span>
              أنصت إليك… (اضغط عند الانتهاء)
            </>
          ) : (
            <>
              <MicIcon className="h-4 w-4" />
              أجب صوتيًا
            </>
          )}
        </button>
      )}

      {/* Live caption — the full transcript so far, streaming in real time, so
          the student sees the mic capturing every word. */}
      {listening && interim && (
        <div className="mt-2 flex items-start justify-center gap-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2">
          <span className="mt-1.5 flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <p className="text-right text-xs font-medium leading-relaxed text-slate-200">
            {interim}
          </p>
        </div>
      )}
      {listening && !interim && (
        <p className="mt-2 text-center text-[0.7rem] leading-relaxed text-slate-500">
          تحدّث بطبيعية — مثل «أعتقد أن الجواب فقرة ألف» أو «الخيار الثاني»، أو اقرأ
          نص الإجابة.
        </p>
      )}

      {/* Toggle to the text fallback (when not already shown). */}
      {!showText && !listening && !matching && (
        <button
          type="button"
          onClick={() => setShowText(true)}
          disabled={disabled}
          className="mt-2 block w-full text-center text-[0.72rem] font-semibold text-slate-500 underline-offset-2 transition-colors hover:text-accent hover:underline disabled:opacity-50"
        >
          أو اكتب إجابتك
        </button>
      )}

      {/* Text fallback — always works, even when speech is unsupported/failing. */}
      {showText && (
        <div className="mt-2 flex items-center gap-2" dir={language === 'en' ? 'ltr' : 'rtl'}>
          <input
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitText();
            }}
            disabled={disabled || matching}
            placeholder="اكتب إجابتك (الحرف، الرقم، أو نص الخيار)…"
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 transition-colors focus:border-accent/50 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submitText}
            disabled={disabled || matching || !textValue.trim()}
            aria-label="تحقّق من الإجابة المكتوبة"
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-4 py-2.5 text-sm font-bold text-slate-950 shadow-glow-accent transition-all enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {matching ? (
              <SpinnerIcon className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowLeftIcon className="h-4 w-4" />
            )}
            تحقّق
          </button>
        </div>
      )}

      {hint && (
        <p className="mt-2 text-center text-xs font-medium text-amber-400/90">
          {hint}
        </p>
      )}
    </div>
  );
}

export default QuizVoiceButton;
