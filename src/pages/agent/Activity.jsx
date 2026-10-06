import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, PhoneCall, PhoneMissed, CircleCheck, CalendarArrowUp, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicyEvents } from '../../hooks/useAgentActivity'
import { card, MONO } from '../../lib/exportStyles'
import { SectionHead, EmptyNote, Pill } from '../../components/agent/AgentUI'
import { fullName } from '../../lib/policyFormat'
import { fmtBooking } from '../../lib/scheduling'
import { STAGE, SUBSTATUS_LABEL, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Activity (Prompt 690) — what actually happened, newest first. My Pipeline
// shows where each client stands NOW; this is the history behind it: every
// status change (Booked → In progress → Cancelled / No answer,
// Prompts 689/695) and every time a booked call was moved. Messages are not shown
// here (Prompt 694) — the Messages page is the one place for those.
//
// One day at a time (Prompt 694): a date control beside the page title steps ← / → a
// calendar day, and its label opens a month picker (Prompt 698); the list
// scrolls inside a box that ends on a whole row. Events come from
// policy_events (migration 118, written by a trigger on policies, so nothing
// in the app has to remember to log).
//
// Admin lands here too and sees every agent's activity (test account held out,
// same as My Pipeline), with the agent named on each row.


// policy_events.kind → how the row reads. Status kinds reuse STAGE's colours.
const KIND = {
  booked:       { icon: CalendarCheck,   stage: 'booked' },
  in_progress:  { icon: PhoneCall,       stage: 'inProgress' },
  no_answer:    { icon: PhoneMissed,     stage: 'noAnswer' },
  cancelled:    { icon: CircleCheck,     stage: 'cancelled' },
  moved:        { icon: CalendarArrowUp, color: 'var(--text-secondary)' },
}

const firstName = s => String(s || '').trim().split(/\s+/)[0] || ''

// "Sam (Fulfillment)" when we know who did it, else just the team.
function who(e) {
  if (e.actor_role === 'fulfillment' && e.actor_name) return `${firstName(e.actor_name)} (Fulfillment)`
  if (e.actor_role === 'admin') return 'Admin'
  return 'Fulfillment'
}

function describe(e) {
  const d = e.detail || {}
  const attempt = d.attempt > 1 ? ` (attempt ${d.attempt})` : ''
  switch (e.kind) {
    case 'booked':
      return e.from_status
        ? 'Back to Booked'
        : `Booked a call with Fulfillment${d.scheduled_call_at ? ` for ${fmtBooking(d.scheduled_call_at)}` : ''}`
    case 'in_progress':  return `${who(e)} started a call${attempt}`
    case 'no_answer':    return `Call ended: no answer${attempt}${d.reason ? ` · ${SUBSTATUS_LABEL[d.reason] || d.reason}` : ''}`
    case 'cancelled':    return `Old policy confirmed cancelled${d.confirmation ? ` · conf. ${d.confirmation}` : ''}`
    case 'moved':        return `Call moved to ${fmtBooking(d.to)}`
    default:             return e.kind
  }
}

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// "October 4" plus a "Today" / "Yesterday" tag where it applies.
function dayTitle(day, now) {
  const today = startOfDay(now)
  const name = day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (day.getTime() === today.getTime()) return { name, tag: 'Today' }
  if (day.getTime() === addDays(today, -1).getTime()) return { name, tag: 'Yesterday' }
  return { name, tag: day.getFullYear() === today.getFullYear() ? day.toLocaleDateString('en-US', { weekday: 'long' }) : String(day.getFullYear()) }
}

export default function Activity() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()
  const navigate = useNavigate()

  // Days back from today (0 = today), so "Today" stays pinned across midnight.
  const [back, setBack] = useState(0)
  const today = startOfDay(now)
  const day = addDays(today, -back)

  const events = usePolicyEvents(day, isAdmin ? null : profile?.id)

  const feed = useMemo(() => {
    const all = (events.data || []).map(e => ({
      key: `e-${e.id}`, kind: e.kind, at: e.at, policyId: e.policy_id, agentId: e.agent_id,
      client: fullName(e.policy), agent: e.agent?.full_name, text: describe(e),
    }))
    return isAdmin ? excludeTestAccounts(all, profile?.id, 'agentId') : all
  }, [events.data, isAdmin, profile?.id])

  const open = item => navigate(`/agent/clients?stage=all&open=${item.policyId}`)
  const title = dayTitle(day, now)

  // Size the box to the space below it, then pull the bottom edge up to the end
  // of the last row that fully fits so a fresh load never shows a sliced row
  // (Prompt 698). The box still scrolls to the rest.
  const boxRef = useRef(null)
  const [boxH, setBoxH] = useState(null)
  const fit = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const avail = Math.floor(window.innerHeight - el.getBoundingClientRect().top - 68)
    const rows = Array.from(el.children).filter(c => c.dataset.row)
    if (!rows.length) { setBoxH(Math.max(160, avail)); return }
    const last = rows[rows.length - 1]
    if (last.offsetTop + last.offsetHeight <= avail) { setBoxH(Math.max(160, avail)); return }
    let h = rows[0].offsetTop + rows[0].offsetHeight
    for (const r of rows) {
      const bottom = r.offsetTop + r.offsetHeight
      if (bottom <= avail) h = bottom
      else break
    }
    setBoxH(h)
  }, [])
  useLayoutEffect(() => { fit() }, [fit, feed, events.isLoading, events.error])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  return (
    <div>
      <SectionHead
        title={isAdmin ? "Everyone's activity" : 'Your activity'}
        sub="Newest first · updates every 30 seconds"
        action={
          <DateNav
            day={day} today={today} title={title} back={back}
            onPrev={() => setBack(n => n + 1)}
            onNext={() => setBack(n => Math.max(0, n - 1))}
            onPick={d => setBack(Math.max(0, Math.round((today - startOfDay(d)) / 86400000)))}
          />
        }
      />

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {/* The box scrolls inside; its height is set by fit() above. */}
        <div
          ref={boxRef}
          style={{ position: 'relative', height: boxH ?? 'min(520px, 60vh)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
        >
          {events.isLoading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : events.error ? (
            <p style={{ margin: 0, padding: '32px 20px', textAlign: 'center', fontSize: 14, color: 'var(--danger)' }}>
              Couldn't load activity: {events.error.message}
            </p>
          ) : feed.length === 0 ? (
            <EmptyNote>
              {back === 0
                ? 'Nothing yet today. Bookings, calls and cancellations show up here as they happen.'
                : 'Nothing happened on this day.'}
            </EmptyNote>
          ) : (
            feed.map((item, i) => (
              <FeedRow key={item.key} item={item} first={i === 0} last={i === feed.length - 1} showAgent={isAdmin} onClick={() => open(item)} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// Date control, top right beside the page title (Prompt 699): ← [calendar · October 4 · Today] →. The label
// opens a month picker so a far-back day is one click, not many arrows.
function DateNav({ day, today, title, back, onPrev, onNext, onPick }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(() => new Date(day.getFullYear(), day.getMonth(), 1))
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return
    const away = e => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const toggle = () => {
    if (!open) setView(new Date(day.getFullYear(), day.getMonth(), 1))
    setOpen(o => !o)
  }

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <DayArrow dir="prev" onClick={onPrev} />
      <button
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Pick a date"
        style={{
          height: 32, padding: '0 12px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 8,
          background: open ? 'var(--bg-elevated)' : 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <CalendarDays size={15} aria-hidden style={{ color: 'var(--text-secondary)' }} />
        <span>
          {title.name} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {title.tag}</span>
        </span>
      </button>
      <DayArrow dir="next" disabled={back === 0} onClick={onNext} />

      {open && (
        <MonthPicker
          view={view} setView={setView} selected={day} today={today}
          onPick={d => { onPick(d); setOpen(false) }}
        />
      )}
    </div>
  )
}

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function MonthPicker({ view, setView, selected, today, onPick }) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let n = 1; n <= daysIn; n++) cells.push(new Date(view.getFullYear(), view.getMonth(), n))
  const atCurrentMonth = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth()
  const step = n => setView(new Date(view.getFullYear(), view.getMonth() + n, 1))

  return (
    <div
      role="dialog"
      aria-label="Choose a date"
      style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50, width: 252, padding: 12,
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 12,
        boxShadow: '0 16px 40px rgba(0,0,0,0.35)', userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <DayArrow dir="prev" label="Previous month" onClick={() => step(-1)} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
          {view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <DayArrow dir="next" label="Next month" disabled={atCurrentMonth} onClick={() => step(1)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DOW.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', padding: '2px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} />
          const isSel = d.getTime() === selected.getTime()
          const isToday = d.getTime() === today.getTime()
          const future = d > today
          return (
            <button
              key={i}
              disabled={future}
              onClick={() => onPick(d)}
              style={{
                height: 30, borderRadius: 6, fontSize: 13, fontVariantNumeric: 'tabular-nums',
                background: isSel ? 'var(--accent)' : 'transparent',
                color: isSel ? '#fff' : future ? 'var(--text-muted)' : isToday ? 'var(--accent)' : 'var(--text-primary)',
                fontWeight: isSel || isToday ? 600 : 400,
                opacity: future ? 0.4 : 1, cursor: future ? 'not-allowed' : 'pointer',
                border: 'none',
              }}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DayArrow({ dir, disabled, onClick, label }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label || (dir === 'prev' ? 'Previous day' : 'Next day')}
      style={{
        width: 32, height: 32, borderRadius: 8, display: 'grid', placeItems: 'center', flexShrink: 0,
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
        color: 'var(--text-secondary)', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <Icon size={16} aria-hidden />
    </button>
  )
}

function FeedRow({ item, first, last, showAgent, onClick }) {
  const k = KIND[item.kind] || KIND.moved
  const stage = k.stage && STAGE[k.stage]
  const Icon = k.icon
  const color = stage ? stage.fill : k.color
  return (
    <button
      onClick={onClick}
      className="menu-row"
      data-row="1"
      style={{
        gap: 12, padding: '12px 20px', borderTop: first ? 'none' : 'var(--border-w) solid var(--border)',
        borderBottom: last ? 'var(--border-w) solid var(--border)' : 'none', borderRadius: 0,
      }}
    >
      <span style={{
        width: 30, height: 30, borderRadius: 999, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: 'var(--bg-elevated)', color,
      }}>
        <Icon size={15} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.client}
          </span>
          {stage && <Pill tone={stage.tone}>{stage.label}</Pill>}
          {showAgent && item.agent && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {item.agent}</span>
          )}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.text}
        </span>
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 62, textAlign: 'right' }}>
        {new Date(item.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </span>
    </button>
  )
}
