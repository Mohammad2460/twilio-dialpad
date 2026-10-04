import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      keyframes: {
        // Entrance: a short rise, fast start and soft landing.
        'rise-in': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        // Outgoing-call ring around the avatar.
        'ring-out': { from: { opacity: '0.5', transform: 'scale(1)' }, to: { opacity: '0', transform: 'scale(1.7)' } },
        // One bar of the "audio is live" meter.
        'level': { '0%, 100%': { transform: 'scaleY(0.3)' }, '50%': { transform: 'scaleY(1)' } },
        // Highlighter sweeping across a phrase.
        'mark-in': { from: { backgroundSize: '0% 100%' }, to: { backgroundSize: '100% 100%' } },
      },
      animation: {
        'rise-in': 'rise-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'ring-out': 'ring-out 1.4s cubic-bezier(0.16, 1, 0.3, 1) infinite',
        'level': 'level 900ms ease-in-out infinite',
        'mark-in': 'mark-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config;
