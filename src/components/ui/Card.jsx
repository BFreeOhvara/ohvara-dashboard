import { clsx } from 'clsx'

export function Card({ className, children, ...props }) {
  return (
    <div
      className={clsx('bg-[#161b24] border border-[#2a3347] rounded-xl p-4', className)}
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
    <h2 className={clsx('text-base font-semibold text-slate-100', className)}>
      {children}
    </h2>
  )
}
