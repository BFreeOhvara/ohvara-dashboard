import { ChevronRight } from 'lucide-react'
import { card, eyebrow, MONO } from '../../lib/exportStyles'
import { Segmented } from '../ui/Segmented'
import { BUCKETS, BUCKET, RANGES, bucketOf, stageOf, hoursBetween, fmtDuration, median } from '../../lib/agentBookings'

// Pipeline card on My Clients (Prompt 672). The Overview tiles count the
// funnel; this is the explorable version: Booked → Picked up → Cancelled with
// conversion and median time between steps, a bar of where everyone stands
// right now, and that bar's legend doubles as the list's status filter.
//
// Built into My Clients instead of a new tab — My Clients already listed the
// same clients with a stage filter, so a separate funnel page would have been
// the same list twice.

const RANGE_SUB = { week: 'since Monday', month: 'this month', all: 'all time' }

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')

export function Pipeline({ rows, now, range, onRange, bucket, onBucket }) {
  const counts = { waiting: 0, missed: 0, inProgress: 0, cancelled: 0 }
  for (const p of rows) counts[bucketOf(p, now)]++

  const pickedUp = rows.filter(p => stageOf(p) !== 'booked')
  const cancelled = rows.filter(p => stageOf(p) === 'cancelled')
  const toPickup = median(pickedUp.filter(p => p.fulfillment_claimed_at)
    .map(p => hoursBetween(p.created_at, p.fulfillment_claimed_at)).filter(h => h >= 0))
  const toCancel = median(cancelled.filter(p => p.fulfillment_claimed_at && p.fulfillment_completed_at)
    .map(p => hoursBetween(p.fulfillment_claimed_at, p.fulfillment_completed_at)).filter(h => h >= 0))

  const steps = [
    { label: 'Booked', value: rows.length, sub: RANGE_SUB[range] },
    { label: 'Picked up', value: pickedUp.length, sub: `${pct(pickedUp.length, rows.length)} of booked`, time: toPickup, timeLabel: 'after booking' },
    { label: 'Cancelled', value: cancelled.length, sub: `${pct(cancelled.length, pickedUp.length)} of picked up`, time: toCancel, timeLabel: 'to cancel' },
  ]

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '11px 20px', background: 'var(--bg-elevated)', borderBottom: 'var(--border-w) solid var(--border)',
      }}>
        <span style={{ ...eyebrow, flex: 1 }}>Pipeline</span>
        <Segmented size="sm" value={range} onChange={onRange} options={RANGES} />
      </div>

      <div style={{ padding: '18px 20px 20px' }}>
        <div className="grid grid-cols-3 gap-3 md:gap-0">
          {steps.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'flex-start', minWidth: 0 }}>
              {i > 0 && (
                <ChevronRight size={18} className="hidden md:block" style={{ color: 'var(--text-muted)', flexShrink: 0, alignSelf: 'center', margin: '0 16px 0 4px' }} />
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ ...eyebrow, color: 'var(--text-muted)' }}>{s.label}</p>
                <p style={{
                  margin: '6px 0 0', fontFamily: MONO, fontSize: 28, fontWeight: 500, lineHeight: 1.1,
                  letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)',
                }}>
                  {s.value}
                </p>
                <p style={{ margin: '5px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{s.sub}</p>
                {s.time != null && (
                  <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
                    <span style={{ fontFamily: MONO }}>~{fmtDuration(s.time)}</span> {s.timeLabel}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div
          role="img"
          aria-label={`Where they stand now: ${BUCKETS.map(b => `${counts[b]} ${BUCKET[b].label.toLowerCase()}`).join(', ')}`}
          style={{ display: 'flex', gap: 2, height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-muted)', margin: '20px 0 14px' }}
        >
          {BUCKETS.filter(b => counts[b]).map(b => (
            <span key={b} style={{ flexGrow: counts[b], flexBasis: 0, background: BUCKET[b].fill, opacity: bucket === 'all' || bucket === b ? 1 : 0.3, transition: 'opacity 120ms' }} />
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip on={bucket === 'all'} onClick={() => onBucket('all')} label="All" count={rows.length} />
          {BUCKETS.map(b => (
            <Chip
              key={b} on={bucket === b} onClick={() => onBucket(bucket === b ? 'all' : b)}
              label={BUCKET[b].label} count={counts[b]} dot={BUCKET[b].fill}
              warn={b === 'missed' && counts.missed > 0}
            />
          ))}
        </div>
      </div>
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
