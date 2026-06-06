import React, { useEffect, useState } from 'react';
import { ECOSYSTEM } from '../data/ecosystem';
import {
  CloseIcon,
  SparklesIcon,
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  GridIcon,
  ShieldIcon,
  CodeIcon,
  CompassIcon,
  LandmarkIcon,
  TargetIcon,
  ScaleIcon,
} from './icons';

// String-keyed glyph lookup so data/ecosystem.js can stay pure JSON-ish data.
const ICONS = {
  shield: ShieldIcon,
  code: CodeIcon,
  compass: CompassIcon,
  landmark: LandmarkIcon,
  target: TargetIcon,
  scale: ScaleIcon,
};

// Friendly host for the preview footer (e.g. "cybergaurdai.lovable.app").
function siteHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// A single launcher card in the grid view.
function SiteCard({ site, onOpen }) {
  const Icon = ICONS[site.icon] || GridIcon;
  return (
    <button
      type="button"
      onClick={() => onOpen(site)}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 text-right transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-slate-900/80 hover:shadow-glow-accent"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent transition-colors group-hover:bg-accent/15">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-100">
            {site.title}
          </h3>
          <p className="truncate text-[0.65rem] font-semibold uppercase tracking-wider text-slate-500">
            {site.subtitle}
          </p>
        </div>
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed text-slate-400">
        {site.tagline}
      </p>
      <span className="mt-auto inline-flex items-center gap-1 text-[0.72rem] font-semibold text-accent/80 transition-colors group-hover:text-accent">
        اكتشف المنصة
        <ArrowLeftIcon className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-1" />
      </span>
    </button>
  );
}

// The full preview for one platform: description, feature grid, external CTA.
function SiteDetail({ site, onBack }) {
  const Icon = ICONS[site.icon] || GridIcon;
  return (
    <div className="animate-fade-in">
      <div className="border-b border-slate-800/50 px-6 pb-5 pt-7 sm:px-8">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition-colors hover:text-accent"
        >
          {/* RTL "back" points right. */}
          <ArrowLeftIcon className="h-3.5 w-3.5 rotate-180" />
          كل المنصّات
        </button>

        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <Icon className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-100 sm:text-2xl">
              {site.title}
            </h2>
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-slate-500">
              {site.subtitle}
            </p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-300">
          {site.description}
        </p>
      </div>

      <div className="scrollbar-elegant max-h-[42vh] overflow-y-auto px-6 py-5 sm:px-8">
        <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <SparklesIcon className="h-3.5 w-3.5 text-accent" />
          أبرز المزايا
        </p>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {site.features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2.5 rounded-xl border border-slate-800/70 bg-slate-900/40 p-3"
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
                <CheckIcon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs leading-relaxed text-slate-300">
                {feature}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-800/50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span className="inline-flex items-center gap-1.5 text-[0.72rem] font-medium text-slate-500">
          <ExternalLinkIcon className="h-3.5 w-3.5" />
          {siteHost(site.url)}
        </span>
        {/* External redirect — a plain anchor is the safest possible handler:
            new tab + noopener/noreferrer so the target can't reach window.opener. */}
        <a
          href={site.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-accent-deep via-accent to-accent-soft px-6 py-3 text-sm font-bold text-slate-950 shadow-glow-accent transition-all duration-200 hover:brightness-110 active:scale-[0.98]"
        >
          انتقل إلى المنصة 🚀
        </a>
      </div>
    </div>
  );
}

// Centered glass modal hosting the ecosystem. Two views in one surface: a grid
// launcher and a per-site preview (selected ? detail : grid). Matches the
// onboarding / quiz-config modal language (glass card, pop-in, accent gradient).
function EcosystemHub({ onClose }) {
  const [selected, setSelected] = useState(null);

  // Esc steps back out: detail → grid → closed.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      if (selected) setSelected(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onClose]);

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label="منظومة واعي الذكية"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm animate-fade-in sm:p-6"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass relative w-full max-w-3xl animate-pop-in overflow-hidden rounded-3xl shadow-card shadow-inner-hi"
      >
        {/* top accent hairline */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/60 to-transparent" />

        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="absolute left-4 top-4 z-10 rounded-lg p-1.5 text-slate-500 transition-colors hover:text-slate-200"
        >
          <CloseIcon className="h-5 w-5" />
        </button>

        {selected ? (
          <SiteDetail site={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="animate-fade-in">
            <div className="border-b border-slate-800/50 px-6 pb-5 pt-7 sm:px-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                <SparklesIcon className="h-3.5 w-3.5" />
                منظومة واعي
              </div>
              <h2 className="mt-3 text-2xl font-bold text-slate-100">
                منصّات <span className="text-gradient">واعي</span> الشقيقة
              </h2>
              <p className="mt-1.5 text-sm text-slate-400">
                ست تجارب ذكاء اصطناعي تُكمّل رحلتك — اختر منصّة لاستكشاف مزاياها
                والانتقال إليها.
              </p>
            </div>

            <div className="scrollbar-elegant max-h-[60vh] overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {ECOSYSTEM.map((site) => (
                  <SiteCard key={site.key} site={site} onOpen={setSelected} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EcosystemHub;
