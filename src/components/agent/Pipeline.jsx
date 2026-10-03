import { MONO } from '../../lib/exportStyles'
import { BUCKETS, BUCKET, TONE, bucketOf } from '../../lib/agentBookings'

// Status filter on My Pipeline. Prompt 672 put a funnel card (Booked → Picked
// up → Cancelled) above this row; Prompt 680 dropped the card to match
// Restorix's My Pipeline — statuses at the top, then search, then the list.
// Prompt 681 — reused by Fulfillment's team-wide Pipeline; `extras` adds
// filters beyond the four stage buckets (e.g. Needs attention).
//
// Prompt 686 — each status chip carries its own colour (tint at rest, stronger
// when selected); `showAll={false}` drops the All chip (agent My Pipeline —
// clicking the selected chip again clears the filter).
export function Pipeline({ rows, now, bucket, onBucket, extras = [], showAll = true }) {
  const counts = { waiting: 0, missed: 0, inProgress: 0, cancelled: 0 }
  for (const p of rows) counts[bucketOf(p, now)]++

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {showAll && <Chip on={bucket === 'all'} onClick={() => onBucket('all')} label="All" count={rows.length} />}
      {BUCKETS.map(b => (
        <Chip
          key={b} on={bucket === b} onClick={() => onBucket(bucket === b ? 'all' : b)}
          label={BUCKET[b].label} count={counts[b]} dot={BUCKET[b].fill}
          tone={showAll ? undefined : TONE[BUCKET[b].tone]}
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

function Chip({ on, onClick, label, count, dot, warn, tone }) {
  const border = tone ? (on ? tone.color : tone.bd) : on ? 'var(--accent)' : warn ? 'var(--warning-bd)' : 'var(--border)'
  const bg = tone ? (on ? tone.dim : 'var(--bg-surface)') : on ? 'var(--accent-dim)' : warn ? 'var(--warning-dim)' : 'var(--bg-surface)'
  const color = tone ? tone.color : on ? 'var(--accent)' : warn ? 'var(--warning)' : 'var(--text-secondary)'
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="tab-transition"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 30, padding: '0 12px', borderRadius: 999,
        fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
        border: `var(--border-w) solid ${border}`, background: bg, color,
      }}
    >
      {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {label}
      <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}
