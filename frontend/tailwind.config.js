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
          DEFAULT: '#e0a86b',
          soft: '#f0c896',
          deep: '#c98a4a',
        },
      },
      boxShadow: {
        // Structural panels (bubbles, composer): soft depth + micro-glow.
        panel: '0 4px 24px rgba(0, 0, 0, 0.45)',
        glow: '0 0 20px rgba(0, 0, 0, 0.6)',
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
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(224,168,107,0.0)' },
          '50%': { boxShadow: '0 0 0 4px rgba(224,168,107,0.10)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.6s ease both',
        'glow-ring': 'glow-ring 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
