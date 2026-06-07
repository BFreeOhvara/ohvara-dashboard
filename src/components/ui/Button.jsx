import { clsx } from 'clsx'

const variants = {
  primary:   'bg-indigo-600 hover:bg-indigo-500 text-white',
  secondary: 'bg-surface-2 hover:bg-surface-3 text-slate-200 border border-border',
  danger:    'bg-red-600 hover:bg-red-500 text-white',
  success:   'bg-green-600 hover:bg-green-500 text-white',
  ghost:     'hover:bg-surface-2 text-slate-400 hover:text-slate-200',
}

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export function Button({ variant = 'primary', size = 'md', className, disabled, children, ...props }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-40 disabled:cursor-not-allowed',
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
