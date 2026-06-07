import { clsx } from 'clsx'

const variants = {
  primary:   'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-sm',
  secondary: 'bg-[var(--bg-2)] hover:bg-[var(--bg-3)] text-[var(--text-secondary)] border border-[var(--border)]',
  danger:    'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white',
  success:   'bg-green-600 hover:bg-green-500 text-white',
  ghost:     'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-2)]',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
}

export function Button({ variant = 'primary', size = 'md', className, disabled, children, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-md font-medium transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
        'focus-visible:ring-offset-[var(--bg-1)]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
