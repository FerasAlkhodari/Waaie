import React, { useCallback, useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';
import QuizConfigModal from './QuizConfigModal';
import QuizQuestion from './QuizQuestion';
import {
  BankIcon,
  SparklesIcon,
  AwardIcon,
  RotateIcon,
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  LightbulbIcon,
} from './icons';
import {
  fetchQuizSubjects,
  startQuiz as apiStartQuiz,
  gradeQuizAnswer,
} from '../lib/quizApi';
import {
  loadAllActiveQuizzes,
  saveActiveQuiz,
  clearActiveQuiz,
} from '../lib/quizStorage';

// A friendly glyph per subject for the picker (purely decorative).
const SUBJECT_EMOJI = {
  math: '➗',
  physics: '⚛️',
  chemistry: '🧪',
  biology: '🧬',
  earth_science: '🌍',
  english: '🔤',
};

// Final-score banding mirrors the backend assessment levels.
const LEVEL_STYLE = {
  متقدم: { ring: 'text-emerald-400', chip: 'bg-emerald-500/10 text-emerald-300' },
  متوسط: { ring: 'text-amber-400', chip: 'bg-amber-500/10 text-amber-300' },
  مبتدئ: { ring: 'text-sky-400', chip: 'bg-sky-500/10 text-sky-300' },
};

const AR_LETTERS = ['أ', 'ب', 'ج', 'د'];
const EN_LETTERS = ['A', 'B', 'C', 'D'];

// Shared scroll shell, matching ChatPanel's container so the quiz sits in the
// same column layout. Module-level so it never remounts on a parent re-render.
function QuizShell({ children }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <main className="scrollbar-elegant flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}

// "يتم تجهيز الأسئلة…" — shown once while the WHOLE quiz is generated in a single
// bulk call; after this, question-to-question transitions are instant.
function GeneratingView() {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center text-center animate-fade-in">
      <div className="relative mb-6">
        <div className="absolute inset-0 rounded-3xl bg-accent/20 blur-2xl" />
        <BrandLogo className="relative h-14 w-14 animate-float drop-shadow-glow" />
      </div>
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent">
        <SparklesIcon className="h-3.5 w-3.5 animate-pulse" />
        صانع الأسئلة التفاعلي
      </div>
      <h3 className="text-shimmer animate-shimmer text-xl font-extrabold tracking-tight sm:text-2xl">
        يتم تجهيز أسئلتك…
      </h3>
      <p className="mt-2 text-sm text-slate-400">نُجهّز اختبارك كاملاً دفعة واحدة لتنتقل بين الأسئلة فورًا.</p>
      <div className="mt-5 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2.5 w-2.5 animate-bounce rounded-full bg-gradient-to-b from-accent-soft to-accent"
            style={{ animationDelay: `${i * 0.16}s`, animationDuration: '1s' }}
          />
        ))}
      </div>
    </div>
  );
}

// Resume banner shown on the home screen when an unfinished quiz is found in
// localStorage — Session Resume. Picks up with NO new model call.
function ResumeCard({ saved, onResume, onDiscard }) {
  const total = saved.questions.length;
  const atQuestion = Math.min(saved.index + 1, total);
  const name = saved.config?.subjectName || 'اختبارك';
  return (
    <div className="animate-fade-in rounded-2xl border border-accent/30 bg-accent/5 p-5 text-right">
      <div className="flex items-start gap-3">
        <RotateIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-100">لديك اختبار لم يكتمل</p>
          <p className="mt-0.5 text-[0.85rem] leading-relaxed text-slate-400">
            {name} — وصلت إلى السؤال {atQuestion} من {total} (النتيجة حتى الآن:{' '}
            {saved.score})
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onResume}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-4 py-2.5 text-sm font-bold text-slate-950 shadow-glow-accent transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          تابع الاختبار
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-400 transition-all hover:border-rose-500/40 hover:text-rose-300"
        >
          <CloseIcon className="h-4 w-4" />
          ابدأ من جديد
        </button>
      </div>
    </div>
  );
}

