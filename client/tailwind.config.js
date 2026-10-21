/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tc: {
          bg: '#0b0f19',
          sidebar: '#111827',
          panel: '#151d2e',
          card: '#1c263c',
          cardHover: '#25324e',
          border: '#232f46',
          borderLight: '#324364',
          primary: '#6366f1',
          primaryHover: '#4f46e5',
          green: '#10b981',
          coral: '#f43f5e',
          amber: '#f59e0b',
          purple: '#8b5cf6',
          cyan: '#06b6d4',
          text: '#e2e8f0',
          muted: '#8b9bb4',
          white: '#ffffff'
        }
      },
      animation: {
        'bounce-subtle': 'bounceSubtle 0.6s ease-in-out',
        'pulse-speaking': 'pulseSpeaking 1.5s infinite',
        'wave-bar': 'waveBar 1s ease-in-out infinite alternate',
      },
      keyframes: {
        bounceSubtle: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.08)' },
        },
        pulseSpeaking: {
          '0%': { boxShadow: '0 0 0 0 rgba(16, 185, 129, 0.7)' },
          '70%': { boxShadow: '0 0 0 10px rgba(16, 185, 129, 0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(16, 185, 129, 0)' },
        },
        waveBar: {
          '0%': { height: '4px' },
          '100%': { height: '16px' },
        }
      }
    },
  },
  plugins: [],
}
