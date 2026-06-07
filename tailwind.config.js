/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f1117',
          1: '#161b24',
          2: '#1e2433',
          3: '#252d3d',
        },
        border: '#2a3347',
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
        },
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        muted: '#64748b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
