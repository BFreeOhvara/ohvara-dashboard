/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surface hierarchy — maps to CSS vars
        'bg-base':  'var(--bg-base)',
        'bg-deep':  'var(--bg-deep)',
        'bg-1':     'var(--bg-1)',
        'bg-2':     'var(--bg-2)',
        'bg-3':     'var(--bg-3)',
        'border-default': 'var(--border)',
        // Text
        'text-hi':  'var(--text-primary)',
        'text-lo':  'var(--text-secondary)',
        'text-dim': 'var(--text-muted)',
        // Accent
        accent: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
          subtle:  'var(--accent-subtle)',
        },
        // Keeping Tailwind's indigo/slate/green etc for compatibility
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        card:  'var(--shadow-card)',
        panel: 'var(--shadow-panel)',
      },
    },
  },
  plugins: [],
}
