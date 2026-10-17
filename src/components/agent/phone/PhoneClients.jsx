import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { matchClients, tabOf, stageOf } from '../../../lib/agentBookings'
import { fullName } from '../../../lib/policyFormat'
import { clientEnd, clientSub, initials } from './phoneBits'

// Prompt 772 — Clients on a phone (mockup Clients.dc.html): title with
// counts, search, one status card split four ways (the status name is the
// coloured part, the count under it; tap filters, tap again clears), then the
// list grouped Needs you, Booked · next up, No answer, Cancelled. Rows open
// the client's sheet; nothing scrolls sideways.

const PHONE_GROUPS = [
  { tab: 'needs', label: 'Needs you', head: 'Needs you', color: 'var(--ov-st-needs)' },
  { tab: 'booked', label: 'Booked', head: 'Booked · next up', color: 'var(--ov-st-booked)' },
  { tab: 'noAnswer', label: 'No answer', head: 'No answer', color: 'var(--ov-st-noanswer)' },
  { tab: 'cancelled', label: 'Cancelled', head: 'Cancelled', color: 'var(--ov-st-cancelled)' },
]

export function PhoneClients({ rows, loading, filter, onFilter, sort, now, onOpen }) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const shown = useMemo(() => (q ? new Set(matchClients(rows, q).map(p => p.id)) : null), [rows, q])
  const counts = useMemo(() => Object.fromEntries(PHONE_GROUPS.map(g => [g.tab, rows.filter(p => tabOf(p) === g.tab).length])), [rows])
  const groups = PHONE_GROUPS
    .filter(g => !filter || g.tab === filter)
    .map(g => ({ ...g, rows: rows.filter(p => tabOf(p) === g.tab && (!shown || shown.has(p.id))).sort(sort[g.tab]) }))
    .filter(g => g.rows.length || filter)
  // The soonest booked call still ahead is the highlighted one.
  const nextId = useMemo(() => rows
    .filter(p => stageOf(p) === 'booked' && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > now)
    .reduce((best, p) => (!best || p.scheduled_call_at < best.scheduled_call_at ? p : best), null)?.id, [rows, now])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">Clients</h1>
        {!loading && <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>{rows.length} · {counts.cancelled} cancelled</span>}
      </div>

      <label className="ov-input ph-search">
        <Search size={18} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, phone, city or carrier" aria-label="Search clients" />
      </label>

      <div className="ov-card ph-seg" role="group" aria-label="Filter by status">
        {PHONE_GROUPS.map(g => {
          const on = filter === g.tab
          return (
            <button key={g.tab} type="button" className={`ph-seg-btn${on ? ' is-on' : ''}`} aria-pressed={on}
              onClick={() => onFilter(on ? null : g.tab)}>
              <span className="ph-seg-label" style={{ color: g.color }}>{g.label}</span>
              <span className="ph-seg-num">{loading ? '—' : counts[g.tab]}</span>
              <span className="ph-seg-bar" style={{ background: g.color }} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && <div className="ov-card ph-card ph-empty">Loading your clients…</div>}
        {!loading && groups.length === 0 && (
          <div className="ov-card ph-card ph-empty">{q ? `No client matches “${q}”.` : 'No clients yet. Tap + to book your first call.'}</div>
        )}
        {!loading && groups.map(g => (
          <section key={g.tab} aria-label={g.head}>
            <div className="ph-group-label" style={{ color: g.color }}><span className="ph-group-dot" aria-hidden="true" />{g.head}</div>
            <div className="ov-card ph-card">
              {g.rows.length === 0 ? <div className="ph-empty">{q ? 'No match here.' : `No ${g.label.toLowerCase()} clients.`}</div> : g.rows.map(p => {
                const name = fullName(p)
                const [top, under, color] = clientEnd(p, now, { first: p.id === nextId })
                return (
                  <button key={p.id} type="button" className="ph-row" style={{ minHeight: 68 }} onClick={() => onOpen(p)}>
                    <span className="ph-ini" style={{ background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }} aria-hidden="true">{initials(name)}</span>
                    <span className="ph-row-main">
                      <span className="ph-row-title" style={{ fontSize: 15 }}>{name}</span>
                      <span className="ph-row-sub">{clientSub(p)}</span>
                    </span>
                    <span className="ph-row-end">
                      <b style={{ color }}>{top}</b>
                      {under && <span>{under}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
