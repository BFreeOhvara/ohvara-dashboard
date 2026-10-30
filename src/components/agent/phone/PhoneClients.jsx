import { useMemo, useState } from 'react'
import { Search, CalendarPlus, CircleCheck, ClipboardList } from 'lucide-react'
import { matchClients, tabOf, stageOf, COMING_SOON } from '../../../lib/agentBookings'
import { fullName } from '../../../lib/policyFormat'
import { clientEnd, clientSub, initials } from './phoneBits'
import { SideSwitch } from '../AgentUI'

const SOON_ICON = { sold: CircleCheck, servicing: ClipboardList }

// Prompt 772 — Clients on a phone (mockup Clients.dc.html): title with
// counts, search, one status card split three ways (the status name is the
// coloured part, the count under it; tap filters, tap again clears), then the
// list grouped Needs you, Booked · next up, No answer. Rows open the client's
// sheet; nothing scrolls sideways.
//
// My Pipeline split — an In progress | Clients switch sits under the search.
// In progress is the grouped list above; Clients is the Cancelled clients
// group plus two labelled Coming soon sections (sold leads and servicing have
// no data yet). While there is search text the switch and filter step aside
// and every match shows, from both sides.

const PHONE_GROUPS = [
  { tab: 'needs', label: 'Needs you', head: 'Needs you', color: 'var(--ov-st-needs)' },
  { tab: 'booked', label: 'Booked', head: 'Booked · next up', color: 'var(--ov-st-booked)' },
  { tab: 'noAnswer', label: 'No answer', head: 'No answer', color: 'var(--ov-st-noanswer)' },
]
const CANCELLED_GROUP = { tab: 'cancelled', label: 'Cancelled', head: 'Cancelled clients', color: 'var(--ov-st-cancelled)' }

export function PhoneClients({ rows, loading, error, filter, onFilter, side, onSide, sort, now, onOpen, onBook, emptyRange, soon = true }) {
  const [query, setQuery] = useState('')
  const q = query.trim()
  const shown = useMemo(() => (q ? new Set(matchClients(rows, q).map(p => p.id)) : null), [rows, q])
  const counts = useMemo(() => Object.fromEntries([...PHONE_GROUPS, CANCELLED_GROUP].map(g => [g.tab, rows.filter(p => tabOf(p) === g.tab).length])), [rows])
  const progress = counts.needs + counts.booked + counts.noAnswer
  const visible = q ? [...PHONE_GROUPS, CANCELLED_GROUP] : side === 'clients' ? [CANCELLED_GROUP] : PHONE_GROUPS.filter(g => !filter || g.tab === filter)
  const groups = visible
    .map(g => ({ ...g, rows: rows.filter(p => tabOf(p) === g.tab && (!shown || shown.has(p.id))).sort(sort[g.tab]) }))
    .filter(g => g.rows.length || (!q && (filter || g.tab === 'cancelled')))
  // The soonest booked call still ahead is the highlighted one.
  const nextId = useMemo(() => rows
    .filter(p => stageOf(p) === 'booked' && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > now)
    .reduce((best, p) => (!best || p.scheduled_call_at < best.scheduled_call_at ? p : best), null)?.id, [rows, now])

  const nothingFound = !loading && !error && groups.length === 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">Clients</h1>
        {!loading && <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>{rows.length} total</span>}
      </div>

      <label className="ov-input ph-search">
        <Search size={18} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, phone, city or carrier" aria-label="Search clients" />
      </label>

      {!q && (
        <SideSwitch
          className="ph-side" side={side} onSide={onSide} loading={loading} short
          progress={progress} clients={counts.cancelled} attention={counts.needs}
        />
      )}

      {!q && side === 'progress' && (
        <div className="ov-card ph-seg ph-seg-3" role="group" aria-label="Filter by status">
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
      )}

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && <div className="ov-card ph-card ph-empty">Loading your clients…</div>}
        {error}
        {nothingFound && (
          <div className="ov-card ph-card">
            <div className="ph-empty">
              {q ? `No client matches “${q}”.` : emptyRange ? `Nobody booked ${emptyRange === 'week' ? 'this week' : 'this month'} yet.` : 'No calls in progress. Book one when your next client says yes.'}
            </div>
            {!q && !emptyRange && onBook && <BookButton onBook={onBook} />}
          </div>
        )}
        {!loading && groups.map(g => (
          <section key={g.tab} aria-label={g.head}>
            <div className="ph-group-label is-sentence" style={{ color: g.color }}><span className="ph-group-dot" aria-hidden="true" />{g.head}</div>
            <div className="ov-card ph-card">
              {g.rows.length === 0 ? (
                <div className="ph-empty">
                  {q ? 'No match here.' : g.tab === 'cancelled' ? (emptyRange ? `Nobody booked ${emptyRange === 'week' ? 'this week' : 'this month'} yet.` : 'No cancelled clients yet.') : `No ${g.label.toLowerCase()} clients.`}
                </div>
              ) : g.rows.map(p => {
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
        {!loading && !q && side === 'clients' && soon && COMING_SOON.map(c => (
          <section key={c.key} aria-label={c.title}>
            <div className="ph-group-label is-sentence" style={{ color: 'var(--ov-mute)' }}>
              <span className="ph-group-dot" aria-hidden="true" />{c.title}<span className="soon">Coming soon</span>
            </div>
            <div className="ov-card ph-card ph-soon">
              <span className="ic" aria-hidden="true">{(() => { const I = SOON_ICON[c.key]; return <I size={17} strokeWidth={2} /> })()}</span>
              <span>{c.text}</span>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function BookButton({ onBook }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '0 14px 16px' }}>
      <button type="button" className="ov-ghost" onClick={onBook}
        style={{ height: 44, padding: '0 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
        <CalendarPlus size={15} strokeWidth={2} aria-hidden="true" /> Submit
      </button>
    </div>
  )
}
