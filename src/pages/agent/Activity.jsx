import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, PhoneCall, PhoneMissed, CalendarClock, CircleCheck, CalendarArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicyEvents } from '../../hooks/useAgentActivity'
import { card, MONO } from '../../lib/exportStyles'
import { SectionHead, EmptyNote, Pill } from '../../components/agent/AgentUI'
import { GapNote } from '../../components/ui/ExportForm'
import { fullName } from '../../lib/policyFormat'
import { fmtBooking } from '../../lib/scheduling'
import { STAGE, SUBSTATUS_LABEL, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Activity (Prompt 690) — what actually happened, newest first. My Pipeline
// shows where each client stands NOW; this is the history behind it: every
// status change (Booked → In progress → Cancelled / No answer / Rescheduling,
// Prompt 689) and every time a booked call was moved. Messages are not shown
// here (Prompt 694) — the Messages page is the one place for those.
//
// One day at a time (Prompt 694): a fixed-size header steps ← / → a calendar
// day; the list scrolls inside a fixed-height box. Events come from
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
  rescheduling: { icon: CalendarClock,   stage: 'rescheduling' },
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
    case 'no_answer':    return `Call ended: no answer${attempt}`
    case 'rescheduling': return `Call ended: needs another call${d.reason ? ` · ${SUBSTATUS_LABEL[d.reason] || d.reason}` : ''}`
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <SectionHead
          title={isAdmin ? "Everyone's activity" : 'Your activity'}
          sub="Newest first · updates every 30 seconds"
        />
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px',
            background: 'var(--bg-elevated)', borderBottom: 'var(--border-w) solid var(--border)',
          }}>
            <DayArrow dir="prev" onClick={() => setBack(n => n + 1)} />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' }}>
              {title.name} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {title.tag}</span>
            </span>
            <DayArrow dir="next" disabled={back === 0} onClick={() => setBack(n => Math.max(0, n - 1))} />
          </div>

          {/* Fixed height: the box never grows or shrinks, the list scrolls inside it. */}
          <div style={{ height: 'min(520px, 60vh)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
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
                <FeedRow key={item.key} item={item} first={i === 0} showAgent={isAdmin} onClick={() => open(item)} />
              ))
            )}
          </div>
        </div>
      </div>

      <GapNote>
        Activity is logged from Oct 4, 2026. Bookings from before then show their booking, their latest call outcome and their cancellation, but not every call attempt in between. Tap a row to open the client.
      </GapNote>
    </div>
  )
}

function DayArrow({ dir, disabled, onClick }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Previous day' : 'Next day'}
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

function FeedRow({ item, first, showAgent, onClick }) {
  const k = KIND[item.kind] || KIND.moved
  const stage = k.stage && STAGE[k.stage]
  const Icon = k.icon
  const color = stage ? stage.fill : k.color
  return (
    <button
      onClick={onClick}
      className="menu-row"
      style={{
        gap: 12, padding: '12px 20px', borderTop: first ? 'none' : 'var(--border-w) solid var(--border)', borderRadius: 0,
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
