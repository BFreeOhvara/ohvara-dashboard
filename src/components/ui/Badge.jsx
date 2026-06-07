import { clsx } from 'clsx'

// Every status has color + label — never color alone
const STATUS_STYLES = {
  // Lead statuses
  'New':            'bg-slate-800 text-[var(--text-secondary)] border border-slate-700',
  'Contacted':      'bg-blue-950 text-blue-300 border border-blue-800',
  'Voicemail':      'bg-amber-950 text-amber-300 border border-amber-800',
  'No Answer':      'bg-orange-950 text-orange-300 border border-orange-800',
  'Interested':     'bg-emerald-950 text-emerald-300 border border-emerald-800',
  'Booked':         'bg-indigo-950 text-indigo-300 border border-indigo-800',
  'Not Interested': 'bg-red-950 text-red-400 border border-red-900',
  // Appointment outcomes
  'closed':    'bg-emerald-950 text-emerald-300 border border-emerald-800',
  'lost':      'bg-red-950 text-red-400 border border-red-900',
  'no_show':   'bg-slate-800 text-[var(--text-secondary)] border border-slate-700',
  // Appointment status
  'pending':      'bg-amber-950 text-amber-300 border border-amber-800',
  'completed':    'bg-emerald-950 text-emerald-300 border border-emerald-800',
  'rescheduled':  'bg-blue-950 text-blue-300 border border-blue-800',
  // Reminder status
  'sent':      'bg-emerald-950 text-emerald-300 border border-emerald-800',
  'cancelled': 'bg-slate-800 text-[var(--text-secondary)] border border-slate-700',
  'failed':    'bg-red-950 text-red-400 border border-red-900',
  // Roles
  'rep':     'bg-slate-800 text-[var(--text-secondary)] border border-slate-700',
  'closer':  'bg-indigo-950 text-indigo-300 border border-indigo-800',
  'admin':   'bg-purple-950 text-purple-300 border border-purple-800',
  // User active status
  'active':   'bg-emerald-950 text-emerald-300 border border-emerald-800',
  'inactive': 'bg-red-950 text-red-400 border border-red-900',
}

const FALLBACK = 'bg-slate-800 text-[var(--text-secondary)] border border-slate-700'

export function Badge({ label, variant }) {
  const key = label ?? variant
  const style = STATUS_STYLES[key] || FALLBACK
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', style)}>
      {label}
    </span>
  )
}
