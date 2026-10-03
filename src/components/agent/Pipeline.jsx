import { MONO } from '../../lib/exportStyles'
import { LiveDot } from '../ui/LiveDot'
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
// Prompt 689 — five statuses (Booked / In progress / No answer / Rescheduling /
// Cancelled); In progress swaps its dot for the live pulse while a call is on.
// Prompt 687 — in that mode the chips sit inside one shared rounded bar (one
// segmented control, like Restorix's), keeping each status's own colour.
export function Pipeline({ rows, bucket, onBucket, extras = [], showAll = true }) {
  const counts = Object.fromEntries(BUCKETS.map(b => [b, 0]))
  for (const p of rows) counts[bucketOf(p)]++

  const grouped = !showAll
  return (
    <div style={grouped ? {
      display: 'flex', gap: 4, flexWrap: 'wrap', width: 'fit-content', maxWidth: '100%', padding: 4,
      background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 999,
    } : { display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {showAll && <Chip on={bucket === 'all'} onClick={() => onBucket('all')} label="All" count={rows.length} />}
      {BUCKETS.map(b => (
        <Chip
          key={b} on={bucket === b} onClick={() => onBucket(bucket === b ? 'all' : b)}
          label={BUCKET[b].label} count={counts[b]} dot={BUCKET[b].fill} live={b === 'inProgress' && counts[b] > 0}
          tone={grouped ? TONE[BUCKET[b].tone] : undefined} grouped={grouped}
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

function Chip({ on, onClick, label, count, dot, warn, tone, grouped, live }) {
  const border = tone ? (on ? tone.color : grouped ? 'transparent' : tone.bd) : on ? 'var(--accent)' : warn ? 'var(--warning-bd)' : 'var(--border)'
  const bg = tone ? (on ? tone.dim : grouped ? 'transparent' : 'var(--bg-surface)') : on ? 'var(--accent-dim)' : warn ? 'var(--warning-dim)' : 'var(--bg-surface)'
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
      {live ? <LiveDot title="A call is live right now" /> : dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}
      {label}
      <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  )
}
