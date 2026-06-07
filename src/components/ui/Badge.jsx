import { clsx } from 'clsx'

// Pill styles: subtle background tint + matching border. NOT rounded-full — max 4px radius.
const STATUS_STYLES = {
  // Lead statuses
  'New':            'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border)]',
  'Contacted':      'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20',
  'Voicemail':      'bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20',
  'No Answer':      'bg-orange-400/10 text-orange-400 border border-orange-400/20',
  'Interested':     'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20',
  'Booked':         'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[#6C63FF]/20',
  'Not Interested': 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20',
  // Appointment outcomes
  'closed':    'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20',
  'lost':      'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20',
  'no_show':   'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]',
  // Appointment status
  'pending':      'bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20',
  'completed':    'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20',
  'rescheduled':  'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20',
  // Reminder status
  'sent':      'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20',
  'cancelled': 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]',
  'failed':    'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20',
  // Roles
  'rep':     'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border)]',
  'closer':  'bg-[var(--accent-subtle)] text-[var(--accent)] border border-[#6C63FF]/20',
  'admin':   'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  // User active status
  'active':   'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20',
  'inactive': 'bg-[#EF4444]/10 text-[#EF4444] border border-[#EF4444]/20',
}

const FALLBACK = 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border)]'

export function Badge({ label, variant }) {
  const key = label ?? variant
  const style = STATUS_STYLES[key] || FALLBACK
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium',
      style
    )}>
      {label}
    </span>
  )
}
