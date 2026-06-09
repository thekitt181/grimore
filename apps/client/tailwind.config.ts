import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0f',
          secondary: '#12121a',
          tertiary: '#1c1c28',
        },
        accent: {
          gold: '#c9a84c',
          red: '#8b1a1a',
          'red-hot': '#d42b2b',
        },
        text: {
          primary: '#e8e0d0',
          secondary: '#8a8075',
        },
        border: {
          DEFAULT: '#2a2a3a',
          gold: '#c9a84c44',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'serif'],
        body: ['Crimson Text', 'serif'],
        ui: ['Inter', 'sans-serif'],
      },
      backgroundImage: {
        'parchment-texture': "url('/textures/parchment.png')",
      },
      boxShadow: {
        gold: '0 0 12px rgba(201, 168, 76, 0.3)',
        red: '0 0 12px rgba(212, 43, 43, 0.4)',
        panel: '0 4px 24px rgba(0, 0, 0, 0.6)',
      },
      animation: {
        'torch-flicker': 'torchFlicker 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
      },
      keyframes: {
        torchFlicker: {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.85', filter: 'brightness(0.9)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 6px rgba(201, 168, 76, 0.3)' },
          '50%': { boxShadow: '0 0 20px rgba(201, 168, 76, 0.6)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
