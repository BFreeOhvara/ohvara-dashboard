import { MONO } from '../../lib/exportStyles'
import { BUCKETS, BUCKET, bucketOf } from '../../lib/agentBookings'

// Status filter on My Pipeline. Prompt 672 put a funnel card (Booked → Picked
// up → Cancelled) above this row; Prompt 680 dropped the card to match
// Restorix's My Pipeline — statuses at the top, then search, then the list.
// Prompt 681 — reused by Fulfillment's team-wide Pipeline; `extras` adds
// filters beyond the four stage buckets (e.g. Needs attention).
export function Pipeline({ rows, now, bucket, onBucket, extras = [] }) {
  const counts = { waiting: 0, missed: 0, inProgress: 0, cancelled: 0 }
  for (const p of rows) counts[bucketOf(p, now)]++

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Chip on={bucket === 'all'} onClick={() => onBucket('all')} label="All" count={rows.length} />
      {BUCKETS.map(b => (
        <Chip
          key={b} on={bucket === b} onClick={() => onBucket(bucket === b ? 'all' : b)}
          label={BUCKET[b].label} count={counts[b]} dot={BUCKET[b].fill}
          warn={b === 'missed' && counts.missed > 0}
        />
      ))}
      {extras.map(x => (
        <Chip
          key={x.key} on={bucket === x.key} onClick={() => onBucket(bucket === x.key ? 'all' : x.key)}
          label={x.label} count={x.count} warn={x.warn && x.count > 0}
        />
      ))}
    </div>
  )
}

function Chip({ on, onClick, label, count, dot, warn }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="tab-transition"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 999,
        fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
        border: `var(--border-w) solid ${on ? 'var(--accent)' : warn ? 'var(--warning-bd)' : 'var(--border)'}`,
        background: on ? 'var(--accent-dim)' : warn ? 'var(--warning-dim)' : 'var(--bg-surface)',
        color: on ? 'var(--accent)' : warn ? 'var(--warning)' : 'var(--text-secondary)',
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {label}
      <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}
