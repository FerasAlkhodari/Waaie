import React, { useId } from 'react';

// Minimalist Waaie mark: a mentor/security shield fused with a
// terminal prompt (>_). Silver/zinc gradient body, amber cyber-accent
// glyph. Gradient IDs are namespaced via useId so multiple inline
// instances never collide in the DOM.
function BrandLogo({ className = 'h-9 w-9' }) {
  const id = useId();
  const shield = `shield-${id}`;
  const body = `body-${id}`;
  const accent = `accent-${id}`;

  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      fill="none"
      role="img"
      aria-label="واعي"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={shield} x1="6" y1="3" x2="34" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fafafa" />
          <stop offset="0.5" stopColor="#a1a1aa" />
          <stop offset="1" stopColor="#52525b" />
        </linearGradient>
        <linearGradient id={body} x1="20" y1="4" x2="20" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="#27272a" />
          <stop offset="1" stopColor="#101013" />
        </linearGradient>
        <linearGradient id={accent} x1="15" y1="15" x2="27" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f0c896" />
          <stop offset="1" stopColor="#c98a4a" />
        </linearGradient>
      </defs>

      {/* Shield body */}
      <path
        d="M20 3.5 L32.5 8.2 V19.6 C32.5 27.9 27 33.7 20 36.6 C13 33.7 7.5 27.9 7.5 19.6 V8.2 Z"
        fill={`url(#${body})`}
        stroke={`url(#${shield})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Subtle top highlight edge */}
      <path
        d="M20 3.5 L32.5 8.2 V11 L20 6.4 L7.5 11 V8.2 Z"
        fill="#ffffff"
        opacity="0.06"
      />

      {/* Terminal prompt: chevron + cursor */}
      <path
        d="M16 15.5 L20.5 20 L16 24.5"
        stroke={`url(#${accent})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 24.5 H26.5"
        stroke={`url(#${accent})`}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default React.memo(BrandLogo);
