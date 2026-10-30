import { clsx } from 'clsx'

const baseInput = [
  'w-full bg-[var(--bg-base)] border border-[var(--border)]',
  'rounded-md px-3 py-2 text-sm text-[var(--text-primary)]',
  'placeholder-[var(--text-muted)]',
  'focus:outline-none focus:border-[var(--accent)]',
  'hover:border-[var(--border-hover)]',
  'transition-colors duration-100',
].join(' ')

export function Input({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="section-label">{label}</label>}
      <input className={clsx(baseInput, error && 'border-[#EF4444]', className)} {...props} />
      {error && <p className="text-xs text-[#EF4444] mt-0.5">{error}</p>}
    </div>
  )
}

export function Textarea({ className, label, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="section-label">{label}</label>}
      <textarea className={clsx(baseInput, 'resize-none leading-relaxed', className)} {...props} />
    </div>
  )
}