// Post-quiz mistake review + development points (نقاط التطوير). Lists each wrong
// answer (your choice vs. the correct one + the explanation) and distills the
// distinct weak topics into a short bulleted action list.
function MistakeReview({ review }) {
  const wrong = review.filter((r) => !r.correct);
  const topics = Array.from(
    new Set(wrong.map((r) => (r.topic || '').trim()).filter(Boolean)),
  );

  if (wrong.length === 0) {
    return (
      <div className="mx-auto mt-8 max-w-md rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
        <p className="text-sm font-bold text-emerald-300">
          أداء مثالي — لم تُخطئ في أي سؤال! 🎉
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          واصل على هذا المستوى، وجرّب صعوبة أعلى في المرة القادمة.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-9 w-full max-w-2xl">
      <h3 className="mb-3 text-right text-sm font-extrabold text-slate-200">
        مراجعة الأخطاء ({wrong.length})
      </h3>
      <div className="space-y-3">
        {wrong.map((r) => {
          const letters = r.language === 'en' ? EN_LETTERS : AR_LETTERS;
          const dir = r.language === 'en' ? 'ltr' : 'rtl';
          const align = r.language === 'en' ? 'text-left' : 'text-right';
          const yourAnswer =
            r.selected == null
              ? 'لم تُجب'
              : `${letters[r.selected]}. ${r.options[r.selected]}`;
          const correctAnswer = `${letters[r.correct_index]}. ${r.options[r.correct_index]}`;
          return (
            <div
              key={r.number}
              dir={dir}
              className={`rounded-2xl border border-slate-800/70 bg-slate-900/40 p-4 ${align}`}
            >
              <p className="mb-2 text-[0.9rem] font-bold leading-relaxed text-slate-200">
                <span className="text-slate-500">{r.number}.</span> {r.question}
              </p>
              <p className="flex items-start gap-1.5 text-[0.82rem] leading-relaxed text-rose-300">
                <CloseIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">إجابتك:</span> {yourAnswer}
                </span>
              </p>
              <p className="mt-1 flex items-start gap-1.5 text-[0.82rem] leading-relaxed text-emerald-300">
                <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">الإجابة الصحيحة:</span>{' '}
                  {correctAnswer}
                </span>
              </p>
              {r.explanation && (
                <p className="mt-2 text-[0.8rem] leading-relaxed text-slate-400">
                  {r.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-accent/25 bg-accent/5 p-4 text-right">
        <p className="mb-2 flex items-center justify-end gap-1.5 text-sm font-extrabold text-accent">
          نقاط التطوير
          <LightbulbIcon className="h-4 w-4" />
        </p>
        {topics.length > 0 ? (
          <ul className="space-y-1.5">
            {topics.map((topic) => (
              <li
                key={topic}
                className="flex items-start justify-end gap-2 text-[0.85rem] leading-relaxed text-slate-300"
              >
                <span>{topic}</span>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.85rem] leading-relaxed text-slate-300">
            راجع المفاهيم المرتبطة بالأسئلة التي أخطأت فيها أعلاه، وأعد الاختبار
            لتثبيتها.
          </p>
        )}
      </div>
    </div>
  );
}

function QuizPanel({ profile }) {
  const [subjects, setSubjects] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);

  const [stage, setStage] = useState('home'); // 'home'|'loading'|'active'|'result'
  const [configSubject, setConfigSubject] = useState(null); // open modal when set
  const [startError, setStartError] = useState(false);

  // The whole quiz, pre-fetched in one bulk call. quizMeta carries the run's
  // config (used to build the stateless grading payload + the persistence blob).
  const [quizMeta, setQuizMeta] = useState(null); // {subject,subjectName,difficulty,total}
  const [batch, setBatch] = useState(null); // [questionPayload, ...]
  const [index, setIndex] = useState(0); // 0-based position of current question
  const [score, setScore] = useState(0); // running correct count
  const [review, setReview] = useState([]); // graded entries (mistake review)

  const [phase, setPhase] = useState('idle'); // idle|answering|revealed
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [final, setFinal] = useState(null);
  const [gradeError, setGradeError] = useState(false);

  // Unfinished quizzes (one per subject) found in localStorage on mount / on
  // return to home — each gets its own resume card.
  const [resumables, setResumables] = useState([]);

  // Load the subject catalog once (StrictMode-safe via the cancelled guard) and
  // detect any unfinished quizzes to offer a resume.
  useEffect(() => {
    let cancelled = false;
    setResumables(loadAllActiveQuizzes());
    fetchQuizSubjects()
      .then((subs) => {
        if (cancelled) return;
        setSubjects(subs);
        setLoadError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSubjects([]);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirror the live quiz into localStorage (keyed by subject) at the given
  // resume point. When the point is past the last question (quiz finished), this
  // subject's saved blob is dropped — other subjects are untouched.
  const persist = useCallback((idx, scr, rev, questions, meta) => {
    if (!meta) return;
    if (!questions || idx >= questions.length) {
      clearActiveQuiz(meta.subject);
      return;
    }
    saveActiveQuiz(meta.subject, {
      config: {
        subject: meta.subject,
        subjectName: meta.subjectName,
        difficulty: meta.difficulty,
        total: questions.length,
      },
      questions,
      index: idx,
      score: scr,
      review: rev,
    });
  }, []);

  const resetActiveState = useCallback(() => {
    setBatch(null);
    setIndex(0);
    setScore(0);
    setReview([]);
    setSelected(null);
    setResult(null);
    setFinal(null);
    setPhase('idle');
    setGradeError(false);
    setStartError(false);
  }, []);

  // Generate the WHOLE quiz in one bulk call, then drive it locally.
  const startQuiz = useCallback(
    async (subjectId, cfg, subjectName) => {
      const meta = {
        subject: subjectId,
        subjectName: subjectName || subjectId,
        difficulty: cfg.difficulty,
        total: cfg.count,
      };
      // A brand-new run supersedes only THIS subject's saved one; other
      // subjects' unfinished quizzes are preserved.
      clearActiveQuiz(subjectId);
      setResumables(loadAllActiveQuizzes());
      setConfigSubject(null);
      resetActiveState();
      setQuizMeta(meta);
      setStage('loading');
      setStartError(false);

      try {
        const questions = await apiStartQuiz({
          subject: subjectId,
          difficulty: cfg.difficulty,
          total: cfg.count,
        });
        if (!questions || questions.length === 0) throw new Error('empty batch');
        const finalMeta = { ...meta, total: questions.length };
        setQuizMeta(finalMeta);
        setBatch(questions);
        setStage('active');
        persist(0, 0, [], questions, finalMeta);
      } catch {
        setStartError(true); // stays on the loading stage with a retry card
      }
    },
    [persist, resetActiveState],
  );

  const retryStart = useCallback(() => {
    if (!quizMeta) return;
    startQuiz(
      quizMeta.subject,
      { difficulty: quizMeta.difficulty, count: quizMeta.total },
      quizMeta.subjectName,
    );
  }, [quizMeta, startQuiz]);

  // Grade one answer (instant — no model call). `forcedIndex` lets the voice
  // path submit a freshly recognized choice without waiting on `selected` state.
  const confirmAnswer = useCallback(
    async (forcedIndex) => {
      // Only a real numeric index counts as a forced (voice) pick. A click
      // handler may invoke this with the click EVENT — which must never be sent
      // as `selected`, or the sealed-token grade rejects the payload and the UI
      // shows "تعذر التحقق من الإجابة". Fall back to the stored selection then.
      const choice = Number.isInteger(forcedIndex) ? forcedIndex : selected;
      if (choice == null || phase !== 'idle' || !batch) return;
      const current = batch[index];
      setSelected(choice);
      setPhase('answering');
      setGradeError(false);
      try {
        const data = await gradeQuizAnswer({
          quiz: {
            subject: quizMeta.subject,
            difficulty: quizMeta.difficulty,
            total: batch.length,
            index,
            score,
          },
          token: current.token,
          selected: choice,
        });
        const entry = {
          number: index + 1,
          question: current.question,
          options: current.options,
          language: current.language,
          // explanation + topic are generated lazily at grade time now.
          topic: data.result.topic || '',
          selected: choice,
          correct: data.result.correct,
          correct_index: data.result.correct_index,
          explanation: data.result.explanation,
        };
        const newReview = [...review, entry];
        const newScore = data.quiz.score;
        setReview(newReview);
        setScore(newScore);
        setResult(data.result);
        setFinal(data.final);
        setPhase('revealed');
        // Persist the resume point AFTER this question (drops storage on finish).
        persist(index + 1, newScore, newReview, batch, quizMeta);
      } catch {
        setGradeError(true);
        setPhase('idle'); // let the student retry the confirm
      }
    },
    [selected, phase, batch, index, score, review, quizMeta, persist],
  );

  // Voice answer: select the recognized option and submit it hands-free.
  const handleVoicePick = useCallback(
    (idx) => {
      if (phase !== 'idle') return;
      setSelected(idx);
      confirmAnswer(idx);
    },
    [phase, confirmAnswer],
  );

  const nextQuestion = useCallback(() => {
    const ni = index + 1;
    setIndex(ni);
    setSelected(null);
    setResult(null);
    setFinal(null);
    setPhase('idle');
    persist(ni, score, review, batch, quizMeta);
  }, [index, score, review, batch, quizMeta, persist]);

  const backToHome = useCallback(() => {
    setStage('home');
    setConfigSubject(null);
    resetActiveState();
    setQuizMeta(null);
    // Surface every unfinished quiz still saved (e.g. exited mid-way) to resume.
    setResumables(loadAllActiveQuizzes());
  }, [resetActiveState]);

  const showResult = useCallback(() => {
    setStage('result');
    // This subject's run is done — drop only its saved blob.
    if (quizMeta) clearActiveQuiz(quizMeta.subject);
    setResumables(loadAllActiveQuizzes());
  }, [quizMeta]);

  const restart = useCallback(() => {
    if (!quizMeta) return;
    startQuiz(
      quizMeta.subject,
      { difficulty: quizMeta.difficulty, count: quizMeta.total },
      quizMeta.subjectName,
    );
  }, [quizMeta, startQuiz]);

  // Resume a specific saved quiz from where it left off — no network call needed.
  const resumeQuiz = useCallback((saved) => {
    if (!saved) return;
    setQuizMeta({
      subject: saved.config.subject,
      subjectName: saved.config.subjectName,
      difficulty: saved.config.difficulty,
      total: saved.questions.length,
    });
    setBatch(saved.questions);
    setIndex(saved.index);
    setScore(saved.score || 0);
    setReview(Array.isArray(saved.review) ? saved.review : []);
    setSelected(null);
    setResult(null);
    setFinal(null);
    setPhase('idle');
    setGradeError(false);
    setStartError(false);
    setResumables([]);
    setStage('active');
  }, []);

  const discardSaved = useCallback((subject) => {
    clearActiveQuiz(subject);
    setResumables(loadAllActiveQuizzes());
  }, []);

  // --- Render -------------------------------------------------------------- //

  const Shell = QuizShell;

  // HOME — greeting + (optional) resume banner + subject grid.
  if (stage === 'home') {
    return (
      <Shell>
        <div className="animate-fade-in-up text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent">
            <BankIcon className="h-3.5 w-3.5" />
            بنك الأسئلة
          </div>
          <h2 className="text-balance text-3xl font-extrabold tracking-tight text-slate-100 sm:text-4xl">
            أهلاً {profile?.name ? profile.name : 'بك'}، اختبر{' '}
            <span className="text-gradient">معلوماتك</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-balance text-[0.95rem] leading-relaxed text-slate-400">
            اختر مادة، وسيصنع لك واعي أسئلة اختيار من متعدد جديدة في كل مرة، ثم
            يقيّم مستواك في النهاية.
          </p>
        </div>

        <div className="mt-8">
          {resumables.length > 0 && (
            <div className="mb-6 space-y-3">
              {resumables.map((saved) => (
                <ResumeCard
                  key={saved.subject}
                  saved={saved}
                  onResume={() => resumeQuiz(saved)}
                  onDiscard={() => discardSaved(saved.subject)}
                />
              ))}
            </div>
          )}

          {subjects === null ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-2xl border border-slate-800/60 bg-slate-900/40"
                />
              ))}
            </div>
          ) : loadError ? (
            <div className="mx-auto max-w-md rounded-2xl border border-accent/25 bg-accent/5 p-6 text-center">
              <p className="text-[0.95rem] leading-relaxed text-slate-300">
                تعذّر تحميل المواد. تأكد من اتصالك ثم أعد المحاولة.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSubjects(null);
                  setLoadError(false);
                  fetchQuizSubjects()
                    .then((s) => setSubjects(s))
                    .catch(() => {
                      setSubjects([]);
                      setLoadError(true);
                    });
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-bold text-accent transition-all hover:bg-accent/15"
              >
                <RotateIcon className="h-4 w-4" />
                إعادة المحاولة
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {subjects.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setConfigSubject(s)}
                  className="group flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-800/70 bg-slate-900/50 p-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:bg-slate-900/80 hover:shadow-glow-accent"
                >
                  <span className="text-3xl transition-transform duration-200 group-hover:scale-110">
                    {SUBJECT_EMOJI[s.id] || '📘'}
                  </span>
                  <span className="text-sm font-bold text-slate-100">
                    {s.name_ar}
                  </span>
                  <span className="text-[0.7rem] font-medium text-slate-500">
                    {s.name_en}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {configSubject && (
          <QuizConfigModal
            subject={configSubject}
            onStart={(cfg) => startQuiz(configSubject.id, cfg, configSubject.name_ar)}
            onClose={() => setConfigSubject(null)}
          />
        )}
      </Shell>
    );
  }

  // LOADING — the single bulk generation (or its retry on failure).
  if (stage === 'loading') {
    return (
      <Shell>
        {startError ? (
          <div className="mx-auto mt-10 max-w-md rounded-2xl border border-accent/25 bg-accent/5 p-6 text-center animate-fade-in">
            <p className="text-[0.95rem] leading-relaxed text-slate-300">
              تعذّر تجهيز الأسئلة. قد يكون الضغط عاليًا — أعد المحاولة.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={retryStart}
                className="inline-flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-bold text-accent transition-all hover:bg-accent/15"
              >
                <RotateIcon className="h-4 w-4" />
                إعادة المحاولة
              </button>
              <button
                type="button"
                onClick={backToHome}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-sm font-semibold text-slate-300 transition-all hover:text-slate-100"
              >
                رجوع
              </button>
            </div>
          </div>
        ) : (
          <GeneratingView />
        )}
      </Shell>
    );
  }

  // RESULT — score + assessment + mistake review (نقاط التطوير).
  if (stage === 'result' && final) {
    const pct = final.total ? Math.round((final.score / final.total) * 100) : 0;
    const level = final.assessment?.level || 'مبتدئ';
    const style = LEVEL_STYLE[level] || LEVEL_STYLE['مبتدئ'];
    return (
      <Shell>
        <div className="mx-auto max-w-md animate-pop-in text-center">
          <div className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-accent/15 blur-2xl" />
            <AwardIcon className={`relative h-16 w-16 ${style.ring} drop-shadow-glow`} />
          </div>

          <h2 className="text-2xl font-extrabold tracking-tight text-slate-100">
            انتهى الاختبار!
          </h2>
          <p className="mt-1.5 text-sm text-slate-400">
            هذه نتيجتك في {' '}
            <span className="font-semibold text-slate-300">
              اختبار {final.total} أسئلة
            </span>
          </p>

          <div className="my-7">
            <div className="text-5xl font-black text-slate-100">
              {final.score}
              <span className="text-2xl text-slate-500"> / {final.total}</span>
            </div>
            <div className="mt-2 text-sm font-semibold text-slate-400">
              {pct}% إجابات صحيحة
            </div>
          </div>

          <div
            className={`mx-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${style.chip}`}
          >
            <SparklesIcon className="h-4 w-4" />
            المستوى: {level}
          </div>
        </div>

        {/* Mistakes + development points */}
        <MistakeReview review={review} />

        <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={restart}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-5 py-3 text-sm font-bold text-slate-950 shadow-glow-accent transition-all hover:brightness-110 active:scale-[0.98]"
          >
            <RotateIcon className="h-4 w-4" />
            إعادة الاختبار
          </button>
          <button
            type="button"
            onClick={backToHome}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3 text-sm font-bold text-slate-200 transition-all hover:border-accent/40 hover:text-accent"
          >
            <BankIcon className="h-4 w-4" />
            مادة أخرى
          </button>
        </div>
      </Shell>
    );
  }

  // ACTIVE — the current pre-fetched question (instant transitions).
  const current = batch && batch[index];
  const currentQuestion = current
    ? { ...current, number: index + 1, total: batch.length }
    : null;

  return (
    <Shell>
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          onClick={backToHome}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4 rotate-180" />
          خروج
        </button>
        {batch && (
          <span className="rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1 text-xs font-semibold text-slate-400">
            النتيجة: {score}
          </span>
        )}
      </div>

      {currentQuestion && (
        <QuizQuestion
          question={currentQuestion}
          phase={phase}
          selected={selected}
          score={score}
          result={result}
          isFinal={!!final}
          gradeError={gradeError}
          onSelect={setSelected}
          onConfirm={confirmAnswer}
          onVoicePick={handleVoicePick}
          onNext={nextQuestion}
          onShowResult={showResult}
        />
      )}
    </Shell>
  );
}

export default QuizPanel;
