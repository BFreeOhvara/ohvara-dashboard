import { clsx } from 'clsx'

const baseInput = [
  'w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-md',
  'px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]',
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
  'transition-colors',
].join(' ')

export function Input({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="section-label">{label}</label>
      )}
      <input className={clsx(baseInput, error && 'border-red-500', className)} {...props} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

export function Select({ className, label, children, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="section-label">{label}</label>
      )}
      <select
        className={clsx(
          baseInput,
          'cursor-pointer',
          className
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

export function Textarea({ className, label, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="section-label">{label}</label>
      )}
      <textarea
        className={clsx(baseInput, 'resize-none', className)}
        {...props}
      />
    </div>
  )
}
