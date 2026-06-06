import React from 'react';

// Hand-rolled inline icons matching the existing AttachIcon/SendIcon style
// (24x24, stroke=currentColor, round caps) — no icon-library dependency.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const PlusIcon = React.memo(function PlusIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
});

export const MenuIcon = React.memo(function MenuIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
});

export const TrashIcon = React.memo(function TrashIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6M10 11v6M14 11v6" />
    </svg>
  );
});

export const CloseIcon = React.memo(function CloseIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
});

export const ChatIcon = React.memo(function ChatIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  );
});

export const MicIcon = React.memo(function MicIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
    </svg>
  );
});

export const PhoneOffIcon = React.memo(function PhoneOffIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-3.33-2.67m-2.67-3.34A19.79 19.79 0 012.92 4.18 2 2 0 014.91 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91M1 1l22 22" />
    </svg>
  );
});

export const SpinnerIcon = React.memo(function SpinnerIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
});

export const UserIcon = React.memo(function UserIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
});

export const MailIcon = React.memo(function MailIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 6L2 7" />
    </svg>
  );
});

export const GearIcon = React.memo(function GearIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
});

export const CheckIcon = React.memo(function CheckIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
});

export const SparklesIcon = React.memo(function SparklesIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5 10.1 7.6 12 3z" />
      <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </svg>
  );
});

// Points left — the RTL "forward / proceed" direction for primary actions.
export const ArrowLeftIcon = React.memo(function ArrowLeftIcon({
  className = '',
}) {
  return (
    <svg {...base} className={className}>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
});

// Stacked layers — the "Question Bank" (بنك الأسئلة) affordance.
export const BankIcon = React.memo(function BankIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
});

// Medal — crowns the final score screen.
export const AwardIcon = React.memo(function AwardIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="6" />
      <path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.11" />
    </svg>
  );
});

// Circular arrow — "retry / restart the quiz".
export const RotateIcon = React.memo(function RotateIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M3 12a9 9 0 109-9 9 9 0 00-6.36 2.64L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
});

// Lightbulb — heads the "نقاط التطوير" insights in the post-quiz review.
export const LightbulbIcon = React.memo(function LightbulbIcon({
  className = '',
}) {
  return (
    <svg {...base} className={className}>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z" />
    </svg>
  );
});

// 2×2 tile grid — the "Waaie Ecosystem" launcher (a constellation of sister apps).
export const GridIcon = React.memo(function GridIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
});

// Box with an out-arrow — "opens an external site in a new tab".
export const ExternalLinkIcon = React.memo(function ExternalLinkIcon({
  className = '',
}) {
  return (
    <svg {...base} className={className}>
      <path d="M15 3h6v6M10 14L21 3" />
      <path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />
    </svg>
  );
});

// Shield + check — CyberGuard (digital protection).
export const ShieldIcon = React.memo(function ShieldIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
});

// Angle brackets — BITBOT (programming).
export const CodeIcon = React.memo(function CodeIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6M13.5 4l-3 16" />
    </svg>
  );
});

// Compass — Nibras (a guiding light through exam prep).
export const CompassIcon = React.memo(function CompassIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M16.24 7.76l-2.83 6.36-6.36 2.83 2.83-6.36 6.36-2.83z" />
    </svg>
  );
});

// Landmark / monument — Vision 2030 (national mega-projects).
export const LandmarkIcon = React.memo(function LandmarkIcon({
  className = '',
}) {
  return (
    <svg {...base} className={className}>
      <path d="M3 21h18M5 21V10l7-4 7 4v11M9 21v-5h6v5M9 12h.01M15 12h.01" />
    </svg>
  );
});

// Concentric target — Qudra (aptitude / precision).
export const TargetIcon = React.memo(function TargetIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
});

// Balance scale — the AI Legal Advisor (justice).
export const ScaleIcon = React.memo(function ScaleIcon({ className = '' }) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3v18M8 21h8M5 7h14" />
      <path d="M5 7l-3 7h6l-3-7zM19 7l-3 7h6l-3-7z" />
    </svg>
  );
});
