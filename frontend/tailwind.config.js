import colors from 'tailwindcss/colors';

/**
 * Theme: blood red on black.
 *
 * Token names are roles, not literal colours:
 *   accent    — the brand colour (blood red); its lightest steps are bone white for text
 *   navy      — the black surface scale
 *   ocean     — warm greys for labels and secondary text
 *   blood     — danger / first blood / wrong answers
 *   parchment — fills of poster surfaces (.parchment), near-black
 *   ink       — text on poster surfaces, bone white
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral greys everywhere Tailwind's blue-tinted slate would appear.
        slate: colors.neutral,
        abyss: '#030202',
        navy: {
          950: '#070506',
          900: '#0c0a0b',
          800: '#141112',
          700: '#1c1819',
          600: '#282224',
          500: '#3a3133',
        },
        ocean: {
          600: '#4a4043',
          500: '#6b5f62',
          400: '#8f8286',
          300: '#b0a5a8',
          200: '#cfc6c8',
        },
        accent: {
          100: '#ffffff',
          200: '#f4ecec',
          300: '#ff5c50',
          400: '#e8281c',
          500: '#c4160d',
          600: '#8e0f08',
          700: '#5a0905',
        },
        blood: {
          300: '#ff8a80',
          400: '#ff4d40',
          500: '#d01f14',
          600: '#9b1109',
          700: '#650a05',
        },
        parchment: {
          50: '#060404',
          100: '#f4ecec',
          200: '#1d1213',
          300: '#1a1011',
          400: '#2c1a1b',
        },
        ink: {
          900: '#f4ecec',
          700: '#c9bcbe',
          500: '#93868a',
        },
        jade: {
          300: '#7fe0b0',
          400: '#4ccb8f',
          500: '#3cc487',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      boxShadow: {
        deck: '0 18px 50px -20px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
        poster: '0 16px 34px -14px rgba(0, 0, 0, 0.95), inset 0 0 46px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(232, 40, 28, 0.18)',
        glow: '0 0 0 1px rgba(232, 40, 28, 0.45), 0 0 28px -4px rgba(232, 40, 28, 0.55)',
      },
      keyframes: {
        'wave-drift': { from: { transform: 'translate3d(0,0,0)' }, to: { transform: 'translate3d(-50%,0,0)' } },
        'ship-sail': { from: { transform: 'translate3d(-25vw,0,0)' }, to: { transform: 'translate3d(125vw,0,0)' } },
        bob: { '0%,100%': { transform: 'translateY(0) rotate(-2deg)' }, '50%': { transform: 'translateY(-7px) rotate(2deg)' } },
        'float-up': { '0%': { transform: 'translateY(0)', opacity: '0' }, '12%': { opacity: '0.7' }, '100%': { transform: 'translateY(-90vh)', opacity: '0' } },
        'cloud-drift': { from: { transform: 'translate3d(-30vw,0,0)' }, to: { transform: 'translate3d(130vw,0,0)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        shimmer: { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '1' } },
        'pulse-dot': { '0%,100%': { transform: 'scale(1)', opacity: '1' }, '50%': { transform: 'scale(1.6)', opacity: '0.35' } },
      },
      animation: {
        'wave-slow': 'wave-drift 26s linear infinite',
        'wave-mid': 'wave-drift 18s linear infinite',
        'wave-fast': 'wave-drift 12s linear infinite',
        'ship-sail': 'ship-sail 55s linear infinite',
        bob: 'bob 5s ease-in-out infinite',
        'float-up': 'float-up 14s linear infinite',
        'cloud-drift': 'cloud-drift 90s linear infinite',
        'spin-slow': 'spin-slow 60s linear infinite',
        shimmer: 'shimmer 3.2s ease-in-out infinite',
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
