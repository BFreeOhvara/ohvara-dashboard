import { useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { card, eyebrow, MONO } from '../../lib/exportStyles'
import { StatTile, StatGrid, EmptyNote, SectionHead } from '../../components/agent/AgentUI'
import { GapNote } from '../../components/ui/ExportForm'
import { stageOf, startOfWeek, startOfMonth, hoursBetween, fmtDuration, median } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Performance (Prompt 665) — built only from what the bookings themselves
// record (created_at, fulfillment_completed_at, stage). No premium/AP figures:
// there's no new policy being written here, so there's no production number to
// show — the agent's output is clients booked, and the quality signal is how
// many of those actually got their old policy cancelled.
//
// Agent: their own numbers. Admin: the whole team, plus a per-agent table.
//
// Prompt 669 — restyled to Restorix Portal's design system: eyebrow stat
// tiles, display-font section headings above their cards, and the per-agent
// table in Restorix's table shell (eyebrow header band, hairline rows).

const WEEKS = 8

function summarize(rows, now) {
  const monthStart = startOfMonth(new Date(now)).getTime()
  const bookedMonth = rows.filter(p => new Date(p.created_at).getTime() >= monthStart).length
  const cancelled = rows.filter(p => stageOf(p) === 'cancelled')
  const cancelledMonth = cancelled.filter(p => p.fulfillment_completed_at && new Date(p.fulfillment_completed_at).getTime() >= monthStart).length
  const rate = rows.length ? Math.round((cancelled.length / rows.length) * 100) : null
  const turnaround = median(cancelled
    .filter(p => p.fulfillment_completed_at)
    .map(p => hoursBetween(p.created_at, p.fulfillment_completed_at)))
  return { total: rows.length, bookedMonth, cancelled: cancelled.length, cancelledMonth, rate, turnaround }
}

export default function Performance() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { data: raw = [], isLoading } = useAgentBookings(isAdmin ? null : profile?.id)
  const rows = useMemo(() => (isAdmin ? excludeTestAccounts(raw, profile?.id) : raw), [raw, isAdmin, profile?.id])
  const [now] = useState(() => Date.now())

  const s = useMemo(() => summarize(rows, now), [rows, now])

  const weeks = useMemo(() => {
    const thisWeek = startOfWeek(new Date(now))
    return Array.from({ length: WEEKS }, (_, i) => {
      const start = new Date(thisWeek)
      start.setDate(start.getDate() - 7 * (WEEKS - 1 - i))
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const inWeek = rows.filter(p => { const t = new Date(p.created_at); return t >= start && t < end })
      return {
        start,
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        booked: inWeek.length,
        cancelled: inWeek.filter(p => stageOf(p) === 'cancelled').length,
        current: i === WEEKS - 1,
      }
    })
  }, [rows, now])

  const byAgent = useMemo(() => {
    if (!isAdmin) return []
    const m = new Map()
    for (const p of rows) {
      if (!m.has(p.agent_id)) m.set(p.agent_id, { id: p.agent_id, name: p.agent?.full_name || 'Unknown', rows: [] })
      m.get(p.agent_id).rows.push(p)
    }
    return [...m.values()].map(a => ({ ...a, ...summarize(a.rows, now) })).sort((a, b) => b.bookedMonth - a.bookedMonth || b.total - a.total)
  }, [rows, isAdmin, now])

  if (isLoading) return <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>Loading…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StatGrid>
        <StatTile label="Booked this month" value={s.bookedMonth} sub={`${s.total} all time`} />
        <StatTile label="Cancelled this month" value={s.cancelledMonth} sub={`${s.cancelled} all time`} />
        <StatTile label="Completion rate" value={s.rate == null ? '—' : `${s.rate}%`}
          sub="booked clients whose old policy got cancelled" />
        <StatTile label="Booked → cancelled" value={fmtDuration(s.turnaround)}
          sub="median time, finished ones only" />
      </StatGrid>

      <div>
        <SectionHead title="Clients booked per week" sub={`Last ${WEEKS} weeks · hover a bar for the detail`} />
        <div style={{ ...card, padding: '24px 24px 20px' }}>
          {s.total === 0 ? <EmptyNote>No bookings yet — this fills in as you book calls.</EmptyNote> : <WeekBars weeks={weeks} />}
        </div>
      </div>

      {isAdmin && (
        <div>
          <SectionHead title="By agent" />
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {byAgent.length === 0 ? <EmptyNote>No bookings yet.</EmptyNote> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead style={{ background: 'var(--bg-elevated)' }}>
                    <tr>
                      {['Agent', 'Booked (month)', 'Booked (all)', 'Cancelled', 'Completion', 'Booked → cancelled'].map((h, i) => (
                        <th key={h} style={{ ...eyebrow, textAlign: i ? 'right' : 'left', padding: '12px 20px', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {byAgent.map(a => (
                      <tr key={a.id} className="table-row-hover" style={{ borderTop: 'var(--border-w) solid var(--border)' }}>
                        <td style={{ padding: '14px 20px', color: 'var(--text-primary)', fontWeight: 600 }}>{a.name}</td>
                        {[a.bookedMonth, a.total, a.cancelled, a.rate == null ? '—' : `${a.rate}%`, fmtDuration(a.turnaround)].map((v, i) => (
                          <td key={i} style={{ padding: '14px 20px', textAlign: 'right', fontFamily: MONO, fontSize: 13, color: 'var(--text-primary)' }}>{v}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <GapNote>
        No show-rate or talk-time numbers yet — nothing in the system records whether the client picked up Fulfillment's
        call or how long the agent's own calls ran.
      </GapNote>
    </div>
  )
}

// Single series, one axis: bookings per week. Cancelled-from-that-week is in
// the tooltip, not a second color, so the bar reads as one number.
function WeekBars({ weeks }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...weeks.map(w => w.booked))
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max]
  const H = 200

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', width: 22, height: H, flexShrink: 0 }}>
          {ticks.map(t => (
            <span key={t} style={{
              position: 'absolute', right: 0, bottom: (t / max) * H - 7, fontSize: 11,
              fontFamily: MONO, color: 'var(--text-muted)',
            }}>{t}</span>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, height: H }}>
          {ticks.map(t => (
            <div key={t} style={{
              position: 'absolute', left: 0, right: 0, bottom: (t / max) * H,
              borderTop: `1px ${t === 0 ? 'solid' : 'dashed'} var(--border)`, opacity: t === 0 ? 1 : 0.6,
            }} />
          ))}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {weeks.map((w, i) => (
              <div
                key={i}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onClick={() => setHover(h => (h === i ? null : i))}
                style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default' }}
              >
                <div style={{
                  width: '56%', maxWidth: 40, height: w.booked ? Math.max(3, (w.booked / max) * H) : 0,
                  background: 'var(--accent)', borderRadius: '6px 6px 0 0',
                  opacity: hover == null || hover === i ? 1 : 0.45, transition: 'opacity 120ms',
                }} />
              </div>
            ))}
          </div>
          {hover != null && (
            <div style={{
              position: 'absolute', bottom: Math.min(H - 10, (weeks[hover].booked / max) * H + 8),
              left: `${((hover + 0.5) / weeks.length) * 100}%`,
              // edge bars anchor the tooltip inward so it never spills off the card
              transform: `translateX(${hover < 2 ? -15 : hover > weeks.length - 3 ? -85 : -50}%)`,
              background: 'var(--bg-overlay)', border: 'var(--border-w) solid var(--border-strong)', borderRadius: 10,
              padding: '9px 12px', fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
              boxShadow: '0 12px 32px rgba(0,0,0,0.22)', pointerEvents: 'none', zIndex: 2,
            }}>
              <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Week of {weeks[hover].label}</p>
              <p style={{ margin: '3px 0 0', fontFamily: MONO }}>{weeks[hover].booked} booked · {weeks[hover].cancelled} cancelled so far</p>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2, marginLeft: 30, marginTop: 8 }}>
        {weeks.map((w, i) => (
          <span key={i} style={{
            flex: 1, textAlign: 'center', fontSize: 11, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden',
            color: w.current ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: w.current ? 500 : 400,
          }}>
            {w.current ? 'This wk' : w.label}
          </span>
        ))}
      </div>
    </div>
  )
}
