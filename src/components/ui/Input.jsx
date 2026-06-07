import { clsx } from 'clsx'

export function Input({ className, label, error, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-slate-400">{label}</label>}
      <input
        className={clsx(
          'bg-[#1e2433] border border-[#2a3347] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
          error && 'border-red-500',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

export function Select({ className, label, children, ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-slate-400">{label}</label>}
      <select
        className={clsx(
          'bg-[#1e2433] border border-[#2a3347] rounded-lg px-3 py-2 text-sm text-slate-100',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
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
      {label && <label className="text-sm text-slate-400">{label}</label>}
      <textarea
        className={clsx(
          'bg-[#1e2433] border border-[#2a3347] rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent',
          className
        )}
        {...props}
      />
    </div>
  )
}
