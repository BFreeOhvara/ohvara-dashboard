import { clsx } from 'clsx'

// Every status has its own pill style
const STATUS_STYLES = {
  // Lead statuses
  'New':            'bg-[var(--bg-3)] text-[var(--text-secondary)] border border-[var(--border)]',
  'Contacted':      'bg-blue-950/60 text-blue-300 border border-blue-800/50',
  'Voicemail':      'bg-amber-950/60 text-amber-300 border border-amber-800/50',
  'No Answer':      'bg-orange-950/60 text-orange-300 border border-orange-800/50',
  'Interested':     'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50',
  'Booked':         'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[#6C63FF]/20',
  'Not Interested': 'bg-red-950/60 text-red-400 border border-red-900/50',
  // Appointment outcomes
  'closed':    'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50',
  'lost':      'bg-red-950/60 text-red-400 border border-red-900/50',
  'no_show':   'bg-[var(--bg-3)] text-[var(--text-muted)] border border-[var(--border)]',
  // Appointment status
  'pending':      'bg-amber-950/60 text-amber-300 border border-amber-800/50',
  'completed':    'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50',
  'rescheduled':  'bg-blue-950/60 text-blue-300 border border-blue-800/50',
  // Reminder status
  'sent':      'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50',
  'cancelled': 'bg-[var(--bg-3)] text-[var(--text-muted)] border border-[var(--border)]',
  'failed':    'bg-red-950/60 text-red-400 border border-red-900/50',
  // Roles
  'rep':     'bg-[var(--bg-3)] text-[var(--text-secondary)] border border-[var(--border)]',
  'closer':  'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[#6C63FF]/20',
  'admin':   'bg-purple-950/60 text-purple-300 border border-purple-800/50',
  // User active status
  'active':   'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50',
  'inactive': 'bg-red-950/60 text-red-400 border border-red-900/50',
}

const FALLBACK = 'bg-[var(--bg-3)] text-[var(--text-secondary)] border border-[var(--border)]'

export function Badge({ label, variant }) {
  const key = label ?? variant
  const style = STATUS_STYLES[key] || FALLBACK
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      style
    )}>
      {label}
    </span>
  )
}
