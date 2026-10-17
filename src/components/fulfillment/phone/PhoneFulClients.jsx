import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { fulfillTabOf, isLive, matchClients, recoveryLabel, startOfWeek } from '../../../lib/agentBookings'
import { fullName } from '../../../lib/policyFormat'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../../lib/timezones'
import { timeText } from '../../../lib/fulfillmentDay'
import { clientSub, dayTile, initials } from '../../agent/phone/phoneBits'

// Prompt 773 — Clients on a rep's phone, the phone version of Pipeline
// (mockup FulClients.dc.html): title with counts, search, the three-part
// status card (Booked / No answer / Cancelled: the name carries the colour,
// the count is plain; tap filters, tap again clears, like the agent's), then
// the list in groups: Booked today and coming up, No answer (trying again),
// Cancelled this week (and, filtered or searching, earlier). Rows open the
// call's sheet. Counts, tabs and order are Pipeline's (fulfillTabOf).

const STATUS = [
  { tab: 'booked', label: 'Booked', color: 'var(--ov-st-booked)' },
  { tab: 'noAnswer', label: 'No answer', color: 'var(--ov-st-noanswer)' },
  { tab: 'cancelled', label: 'Cancelled', color: 'var(--ov-st-cancelled)' },
]
const COLOR = Object.fromEntries(STATUS.map(s => [s.tab, s.color]))
const byCall = (a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')
const doneAt = p => p.fulfillment_completed_at || p.updated_at || ''
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)

// "Today 3:30 PM" / "Tue 10:00 AM" / "Oct 21 10:00 AM", in the rep's zone.
function whenText(iso, now, tz) {
  const { n, day } = dayTile(iso, now, tz)
  const d = new Date(`${day}T12:00:00Z`)
  const word = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 && n < 7
    ? d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${word} ${timeText(iso, tz)}`
}

function rowEnd(p, now, tz, nextId) {
  const tab = fulfillTabOf(p)
  const agent = p.agent?.full_name ? `for ${p.agent.full_name}` : ''
  if (isLive(p)) return ['On a call', 'right now', 'var(--ov-live)']
  if (tab === 'cancelled') return ['Cancelled', doneAt(p) ? whenText(doneAt(p), now, tz) : '', 'var(--ov-st-cancelled)']
  if (tab === 'noAnswer') {
    const tries = p.call_attempts || 0
    const ahead = p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > now
    const under = tries === 1 ? 'Second try' : tries > 1 ? `Try ${tries + 1}` : ''
    return [ahead ? whenText(p.scheduled_call_at, now, tz) : cap(recoveryLabel(p, now)) || 'No answer', ahead ? under : agent, 'var(--ov-st-noanswer)']
  }
  if (!p.scheduled_call_at) return ['Booked', agent, 'var(--ov-hi)']
  const today = dayTile(p.scheduled_call_at, now, tz).n === 0
  return [today ? timeText(p.scheduled_call_at, tz) : whenText(p.scheduled_call_at, now, tz), agent, p.id === nextId ? 'var(--ph-next-time)' : 'var(--ov-hi)']
}

export function PhoneFulClients({ rows, loading, filter, onFilter, now, tz: tzIn, onOpen }) {
  const tz = tzIn || DEFAULT_TIMEZONE
  const [query, setQuery] = useState('')
  const q = query.trim()
  const shown = useMemo(() => (q ? new Set(matchClients(rows, q).map(p => p.id)) : null), [rows, q])
  const counts = useMemo(() => Object.fromEntries(STATUS.map(s => [s.tab, rows.filter(p => fulfillTabOf(p) === s.tab).length])), [rows])
  const nextId = useMemo(() => rows
    .filter(p => fulfillTabOf(p) === 'booked' && !isLive(p) && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > now)
    .reduce((best, p) => (!best || p.scheduled_call_at < best.scheduled_call_at ? p : best), null)?.id, [rows, now])

  const groups = useMemo(() => {
    const today = zonedDateStr(now, tz)
    const weekStart = startOfWeek(new Date(now)).getTime()
    const pick = tab => rows.filter(p => fulfillTabOf(p) === tab && (!shown || shown.has(p.id)))
    const booked = pick('booked').sort(byCall)
    const isToday = p => !p.scheduled_call_at || isLive(p) || zonedDateStr(new Date(p.scheduled_call_at).getTime(), tz) <= today
    const cancelled = pick('cancelled').sort((a, b) => doneAt(b).localeCompare(doneAt(a)))
    const thisWeek = p => new Date(doneAt(p)).getTime() >= weekStart
    const wide = !!filter || !!q
    return [
      { key: 'today', tab: 'booked', head: 'Booked · today', rows: booked.filter(isToday) },
      { key: 'later', tab: 'booked', head: 'Booked · coming up', rows: booked.filter(p => !isToday(p)) },
      { key: 'na', tab: 'noAnswer', head: 'No answer · trying again', rows: pick('noAnswer').sort(byCall) },
      { key: 'week', tab: 'cancelled', head: 'Cancelled · this week', rows: cancelled.filter(thisWeek) },
      { key: 'earlier', tab: 'cancelled', head: 'Cancelled · earlier', rows: wide ? cancelled.filter(p => !thisWeek(p)) : [] },
    ].filter(g => (!filter || g.tab === filter) && g.rows.length)
  }, [rows, shown, filter, q, now, tz])

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

      <div className="ov-card ph-seg ph-seg-3" role="group" aria-label="Filter by status">
        {STATUS.map(s => {
          const on = filter === s.tab
          return (
            <button key={s.tab} type="button" className={`ph-seg-btn${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onFilter(on ? null : s.tab)}>
              <span className="ph-seg-label" style={{ color: s.color }}>{s.label}</span>
              <span className="ph-seg-num">{loading ? '—' : counts[s.tab]}</span>
              <span className="ph-seg-bar" style={{ background: s.color }} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && <div className="ov-card ph-card ph-empty">Loading your clients…</div>}
        {!loading && groups.length === 0 && (
          <div className="ov-card ph-card ph-empty">
            {q ? `No client matches “${q}”.` : filter ? `No ${STATUS.find(s => s.tab === filter).label.toLowerCase()} clients.` : 'No clients yet. Calls show here once agents book them.'}
          </div>
        )}
        {!loading && groups.map(g => (
          <section key={g.key} aria-label={g.head}>
            <div className="ph-group-label" style={{ color: COLOR[g.tab] }}><span className="ph-group-dot" aria-hidden="true" />{g.head}</div>
            <div className="ov-card ph-card">
              {g.rows.map(p => {
                const name = fullName(p)
                const [top, under, color] = rowEnd(p, now, tz, nextId)
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
