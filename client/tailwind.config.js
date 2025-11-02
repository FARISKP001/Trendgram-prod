/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,css}',
  ],
  theme: {
    extend: {
      boxShadow: {
        'neon': '0 0 10px #00ffe1',
      },
      textShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.6)',
        DEFAULT: '0 2px 4px rgba(0,0,0,0.8)',
        lg: '0 4px 6px rgba(0,0,0,0.9)',
      },
      scale: {
        '103': '1.03',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
