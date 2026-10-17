/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        orca: {
          dark: '#0d1117',
          card: '#161b22',
          cardMuted: '#090d13',
          border: '#30363d',
          accent: '#1f6feb',
          highlight: '#e3b341'
        }
      }
    },
  },
  plugins: [],
}
