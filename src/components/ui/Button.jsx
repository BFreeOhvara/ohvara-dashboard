import { clsx } from 'clsx'

const variants = {
  primary:   [
    'bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.98]',
    'text-white font-semibold',
    'hover:shadow-[0_0_20px_var(--accent-glow)]',
    'transition-all duration-150',
  ].join(' '),
  secondary: [
    'bg-[var(--bg-2)] hover:bg-[var(--bg-3)]',
    'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
    'border border-[var(--border)]',
    'transition-all duration-150',
  ].join(' '),
  danger:    [
    'bg-[#EF4444]/10 hover:bg-[#EF4444]/20',
    'text-[#EF4444] border border-[#EF4444]/30',
    'hover:border-[#EF4444]/60',
    'transition-all duration-150',
  ].join(' '),
  success:   'bg-[#22C55E]/10 hover:bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/30 transition-all duration-150',
  ghost:     'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-2)] transition-all duration-150',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs gap-1.5 rounded-lg',
  md: 'px-4 py-2 text-sm gap-2 rounded-lg',
  lg: 'px-5 py-2.5 text-base gap-2 rounded-xl',
}

export function Button({ variant = 'primary', size = 'md', className, disabled, children, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1',
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
