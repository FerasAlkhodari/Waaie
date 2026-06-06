import React, { useState } from 'react';
import { CloseIcon, SparklesIcon, ArrowLeftIcon } from './icons';

const DIFFICULTIES = [
  { key: 'easy', label: 'سهل' },
  { key: 'medium', label: 'متوسط' },
  { key: 'hard', label: 'صعب' },
];

const COUNTS = [5, 10, 15, 20];

// Centered pop-up that configures one quiz run: difficulty + number of
// questions. Matches the onboarding modal language (glass card, pop-in, accent
// gradient CTA). Purely local state — the choice is handed back via onStart.
function QuizConfigModal({ subject, onStart, onClose }) {
  const [difficulty, setDifficulty] = useState('medium');
  const [count, setCount] = useState(10);

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={`إعداد اختبار ${subject.name_ar}`}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-5 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass relative w-full max-w-md animate-pop-in overflow-hidden rounded-3xl p-7 shadow-card shadow-inner-hi"
      >
        {/* top accent hairline */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/60 to-transparent" />

        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-slate-200"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <SparklesIcon className="h-3.5 w-3.5" />
          بنك الأسئلة
        </div>
        <h2 className="text-xl font-bold text-slate-100">
          اختبار <span className="text-gradient">{subject.name_ar}</span>
        </h2>
        <p className="mt-1.5 text-sm text-slate-400">
          اختر مستوى الصعوبة وعدد الأسئلة، وسنُولّد لك أسئلة جديدة في كل مرة.
        </p>

        {/* Difficulty */}
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold text-slate-300">مستوى الصعوبة</p>
          <div className="grid grid-cols-3 gap-2">
            {DIFFICULTIES.map((d) => {
              const active = d.key === difficulty;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => setDifficulty(d.key)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    active
                      ? 'border-accent/50 bg-accent/10 text-accent shadow-glow-accent'
                      : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Count */}
        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold text-slate-300">عدد الأسئلة</p>
          <div className="grid grid-cols-4 gap-2">
            {COUNTS.map((c) => {
              const active = c === count;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCount(c)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-bold transition-all ${
                    active
                      ? 'border-accent/50 bg-accent/10 text-accent shadow-glow-accent'
                      : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onStart({ difficulty, count })}
          className="group mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-5 py-3.5 text-[0.95rem] font-bold text-slate-950 shadow-glow-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
        >
          ابدأ الاختبار
          <ArrowLeftIcon className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1" />
        </button>
      </div>
    </div>
  );
}

export default QuizConfigModal;
