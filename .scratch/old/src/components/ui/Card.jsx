import { clsx } from 'clsx'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={clsx(
        'glass p-4',
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
    <h2 className={clsx('text-sm font-medium text-[var(--text-primary)]', className)}>
      {children}
    </h2>
  )
}
