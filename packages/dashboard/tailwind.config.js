/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        hawk: {
          bg: 'var(--hawk-bg)',
          surface: 'var(--hawk-surface)',
          surface2: 'var(--hawk-surface2)',
          surface3: 'var(--hawk-surface3)',
          border: 'var(--hawk-border)',
          orange: '#FF6B2B',
          green: '#2ECC71',
          amber: '#FFB443',
          red: '#FF4757',
          text: 'var(--hawk-text)',
          text2: 'var(--hawk-text2)',
          text3: 'var(--hawk-text3)',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Space Grotesk', 'sans-serif'],
        body: ['DM Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
