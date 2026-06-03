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
