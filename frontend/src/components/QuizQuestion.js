import React from 'react';
import { CheckIcon, CloseIcon, ArrowLeftIcon, SpinnerIcon, AwardIcon } from './icons';
import QuizVoiceButton from './QuizVoiceButton';

const AR_LETTERS = ['أ', 'ب', 'ج', 'د'];
const EN_LETTERS = ['A', 'B', 'C', 'D'];

// One question in the quiz loop: a progress + live-score HUD, the prompt, four
// options (answerable by tap OR voice), and a footer that turns into the reveal
// (correct/incorrect + explanation) after grading. English questions flip to an
// LTR layout; Arabic stays RTL.
function QuizQuestion({
  question,
  phase, // 'idle' | 'answering' | 'revealed'
  selected,
  score, // running correct-answer count (for the live-score HUD)
  result,
  isFinal,
  gradeError,
  onSelect,
  onConfirm,
  onVoicePick,
  onNext,
  onShowResult,
}) {
  const isEnglish = question.language === 'en';
  const dir = isEnglish ? 'ltr' : 'rtl';
  const align = isEnglish ? 'text-left' : 'text-right';
  const letters = isEnglish ? EN_LETTERS : AR_LETTERS;

  const revealed = phase === 'revealed';
  const answering = phase === 'answering';
  const correctIndex = result?.correct_index;
  const progress = Math.round((question.number / question.total) * 100);
  const runningScore = Number.isInteger(score) ? score : 0;

  const optionClass = (index) => {
    const baseCls =
      'group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-right transition-all duration-200';
    if (revealed) {
      if (index === correctIndex) {
        return `${baseCls} border-emerald-500/50 bg-emerald-500/10 text-emerald-200`;
      }
      if (index === selected) {
        return `${baseCls} border-rose-500/50 bg-rose-500/10 text-rose-200`;
      }
      return `${baseCls} border-slate-800 bg-slate-900/40 text-slate-500`;
    }
    if (index === selected) {
      return `${baseCls} border-accent/60 bg-accent/10 text-slate-100 shadow-glow-accent`;
    }
    return `${baseCls} border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80 hover:text-slate-100`;
  };

  const badgeClass = (index) => {
    const baseCls =
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors';
    if (revealed) {
      if (index === correctIndex)
        return `${baseCls} bg-emerald-500/20 text-emerald-300`;
      if (index === selected) return `${baseCls} bg-rose-500/20 text-rose-300`;
      return `${baseCls} bg-slate-800/60 text-slate-500`;
    }
    if (index === selected) return `${baseCls} bg-accent/20 text-accent`;
    return `${baseCls} bg-slate-800/60 text-slate-400 group-hover:text-slate-200`;
  };

  return (
    <div className="mx-auto w-full max-w-2xl animate-fade-in-up">
      {/* Progress + live-score HUD */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-400">
          <span>
            السؤال {question.number} من {question.total}
          </span>
          <span className="flex items-center gap-2">
            <span className="rounded-full bg-slate-800/70 px-2.5 py-1 text-slate-300">
              النتيجة الحالية: {runningScore}/{question.total}
            </span>
            <span className="text-accent">{progress}%</span>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/70">
          <div
            className="h-full rounded-full bg-gradient-to-l from-accent-deep via-accent to-accent-soft transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question card */}
      <div className="glass rounded-3xl p-6 shadow-card shadow-inner-hi sm:p-7">
        <p
          dir={dir}
          className={`${align} text-balance text-lg font-bold leading-relaxed text-slate-100 sm:text-xl`}
        >
          {question.question}
        </p>

        <div className="mt-6 space-y-2.5" dir={dir}>
          {question.options.map((option, index) => (
            <button
              key={index}
              type="button"
              disabled={phase !== 'idle'}
              onClick={() => onSelect(index)}
              className={optionClass(index)}
            >
              <span className={badgeClass(index)}>{letters[index]}</span>
              <span
                className={`flex-1 text-[0.97rem] font-medium leading-relaxed ${align}`}
              >
                {option}
              </span>
              {revealed && index === correctIndex && (
                <CheckIcon className="h-5 w-5 shrink-0 text-emerald-400" />
              )}
              {revealed && index === selected && index !== correctIndex && (
                <CloseIcon className="h-5 w-5 shrink-0 text-rose-400" />
              )}
            </button>
          ))}
        </div>

        {/* Explanation (after grading) */}
        {revealed && result?.explanation && (
          <div
            dir={dir}
            className={`mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/40 p-4 ${align}`}
          >
            <p className="mb-1 text-xs font-bold text-accent">التوضيح</p>
            <p className="text-[0.92rem] leading-relaxed text-slate-300">
              {result.explanation}
            </p>
          </div>
        )}
      </div>

      {/* Footer: confirm OR reveal + advance */}
      <div className="mt-5">
        {!revealed ? (
          <>
            <button
              type="button"
              onClick={() => onConfirm()}
              disabled={selected == null || answering}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-5 py-3.5 text-[0.95rem] font-bold text-slate-950 shadow-glow-accent transition-all duration-200 enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-800 disabled:bg-none disabled:text-slate-600 disabled:shadow-none"
            >
              {answering ? (
                <>
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  جارٍ التحقق…
                </>
              ) : (
                'تأكيد الإجابة'
              )}
            </button>
            {gradeError && (
              <p className="mt-2 text-center text-xs font-medium text-rose-400">
                تعذّر التحقق من الإجابة. أعد المحاولة.
              </p>
            )}
            {/* Hands-free: speak the answer to select + submit it. */}
            <QuizVoiceButton
              options={question.options}
              language={question.language}
              disabled={phase !== 'idle'}
              onPick={onVoicePick}
            />
          </>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold ${
                result.correct
                  ? 'bg-emerald-500/10 text-emerald-300'
                  : 'bg-rose-500/10 text-rose-300'
              }`}
            >
              {result.correct ? (
                <>
                  <CheckIcon className="h-4 w-4" />
                  إجابة صحيحة
                </>
              ) : (
                <>
                  <CloseIcon className="h-4 w-4" />
                  إجابة غير صحيحة
                </>
              )}
            </span>

            {isFinal ? (
              <button
                type="button"
                onClick={onShowResult}
                className="group flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-6 py-3 text-sm font-bold text-slate-950 shadow-glow-accent transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <AwardIcon className="h-4 w-4" />
                عرض النتيجة
              </button>
            ) : (
              <button
                type="button"
                onClick={onNext}
                className="group flex items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-accent/5 px-6 py-3 text-sm font-bold text-accent transition-all hover:border-accent/60 hover:bg-accent/10 active:scale-[0.98]"
              >
                السؤال التالي
                <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default QuizQuestion;
