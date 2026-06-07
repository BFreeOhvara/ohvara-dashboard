import { clsx } from 'clsx'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-1)] border border-[var(--border)] rounded-xl p-4',
        'shadow-[var(--shadow-card)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }) {
  return (
    <div className={clsx('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className }) {
  return (
    <h2 className={clsx('text-sm font-semibold text-[var(--text-primary)] tracking-tight', className)}>
      {children}
    </h2>
  )
}
