import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, PhoneCall, PhoneMissed, CalendarClock, CircleCheck, CalendarArrowUp, MessageSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicyEvents, useReceivedMessages } from '../../hooks/useAgentActivity'
import { card, MONO } from '../../lib/exportStyles'
import { SectionHead, EmptyNote, Pill, GroupRow } from '../../components/agent/AgentUI'
import { Segmented } from '../../components/ui/Segmented'
import { GapNote } from '../../components/ui/ExportForm'
import { fullName } from '../../lib/policyFormat'
import { fmtBooking } from '../../lib/scheduling'
import { STAGE, SUBSTATUS_LABEL, sameLocalDay, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Activity (Prompt 690) — what actually happened, newest first. My Pipeline
// shows where each client stands NOW; this is the history behind it: every
// status change (Booked → In progress → Cancelled / No answer / Rescheduling,
// Prompt 689), every time a booked call was moved, and Fulfillment's messages.
//
// Status events come from policy_events (migration 118, written by a trigger
// on policies, so nothing in the app has to remember to log). Messages are
// read straight from policy_messages and shown as a one-line preview that
// opens the thread — Messages stays the place to read and reply.
//
// Admin lands here too and sees every agent's activity (test account held out,
// same as My Pipeline), with the agent named on each row.

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
]
const FILTERS = [
  { value: 'all', label: 'Everything' },
  { value: 'status', label: 'Status changes' },
  { value: 'messages', label: 'Messages' },
]
const PAGE = 50

// policy_events.kind → how the row reads. Status kinds reuse STAGE's colours.
const KIND = {
  booked:       { icon: CalendarCheck,   stage: 'booked' },
  in_progress:  { icon: PhoneCall,       stage: 'inProgress' },
  no_answer:    { icon: PhoneMissed,     stage: 'noAnswer' },
  rescheduling: { icon: CalendarClock,   stage: 'rescheduling' },
  cancelled:    { icon: CircleCheck,     stage: 'cancelled' },
  moved:        { icon: CalendarArrowUp, color: 'var(--text-secondary)' },
  message:      { icon: MessageSquare,   color: 'var(--accent)' },
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

function dayLabel(iso, now) {
  if (sameLocalDay(iso, new Date(now))) return 'Today'
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (sameLocalDay(iso, y)) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function Activity() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()
  const navigate = useNavigate()

  const [range, setRange] = useState('30')
  const [filter, setFilter] = useState('all')
  const [limit, setLimit] = useState(PAGE)

  // Floored to midnight so the query key only changes once a day.
  const since = useMemo(() => {
    const d = new Date(now)
    d.setDate(d.getDate() - (Number(range) - 1))
    d.setHours(0, 0, 0, 0)
    return d
  }, [now, range])

  const events = usePolicyEvents(since, isAdmin ? null : profile?.id)
  const messages = useReceivedMessages(since, profile?.id, isAdmin)

  const feed = useMemo(() => {
    const ev = (events.data || []).map(e => ({
      key: `e-${e.id}`, type: 'event', kind: e.kind, at: e.at, policyId: e.policy_id, agentId: e.agent_id,
      client: fullName(e.policy), agent: e.agent?.full_name, text: describe(e),
    }))
    const msg = (messages.data || []).map(m => ({
      key: `m-${m.id}`, type: 'message', kind: 'message', at: m.created_at, policyId: m.policy_id,
      agentId: m.policy?.agent_id, client: fullName(m.policy), agent: m.policy?.agent?.full_name,
      sender: m.sender_name, body: m.body,
    }))
    const all = [...(filter === 'messages' ? [] : ev), ...(filter === 'status' ? [] : msg)]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
    return isAdmin ? excludeTestAccounts(all, profile?.id, 'agentId') : all
  }, [events.data, messages.data, filter, isAdmin, profile?.id])

  const loading = events.isLoading || messages.isLoading
  const error = events.error || messages.error
  const shown = feed.slice(0, limit)

  const open = item => navigate(item.type === 'message'
    ? `/messages?thread=${item.policyId}`
    : `/agent/clients?stage=all&open=${item.policyId}`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented options={FILTERS} value={filter} onChange={v => { setFilter(v); setLimit(PAGE) }} size="sm" />
        <Segmented options={RANGES} value={range} onChange={v => { setRange(v); setLimit(PAGE) }} size="sm" style={{ marginLeft: 'auto' }} />
      </div>

      <div>
        <SectionHead
          title={isAdmin ? "Everyone's activity" : 'Your activity'}
          sub={`Last ${range} days · newest first · updates every 30 seconds`}
        />
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : error ? (
            <p style={{ margin: 0, padding: '32px 20px', textAlign: 'center', fontSize: 14, color: 'var(--danger)' }}>
              Couldn't load activity: {error.message}
            </p>
          ) : shown.length === 0 ? (
            <EmptyNote>
              {filter === 'messages'
                ? `No messages from Fulfillment in the last ${range} days.`
                : `Nothing in the last ${range} days. Bookings, calls and cancellations show up here as they happen.`}
            </EmptyNote>
          ) : (
            <>
              {shown.map((item, i) => {
                const label = dayLabel(item.at, now)
                const newDay = i === 0 || dayLabel(shown[i - 1].at, now) !== label
                return (
                  <div key={item.key}>
                    {newDay && <GroupRow label={label} first={i === 0} />}
                    <FeedRow item={item} showAgent={isAdmin} onClick={() => open(item)} />
                  </div>
                )
              })}
              {feed.length > shown.length && (
                <button
                  onClick={() => setLimit(n => n + PAGE)}
                  style={{
                    width: '100%', padding: '12px 20px', border: 'none', borderTop: 'var(--border-w) solid var(--border)',
                    background: 'var(--bg-elevated)', fontSize: 13, fontWeight: 600, color: 'var(--accent)',
                  }}
                >
                  Show more ({feed.length - shown.length})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <GapNote>
        Activity is logged from Oct 4, 2026. Bookings from before then show their booking, their latest call outcome and their cancellation, but not every call attempt in between. Tap a row to open the client, or a message to open its thread.
      </GapNote>
    </div>
  )
}

function FeedRow({ item, showAgent, onClick }) {
  const k = KIND[item.kind] || KIND.moved
  const stage = k.stage && STAGE[k.stage]
  const Icon = k.icon
  const color = stage ? stage.fill : k.color
  return (
    <button
      onClick={onClick}
      className="menu-row"
      style={{
        gap: 12, padding: '12px 20px', borderTop: 'var(--border-w) solid var(--border)', borderRadius: 0,
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
          {item.type === 'message'
            ? <><span style={{ color: 'var(--text-primary)' }}>{item.sender}</span> messaged: “{item.body}”</>
            : item.text}
        </span>
      </span>
      <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 62, textAlign: 'right' }}>
        {new Date(item.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </span>
    </button>
  )
}
