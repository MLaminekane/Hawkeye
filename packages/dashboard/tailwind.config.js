/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hawk: {
          bg: '#09090B',
          surface: '#16161D',
          surface2: '#1E1E28',
          surface3: '#262632',
          border: '#2A2A3A',
          orange: '#FF6B2B',
          green: '#2ECC71',
          amber: '#FFB443',
          red: '#FF4757',
          text: '#E8E8ED',
          text2: '#9898A8',
          text3: '#5A5A6E',
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
