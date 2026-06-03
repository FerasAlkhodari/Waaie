/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        accent: {
          DEFAULT: '#2dd4bf',
          soft: '#5eead4',
          deep: '#0d9488',
        },
      },
      boxShadow: {
        // Structural panels (bubbles, composer): soft depth + micro-glow.
        panel: '0 4px 24px rgba(0, 0, 0, 0.45)',
        glow: '0 0 20px rgba(0, 0, 0, 0.6)',
        // Elevated cards (onboarding, profile widget): layered, premium depth.
        card: '0 12px 44px -14px rgba(0, 0, 0, 0.72), 0 2px 10px -2px rgba(0, 0, 0, 0.5)',
        // Accent-tinted halo for primary CTAs.
        'glow-accent':
          '0 0 0 1px rgba(45, 212, 191, 0.22), 0 14px 38px -12px rgba(13, 148, 136, 0.55)',
        // Crisp top inner highlight that sells "glass".
        'inner-hi': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.07)',
      },
      dropShadow: {
        glow: '0 0 10px rgba(45, 212, 191, 0.38)',
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'glow-ring': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(45,212,191,0.0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(45,212,191,0.12)' },
        },
        // Onboarding / modal entrance.
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96) translateY(12px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        // Slow, breathing ambient blobs for the background atmosphere.
        aurora: {
          '0%, 100%': {
            transform: 'translate3d(0,0,0) scale(1)',
            opacity: '0.55',
          },
          '50%': {
            transform: 'translate3d(3%, -4%, 0) scale(1.12)',
            opacity: '0.85',
          },
        },
        'aurora-alt': {
          '0%, 100%': {
            transform: 'translate3d(0,0,0) scale(1.06)',
            opacity: '0.5',
          },
          '50%': {
            transform: 'translate3d(-3%, 4%, 0) scale(1)',
            opacity: '0.8',
          },
        },
        // Sweeping highlight for gradient text / skeletons.
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
        // Voice-call equalizer bars.
        'bar-dance': {
          '0%, 100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.6s ease both',
        'glow-ring': 'glow-ring 2.4s ease-in-out infinite',
        'pop-in': 'pop-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        aurora: 'aurora 18s ease-in-out infinite',
        'aurora-alt': 'aurora-alt 22s ease-in-out infinite',
        shimmer: 'shimmer 2.6s linear infinite',
        float: 'float 6s ease-in-out infinite',
        'bar-dance': 'bar-dance 1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
