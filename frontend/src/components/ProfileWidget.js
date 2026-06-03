import React from 'react';
import { GearIcon } from './icons';

// Derive up-to-two initials from the student's name for the avatar fallback.
function initialsOf(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] || '') + (parts[1][0] || '');
}

// Pinned account card at the foot of the sidebar. Shows who's signed in and
// offers a quick way back into the profile editor.
function ProfileWidget({ profile, onEdit }) {
  if (!profile) return null;

  return (
    <div className="border-t border-slate-800/50 p-3">
      <div className="group flex items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/50 p-2.5 transition-colors hover:border-slate-700">
        {/* Initials avatar with a live presence dot */}
        <div className="relative shrink-0">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-deep via-accent to-accent-soft text-sm font-bold text-slate-950 shadow-glow-accent">
            {initialsOf(profile.name)}
          </div>
          <span className="absolute -bottom-0.5 -left-0.5 h-3 w-3 rounded-full border-2 border-slate-900 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
        </div>

        {/* Name + email, stacked and truncated to keep the card tidy */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {profile.name}
          </p>
          <p
            dir="ltr"
            className="truncate text-right font-mono text-[0.7rem] text-slate-500"
          >
            {profile.email}
          </p>
        </div>

        <button
          type="button"
          onClick={onEdit}
          aria-label="تعديل الملف الشخصي"
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800/70 hover:text-accent"
        >
          <GearIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default React.memo(ProfileWidget);
