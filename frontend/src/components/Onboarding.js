import React, { useEffect, useRef, useState } from 'react';
import BrandLogo from './BrandLogo';
import {
  UserIcon,
  MailIcon,
  CheckIcon,
  SparklesIcon,
  ArrowLeftIcon,
  CloseIcon,
} from './icons';

const SUBJECTS = [
  'الرياضيات',
  'الفيزياء',
  'الكيمياء',
  'الأحياء وعلوم الأرض',
  'التقنية الرقمية',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// First-run gate (and profile editor). Collects the student's name + email
// before unlocking the workspace. Purely local — see useProfile.
function Onboarding({ initial = null, allowCancel = false, onCancel, onSubmit }) {
  const [name, setName] = useState(initial?.name || '');
  const [email, setEmail] = useState(initial?.email || '');
  const [touched, setTouched] = useState({ name: false, email: false });
  const nameRef = useRef(null);

  useEffect(() => {
    // Drop focus straight into the first field for a fast, keyboard-first start.
    nameRef.current?.focus();
  }, []);

  const nameValid = name.trim().length >= 2;
  const emailValid = EMAIL_RE.test(email.trim());
  const canSubmit = nameValid && emailValid;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canSubmit) {
      setTouched({ name: true, email: true });
      return;
    }
    onSubmit({ name: name.trim(), email: email.trim() });
  };

  const showNameError = touched.name && !nameValid;
  const showEmailError = touched.email && !emailValid;

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="مرحباً بك في واعي"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950 p-5 sm:p-8"
    >
      {/* Ambient atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/4 right-[-12%] h-[55vh] w-[55vh] rounded-full bg-accent/15 blur-[130px] animate-aurora" />
        <div className="absolute bottom-[-20%] left-[-12%] h-[50vh] w-[50vh] rounded-full bg-sky-500/12 blur-[130px] animate-aurora-alt" />
        <div className="absolute inset-0 opacity-[0.02] [background-image:linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="absolute inset-0 bg-noise opacity-[0.04] mix-blend-soft-light" />
      </div>

      <div className="relative grid w-full max-w-5xl animate-pop-in items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        {/* Brand / welcome side */}
        <section className="text-center lg:text-right">
          <div className="mb-7 flex justify-center lg:justify-start">
            <div className="relative">
              <div className="absolute inset-0 rounded-3xl bg-accent/20 blur-2xl" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-slate-800/70 bg-slate-900/70 shadow-card animate-float">
                <BrandLogo className="h-12 w-12 drop-shadow-glow" />
              </div>
            </div>
          </div>

          <div
            className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3.5 py-1.5 text-xs font-semibold text-accent animate-fade-in-up"
            style={{ animationDelay: '0.05s' }}
          >
            <SparklesIcon className="h-3.5 w-3.5" />
            مرشدك الذكي للمرحلة الثانوية
          </div>

          <h1
            className="text-balance text-4xl font-extrabold leading-tight tracking-tight text-slate-100 animate-fade-in-up sm:text-5xl"
            style={{ animationDelay: '0.12s' }}
          >
            أهلاً بك في <span className="text-gradient">واعي</span>
          </h1>

          <p
            className="mx-auto mt-4 max-w-md text-balance text-[1.02rem] leading-relaxed text-slate-400 animate-fade-in-up lg:mx-0"
            style={{ animationDelay: '0.2s' }}
          >
            رفيقك في المذاكرة عبر الدردشة والصوت. عرّفنا باسمك وبريدك لنبدأ رحلة
            تعلّم مصمّمة لك.
          </p>

          <div
            className="mt-7 flex flex-wrap justify-center gap-2 animate-fade-in-up lg:justify-start"
            style={{ animationDelay: '0.28s' }}
          >
            {SUBJECTS.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-900/50 px-3 py-1.5 text-xs font-medium text-slate-300"
              >
                <CheckIcon className="h-3.5 w-3.5 text-accent" />
                {s}
              </span>
            ))}
          </div>
        </section>

        {/* Form side */}
        <section
          className="relative animate-fade-in-up"
          style={{ animationDelay: '0.18s' }}
        >
          <div className="glass relative overflow-hidden rounded-3xl p-7 shadow-card shadow-inner-hi sm:p-8">
            {/* top accent hairline */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/60 to-transparent" />

            {allowCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="إغلاق"
                className="absolute left-4 top-4 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-slate-200"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            )}

            <h2 className="text-xl font-bold text-slate-100">
              {initial ? 'تعديل ملفّك' : 'لنُجهّز حسابك'}
            </h2>
            <p className="mt-1.5 text-sm text-slate-400">
              {initial
                ? 'حدّث اسمك أو بريدك الإلكتروني.'
                : 'خطوة واحدة سريعة تفصلك عن واعي.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
              {/* Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ob-name"
                  className="block text-xs font-semibold text-slate-300"
                >
                  الاسم
                </label>
                <div
                  className={`group flex items-center gap-2.5 rounded-2xl border bg-slate-950/50 px-3.5 transition-all focus-within:border-accent/60 focus-within:shadow-glow-accent ${
                    showNameError ? 'border-rose-500/50' : 'border-slate-800'
                  }`}
                >
                  <UserIcon className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-focus-within:text-accent" />
                  <input
                    id="ob-name"
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                    placeholder="اكتب اسمك"
                    autoComplete="name"
                    className="w-full bg-transparent py-3 text-[0.95rem] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
                {showNameError && (
                  <p className="text-xs text-rose-400">
                    الرجاء إدخال اسم لا يقل عن حرفين.
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label
                  htmlFor="ob-email"
                  className="block text-xs font-semibold text-slate-300"
                >
                  البريد الإلكتروني
                </label>
                <div
                  className={`group flex items-center gap-2.5 rounded-2xl border bg-slate-950/50 px-3.5 transition-all focus-within:border-accent/60 focus-within:shadow-glow-accent ${
                    showEmailError ? 'border-rose-500/50' : 'border-slate-800'
                  }`}
                >
                  <MailIcon className="h-4 w-4 shrink-0 text-slate-500 transition-colors group-focus-within:text-accent" />
                  <input
                    id="ob-email"
                    type="email"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    placeholder="name@example.com"
                    autoComplete="email"
                    className="w-full bg-transparent py-3 text-left font-mono text-[0.9rem] text-slate-100 placeholder:text-slate-600 focus:outline-none"
                  />
                </div>
                {showEmailError && (
                  <p className="text-xs text-rose-400">
                    صيغة البريد الإلكتروني غير صحيحة.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="group mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-5 py-3.5 text-[0.95rem] font-bold text-slate-950 shadow-glow-accent transition-all duration-200 enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {initial ? 'حفظ التغييرات' : 'ابدأ التعلّم'}
                <ArrowLeftIcon className="h-4 w-4 transition-transform duration-200 group-enabled:group-hover:-translate-x-1" />
              </button>
            </form>

            <p className="mt-5 text-center text-[0.7rem] leading-relaxed text-slate-500">
              تُحفظ بياناتك على جهازك فقط ولا تُرسَل إلى أي خادم.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Onboarding;
