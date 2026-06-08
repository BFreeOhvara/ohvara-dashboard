/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-base':     'var(--bg-base)',
        'bg-surface':  'var(--bg-surface)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-overlay':  'var(--bg-overlay)',
        'bg-deep': 'var(--bg-deep)',
        'bg-1':    'var(--bg-1)',
        'bg-2':    'var(--bg-2)',
        'bg-3':    'var(--bg-3)',
        'text-hi':  'var(--text-primary)',
        'text-lo':  'var(--text-secondary)',
        'text-dim': 'var(--text-muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
          subtle:  'var(--accent-subtle)',
          dim:     'var(--accent-dim)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'monospace'],
      },
      borderRadius: {
        sm:    '4px',
        md:    '6px',
        lg:    '8px',
        xl:    '10px',
        '2xl': '10px',
      },
    },
  },
  plugins: [],
}
