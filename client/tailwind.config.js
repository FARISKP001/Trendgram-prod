/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,css}',
    './node_modules/emoji-picker-react/**/*.{js,ts}', // for emoji picker styles (optional)
  ],
  theme: {
    extend: {
      boxShadow: {
        'neon': '0 0 10px #00ffe1',
      },
      scale: {
        '103': '1.03',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
