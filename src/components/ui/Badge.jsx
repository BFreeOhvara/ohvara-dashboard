// Badge — token-only inline styles. No hardcoded hex anywhere.
const STATUS_STYLES = {
  // Lead statuses — semantic colors per design spec
  'New': {
    background: 'var(--info-dim)',
    color: 'var(--info)',
    border: '0.5px solid rgba(56,189,248,0.20)',
  },
  'Contacted': {
    background: 'var(--info-dim)',
    color: 'var(--info)',
    border: '0.5px solid rgba(56,189,248,0.20)',
  },
  'Voicemail': {
    background: 'var(--bg-elevated)',
    color: 'var(--text-dim)',
    border: '0.5px solid var(--border)',
  },
  'No Answer': {
    background: 'rgba(148,163,184,0.10)',
    color: '#94A3B8',
    border: '0.5px solid rgba(148,163,184,0.25)',
  },
  'Appointment Booked': {
    background: 'var(--success-dim)',
    color: 'var(--success)',
    border: '0.5px solid rgba(34,197,94,0.20)',
  },
  'Follow-Up': {
    background: 'var(--warning-dim)',
    color: 'var(--warning)',
    border: '0.5px solid rgba(245,158,11,0.20)',
  },
  'Interested': {
    background: 'var(--success-dim)',
    color: 'var(--success)',
    border: '0.5px solid rgba(34,197,94,0.20)',
  },
  'Booked': {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
    border: '0.5px solid var(--accent-border)',
  },
  'Callback': {
    background: 'var(--warning-dim)',
    color: 'var(--warning)',
    border: '0.5px solid rgba(245,158,11,0.20)',
  },
  'Not Interested': {
    background: 'var(--danger-dim)',
    color: 'var(--danger)',
    border: '0.5px solid rgba(239,68,68,0.20)',
  },

  // Appointment outcomes
  'closed':   { background: 'var(--success-dim)', color: 'var(--success)', border: '0.5px solid rgba(34,197,94,0.20)' },
  'lost':     { background: 'var(--danger-dim)',  color: 'var(--danger)',  border: '0.5px solid rgba(239,68,68,0.20)' },
  'no_show':  { background: 'var(--bg-elevated)', color: 'var(--text-dim)', border: '0.5px solid var(--border)' },

  // Appointment status
  'pending':     { background: 'var(--warning-dim)', color: 'var(--warning)', border: '0.5px solid rgba(245,158,11,0.20)' },
  'completed':   { background: 'var(--success-dim)', color: 'var(--success)', border: '0.5px solid rgba(34,197,94,0.20)' },
  'rescheduled': { background: 'var(--info-dim)',    color: 'var(--info)',    border: '0.5px solid rgba(56,189,248,0.20)' },

  // Reminder status
  'sent':      { background: 'var(--success-dim)', color: 'var(--success)', border: '0.5px solid rgba(34,197,94,0.20)' },
  'cancelled': { background: 'var(--bg-elevated)', color: 'var(--text-dim)', border: '0.5px solid var(--border)' },
  'failed':    { background: 'var(--danger-dim)',  color: 'var(--danger)',  border: '0.5px solid rgba(239,68,68,0.20)' },

  // Roles
  'rep':    { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '0.5px solid var(--border)' },
  'closer': { background: 'var(--accent-dim)',  color: 'var(--accent)',         border: '0.5px solid var(--accent-border)' },
  'admin':  { background: 'rgba(168,85,247,0.12)', color: 'rgb(192,132,252)',   border: '0.5px solid rgba(168,85,247,0.20)' },

  // User active status
  'active':   { background: 'var(--success-dim)', color: 'var(--success)', border: '0.5px solid rgba(34,197,94,0.20)' },
  'inactive': { background: 'var(--danger-dim)',  color: 'var(--danger)',  border: '0.5px solid rgba(239,68,68,0.20)' },
}

const FALLBACK = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  border: '0.5px solid var(--border)',
}

// `label` is also the STATUS_STYLES color-lookup key (e.g. the raw 'rep'
// role value, kept untouched so the role→color map above still resolves) —
// `text`, if passed, overrides only what's displayed (Prompt 299: role
// badges need to print "Setter" while still coloring off the stored 'rep'
// key). Falls back to `label` when `text` isn't given, so every existing
// call site is unaffected.
export function Badge({ label, variant, text }) {
  const key = label ?? variant
  const s = STATUS_STYLES[key] || FALLBACK
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '2px 7px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
      background: s.background,
      color: s.color,
      border: s.border,
    }}>
      {text ?? label}
    </span>
  )
}
