import { clsx } from 'clsx'

const baseInput = [
  'w-full bg-[var(--bg-2)] border border-[var(--border)] rounded-lg',
  'px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]',
  'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[#6C63FF]/30',
  'hover:border-[var(--bg-3)]',
  'transition-all duration-150',
].join(' ')

export function Input({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="section-label">{label}</label>}
      <input className={clsx(baseInput, error && 'border-[#EF4444]', className)} {...props} />
      {error && <p className="text-xs text-[#EF4444]">{error}</p>}
    </div>
  )
}

export function Select({ className, label, children, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="section-label">{label}</label>}
      <select
        className={clsx(baseInput, 'cursor-pointer', className)}
        {...props}
      >
        {children}
      </select>
    </div>
  )
}

export function Textarea({ className, label, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="section-label">{label}</label>}
      <textarea
        className={clsx(baseInput, 'resize-none leading-relaxed', className)}
        {...props}
      />
    </div>
  )
}
