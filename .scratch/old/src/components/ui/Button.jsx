import { clsx } from 'clsx'

const variants = {
  primary:   [
    'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.98]',
    'text-white font-medium',
    'transition-all duration-100',
  ].join(' '),
  secondary: [
    'bg-[var(--bg-elevated)] hover:bg-[var(--bg-overlay)]',
    'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
    'border border-[var(--border)] hover:border-[var(--border-hover)]',
    'transition-all duration-100',
  ].join(' '),
  danger:    [
    'bg-[#EF4444]/10 hover:bg-[#EF4444]/15',
    'text-[#EF4444] border border-[#EF4444]/25 hover:border-[#EF4444]/50',
    'transition-all duration-100',
  ].join(' '),
  success:   'bg-[#22C55E]/10 hover:bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/25 transition-all duration-100',
  ghost:     'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-all duration-100',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-md h-7',
  md: 'px-4 py-2 text-sm gap-2 rounded-md h-8',
  lg: 'px-5 py-2.5 text-sm gap-2 rounded-lg h-9',
}

export function Button({ variant = 'primary', size = 'md', className, disabled, children, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]',
        'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg-surface)]',
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
