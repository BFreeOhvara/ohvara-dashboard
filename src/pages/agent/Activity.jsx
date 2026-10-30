import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays, Inbox, Sun, Clock, Moon } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useActivityFeed, usePolicyStory } from '../../hooks/useAgentActivity'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useInboundActivity } from '../../hooks/useInbounds'
import { DayHero, ActivityBox, ActivityFilter, ActivityFeed, FeedNote, ActivityDrawer, LoadError } from '../../components/agent/AgentUI'
import {
  EVENT_KIND, EVENT_ICON, kindTone, eventIconKey, groupOf, groupTone, groupCounts, visibleGroups, toggleGroup, parseSelected, filterItems,
  EMPTY_ALL, EMPTY_MANY,
} from '../../lib/activityKinds'
import { fullName } from '../../lib/policyFormat'
import { callWhen, callAt } from '../../lib/scheduling'
import { SUBSTATUS_LABEL, tabOf, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'
import { slideOut } from '../../lib/daySlide'
import { inboundPath } from '../../lib/inbounds'

// Activity (Prompt 690) — what actually happened, earliest first (P741). My Pipeline
// shows where each client stands NOW; this is the history behind it: every
// status change (Booked → In progress → Cancelled / No answer,
// Prompts 689/695) and every time a booked call was moved. Messages are not shown
// here (Prompt 694) — the Messages page is the one place for those.
// Events come from policy_events (migration 118, written by a trigger on
// policies, so nothing in the app has to remember to log).
//
// Prompt 718 — rethought on the v16 language. One day at a time: a coloured
// day hero whose edge arrows (and ← / →, and a swipe on phones) slide between
// days, the day's activity as a bar, then the feed as a timeline.
// The page scrolls normally (the P698 fit-the-box sizing is gone).
//
// Prompt 733 — the activity box only displays (no filter tabs; Moved and Edited
// events count under the status the client is in now), the feed spans the page,
// and clicking an event slides in a read-only drawer (My Pipeline's shell) with
// the client's story and "Go to My Pipeline", the page's one way there. The open
// client is in the URL (?client=<policy id>&event=<event id>).
//
// Admin lands here too and sees every agent's activity (test account held out,
// same as My Pipeline), with the agent named on each row.
//
// Every kind of event comes from agent_activity_feed() (migration 185): leads, texts, calls,
// bookings, outcomes, client updates. Filter chips (All plus one per group that has a source,
// multi-select, kept in the URL as ?types=) narrow the day's rows client-side; the Activity box
// counts the whole day by group. Before that migration is applied the hook falls back to
// policy_events, and an agent's finished inbound steps (inbound_events) join the feed as before.

const firstName = s => String(s || '').trim().split(/\s+/)[0] || ''
const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// "Sam from Fulfillment" when we know who did it, else just the team.
function who(e) {
  if (e.actor_role === 'fulfillment' && e.actor_name) return `${firstName(e.actor_name)} from Fulfillment`
  if (e.actor_role === 'admin') return 'Admin'
  return 'Fulfillment'
}

const reasonOf = d => (d.reason ? ` · ${(SUBSTATUS_LABEL[d.reason] || d.reason).toLowerCase()}` : '')

// Prompt 724 — call times inside an event are the client's time (the joined
// policy's client_timezone); when the event happened stays in the viewer's.
const tzOf = e => e.policy?.client_timezone || undefined

// Prompt 730 — an 'edited' event's sentence: "Carrier changed: Aetna → Mutual
// of Omaha" for one field, "Details changed: carrier, phone" for several.
const FIELD_LABEL = { name: 'Name', phone: 'Phone', city: 'City', state: 'State', carrier: 'Carrier' }
function editedText(d) {
  const changes = Array.isArray(d.changes) ? d.changes : []
  if (changes.length === 1) {
    const c = changes[0]
    return `${FIELD_LABEL[c.field] || c.field} changed: ${c.from || 'blank'} → ${c.to || 'blank'}`
  }
  if (!changes.length) return 'Details changed'
  return `Details changed: ${changes.map(c => (FIELD_LABEL[c.field] || c.field).toLowerCase()).join(', ')}`
}

// Prompt 750 — a result Fulfillment fixed (fulfillment_correct_result) reads
// as a change, not a fresh call.
const correctionText = e => (e.detail?.correction
  ? `Result changed to ${e.kind === 'cancelled' ? 'Cancelled' : 'No answer'}` : null)

// The feed's sentence for one row of agent_activity_feed(). Rows carry no old/new values
// (an edit lists field names only) and no phone numbers; a text reply shows its preview.
const FIELDS = fields => (fields || []).map(f => (FIELD_LABEL[f] || f).toLowerCase())
const OUTCOME_LABEL = { follow_up: 'Follow up', not_interested: 'Not interested', sold: 'Sold' }
function rowText(r) {
  const m = r.meta || {}
  const tz = m.client_timezone || undefined
  const attempt = m.attempt > 1 ? ` (try ${m.attempt})` : ''
  switch (r.kind) {
    case 'booked':
      if (String(r.id).startsWith('lead_booked:')) return 'VA booked an appointment'
      if (m.rebook || /again/i.test(r.title)) return m.to ? `Back to Booked, call set for ${callAt(m.to, tz)}` : 'Back to Booked'
      return `Booked a call with Fulfillment${m.to ? ` for ${callAt(m.to, tz)}` : ''}`
    case 'in_progress':  return `${who(m)} started a call${attempt}`
    case 'no_answer':    return `Call ended with no answer${attempt}${reasonOf(m)}`
    case 'cancelled':    return 'Old policy confirmed cancelled'
    case 'moved':        return `Call moved to ${callAt(m.to, tz)}`
    case 'edited': {
      const f = FIELDS(m.changed_fields)
      return f.length === 1 ? `${FIELD_LABEL[m.changed_fields[0]] || m.changed_fields[0]} changed` : f.length ? `Details changed: ${f.join(', ')}` : 'Details changed'
    }
    case 'reassigned':   return `Fulfillment call given to ${m.to_name || 'another rep'}`
    case 'text_auto':    return m.reason === 'just_submitted' ? 'Sent automatically: welcome text' : 'Sent automatically: follow-up text'
    case 'text_reply':   return m.preview ? `“${m.preview}”` : r.title
    case 'va_call':
      if (m.reason === 'not_reached') return `VA call, try ${m.attempt || 1}`
      if (m.reason === 'callback') return m.to ? `Reached, callback set for ${callAt(m.to, tz)}` : 'Reached, callback set'
      if (m.reason === 'not_interested') return 'Reached, not interested'
      return r.title
    case 'transferred':
      return m.reason === 'connected' ? 'VA transferred the live call to you' : m.reason === 'dropped' ? 'The live transfer dropped' : 'A live transfer was requested'
    case 'outcome':
      if (m.result_to) return `Result changed to ${m.result_to === 'cancelled' ? 'Cancelled' : 'No-show'}`
      return OUTCOME_LABEL[m.reason] ? `Outcome marked: ${OUTCOME_LABEL[m.reason]}` : r.title
    case 'sold':         return 'Marked Sold. Now a client'
    default:             return r.title || EVENT_KIND[r.kind]?.label || r.kind
  }
}

// Where tapping a row goes: the client's story drawer, the lead's page, or Billing.
function targetOf(r) {
  const m = r.meta || {}
  if (groupOf(r.kind) === 'billing') return 'billing'
  if (/^(policy_event|policy_message):/.test(String(r.id)) && m.policy_id) return 'drawer'
  if (r.lead_id) return 'lead'
  return m.policy_id ? 'drawer' : null
}

// One rpc row as a feed item.
function feedItem(r) {
  const m = r.meta || {}
  return {
    key: `r-${r.id}`, id: r.id, eventId: String(r.id).replace(/^policy_event:/, ''), kind: r.kind, reason: m.reason, rebook: !!m.rebook,
    at: r.at, policyId: m.policy_id, leadId: r.lead_id, agentId: r.agent_id, target: targetOf(r),
    client: fullName({ client_first_name: m.client_first_name, client_last_name: m.client_last_name }).replace(/^—$/, ''),
    agent: r.agent_name, text: rowText(r), cents: typeof m.amount_cents === 'number' ? m.amount_cents : null,
  }
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth']

// The client story's Journey step for one event (label + sub line).
function storyStep(e, isAdmin) {
  const d = e.detail || {}
  const tz = tzOf(e)
  const when = callWhen(e.at)
  const fixed = correctionText(e)
  if (fixed) return { label: fixed, sub: when }
  const forTime = d.scheduled_call_at ? ` · for ${callAt(d.scheduled_call_at, tz)}` : ''
  switch (e.kind) {
    case 'booked':
      if (e.from_status) return { label: 'Re-booked', sub: when + forTime }
      return { label: isAdmin ? `${firstName(e.agent?.full_name) || 'The agent'} booked the call` : 'You booked the call', sub: when + forTime }
    case 'in_progress':
      return { label: `${who(e)} called${d.attempt > 1 ? ' again' : ''}`, sub: when }
    case 'no_answer': {
      const n = d.attempt || 1
      const head = n > 1 ? `No answer on the ${ORDINAL[n] ? `${ORDINAL[n]} try` : `try ${n}`}` : 'No answer'
      return { label: head + reasonOf(d), sub: when }
    }
    case 'moved':     return { label: 'Call moved', sub: `${when}${d.to ? ` · to ${callAt(d.to, tz)}` : ''}` }
    case 'edited':    return { label: editedText(d), sub: when }
    case 'reassigned': return { label: `Call given to ${d.to_name || 'another rep'}`, sub: when }
    case 'cancelled': return { label: 'Old policy cancelled', sub: when }
    default:          return { label: e.kind, sub: when }
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

// "Today" / "Yesterday" / the weekday (this year) / the year.
function dayTitle(day, now) {
  const today = startOfDay(now)
  const name = day.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  if (day.getTime() === today.getTime()) return { name, tag: 'Today' }
  if (day.getTime() === addDays(today, -1).getTime()) return { name, tag: 'Yesterday' }
  return { name, tag: day.getFullYear() === today.getFullYear() ? day.toLocaleDateString('en-US', { weekday: 'long' }) : String(day.getFullYear()) }
}

// "Today's activity" / "Yesterday's" / "Monday's" (this week) / "Oct 2's".
function boxTitle(back, day) {
  if (back === 0) return "Today's activity"
  if (back === 1) return "Yesterday's activity"
  if (back < 7) return `${day.toLocaleDateString('en-US', { weekday: 'long' })}'s activity`
  return `${day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}'s activity`
}

const PARTS = [
  { key: 'morning',   label: 'Morning',   icon: Sun,   test: h => h < 12 },
  { key: 'afternoon', label: 'Afternoon', icon: Clock, test: h => h >= 12 && h < 17 },
  { key: 'evening',   label: 'Evening',   icon: Moon,  test: h => h >= 17 },
]

export default function Activity() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const clientId = params.get('client')
  const eventId = params.get('event')
  const drawerOpen = !!clientId

  // Days back from today (0 = today), so "Today" stays pinned across midnight.
  const [back, setBack] = useState(0)
  const [dir, setDir] = useState(null)
  const [pickOpen, setPickOpen] = useState(false)
  const rootRef = useRef(null)
  const touch = useRef(null)

  const today = startOfDay(now)
  const day = addDays(today, -back)
  const title = dayTitle(day, now)

  const events = useActivityFeed(day, isAdmin ? null : profile?.id)
  const bookings = useAgentBookings(isAdmin ? null : profile?.id)
  const inbound = useInboundActivity(day)

  const bookingOf = new Map((bookings.data || []).map(p => [p.id, p]))
  const all = (events.data?.rows || []).map(feedItem)
  // Before migration 185 is applied (fromFunction false) an agent's finished inbound steps
  // join the feed as before; the function returns them as lead, text, call and outcome rows.
  const extra = !isAdmin && events.data && !events.data.fromFunction ? inbound.items.map(i => ({ ...i, target: 'lead', pill: 'Lead update' })) : []
  const feed = isAdmin ? excludeTestAccounts(all, profile?.id, 'agentId') : [...all, ...extra]

  // The type filter (kept in the URL like the open client) narrows the day's rows.
  const selected = parseSelected(params.get('types'))
  const counts = groupCounts(feed)
  const chips = visibleGroups().map(g => ({ ...g, count: counts[g.key] }))
  const shownFeed = filterItems(feed, selected)
  const clients = new Set(feed.map(i => i.policyId || i.leadId).filter(Boolean)).size
  const groups = PARTS
    .map(part => ({ ...part, items: shownFeed.filter(i => part.test(new Date(i.at).getHours())).sort((a, b) => new Date(a.at) - new Date(b.at)) }))
    .filter(g => g.items.length)

  // ── The open client's drawer (in the URL, so refresh works) ──
  const withParams = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const openClient = item => {
    if (item.target === 'billing') return navigate('/agent/billing')
    if (item.target === 'lead') return navigate(inboundPath(item.leadId))
    withParams(next => { next.set('client', item.policyId); next.set('event', item.eventId) })
  }
  const closeClient = () => withParams(next => { next.delete('client'); next.delete('event') })
  const setTypes = keys => withParams(next => { if (keys.length) next.set('types', keys.join(',')); else next.delete('types') })

  // ── Moving between days ──
  const goTo = target => {
    const next = Math.max(0, target)
    if (next === back) return
    const d = next > back ? 'prev' : 'next'
    slideOut(rootRef.current, d)
    setDir(d)
    setBack(next)
    if (drawerOpen) closeClient()
  }
  const onArrowKey = useEffectEvent(e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTyping(e.target)) return
    if (pickOpen || drawerOpen || e.target.closest?.('[role="dialog"]')) return
    e.preventDefault()
    goTo(back + (e.key === 'ArrowLeft' ? 1 : -1))
  })
  useEffect(() => {
    const onKey = e => onArrowKey(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Phones: a horizontal swipe of 60px+ on the feed changes the day
  // (swipe left = the next day, like turning a page).
  const swipe = {
    onTouchStart: e => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY } },
    onTouchEnd: e => {
      const start = touch.current
      touch.current = null
      if (!start || drawerOpen) return
      const t = e.changedTouches[0]
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      if (dx < 0 && back > 0) goTo(back - 1)
      else if (dx > 0) goTo(back + 1)
    },
  }

  // ── The open client's story ──
  const story = usePolicyStory(clientId)
  const row = clientId ? bookingOf.get(clientId) || null : null
  const history = story.data || []
  const latest = history[history.length - 1]
  const cancelledNow = row ? tabOf(row) === 'cancelled' : latest?.kind === 'cancelled'
  const steps = history.map((e, i) => ({
    ...storyStep(e, isAdmin),
    tone: kindTone(e.kind),
    done: cancelledNow || i < history.length - 1,
  }))
  if (history.length && !cancelledNow) steps.push({ label: 'Old policy cancelled', done: false })
  const openPipeline = () => navigate(row ? `/agent/clients?stage=${tabOf(row)}&open=${clientId}` : `/agent/clients?open=${clientId}`)
  const shown = clientId ? feed.find(i => i.policyId === clientId) : null

  // ── Feed notes ──
  let note = null
  if (events.isLoading) note = <FeedNote>Loading…</FeedNote>
  else if (events.error) note = <LoadError what="this day's activity" onRetry={() => events.refetch()} />
  else if (!feed.length) {
    note = back === 0
      ? <FeedNote icon={Inbox} tone={kindTone('booked')}>{EMPTY_ALL}</FeedNote>
      : <FeedNote icon={CalendarDays} tone={kindTone('no_answer')}>Nothing happened on this day.</FeedNote>
  } else if (!shownFeed.length) {
    // The filter leaves nothing: one chip gets its own sentence, several get a shared one.
    const only = selected.length === 1 ? chips.find(g => g.key === selected[0]) : null
    note = only
      ? <FeedNote icon={EVENT_KIND[only.kinds[0]].icon} tone={groupTone(only)}>{only.empty}</FeedNote>
      : <FeedNote icon={Inbox} tone={{ fg: 'var(--ov-mid)', tint: 'var(--ov-neutral-tint)' }} action={{ label: 'Clear filter', onClick: () => setTypes([]) }}>{EMPTY_MANY}</FeedNote>
  }

  const slideClass = dir === 'prev' ? 'ov-slide-from-left' : dir === 'next' ? 'ov-slide-from-right' : undefined
  const dayKey = String(back)
  const loadingDay = events.isLoading

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1320, width: '100%', margin: '0 auto' }}>
      <DayHero
        dayKey={dayKey} slideClass={slideClass}
        tag={title.tag}
        dateLong={day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        dateShort={day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        summary={events.error ? 'Couldn’t load this day.' : loadingDay ? 'Loading…' : feed.length ? `${plural(feed.length, 'event')} happened with ${plural(clients, 'client')}` : 'Nothing happened this day.'}
        summaryShort={events.error ? 'Couldn’t load' : loadingDay ? 'Loading…' : feed.length ? `${plural(feed.length, 'event')} · ${plural(clients, 'client')}` : 'Nothing happened'}
        canNext={back > 0}
        onPrev={() => goTo(back + 1)}
        onNext={() => goTo(back - 1)}
        pickOpen={pickOpen}
        onTogglePick={() => setPickOpen(o => !o)}
        picker={
          <MonthPicker
            selected={day} today={today}
            onClose={() => setPickOpen(false)}
            onPick={d => { setPickOpen(false); goTo(Math.round((today - startOfDay(d)) / 864e5)) }}
          />
        }
      />

      <ActivityBox
        dayKey={dayKey} slideClass={slideClass}
        title={boxTitle(back, day)} rows={chips} cancelled={feed.filter(i => i.kind === 'cancelled').length}
      />

      <ActivityFeed
        dayKey={dayKey} slideClass={slideClass}
        filter={feed.length ? (
          <ActivityFilter
            groups={chips} selected={selected} total={feed.length} shown={shownFeed.length}
            onToggle={key => setTypes(toggleGroup(selected, key))} onClear={() => setTypes([])}
          />
        ) : null}
        groups={groups} note={note} activeKey={drawerOpen && eventId ? `r-policy_event:${eventId}` : null} onOpen={openClient} showAgent={isAdmin}
        {...swipe}
      />

      {drawerOpen && (
        <ActivityDrawer
          key={`${clientId}:${eventId}`}
          p={row}
          name={row ? fullName(row) : shown?.client || fullName(history[0]?.policy) || 'Client'}
          agentName={isAdmin ? shown?.agent || history[0]?.agent?.full_name : null}
          steps={steps}
          highlight={history.findIndex(e => String(e.id) === eventId)}
          currentIcon={latest ? EVENT_ICON[eventIconKey({ kind: latest.kind, rebook: !!latest.from_status })] : undefined}
          loading={story.isLoading}
          now={now}
          onOpenPipeline={openPipeline}
          onClose={closeClient}
        />
      )}
    </div>
  )
}

// Month picker under the hero's "Pick a date": a far-back day is one click,
// not many arrows. Future days are disabled.
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function MonthPicker({ selected, today, onPick, onClose }) {
  const [view, setView] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1))
  const box = useRef(null)
  useEffect(() => {
    const away = e => {
      if (box.current?.contains(e.target) || e.target.closest?.('[data-pick-toggle]')) return
      onClose()
    }
    const esc = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [onClose])

  const first = new Date(view.getFullYear(), view.getMonth(), 1)
  const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let n = 1; n <= daysIn; n++) cells.push(new Date(view.getFullYear(), view.getMonth(), n))
  const atCurrentMonth = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth()
  const step = n => setView(new Date(view.getFullYear(), view.getMonth() + n, 1))
  const monthBtn = { width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }

  return (
    <div ref={box} role="dialog" aria-label="Choose a date" className="ov-card ov-pop" style={{
      position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 50,
      width: 300, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', padding: 14, userSelect: 'none', textAlign: 'left',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button type="button" className="ov-ghost" aria-label="Previous month" onClick={() => step(-1)} style={monthBtn}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>
          {view.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" className="ov-ghost" aria-label="Next month" disabled={atCurrentMonth} onClick={() => step(1)}
          style={{ ...monthBtn, opacity: atCurrentMonth ? 0.35 : 1, cursor: atCurrentMonth ? 'not-allowed' : 'pointer' }}>
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DOW.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--ov-mute)', padding: '2px 0' }}>{d}</div>
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
              key={i} type="button" disabled={future} onClick={() => onPick(d)}
              aria-current={isToday ? 'date' : undefined} aria-pressed={isSel}
              className={isSel ? 'ov-solid' : undefined}
              style={{
                height: 38, borderRadius: 10, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', border: 'none',
                ...(isSel ? null : { background: 'transparent', color: isToday ? 'var(--ov-pick)' : 'var(--ov-hi)' }),
                fontWeight: isSel || isToday ? 700 : 500,
                opacity: future ? 0.35 : 1, cursor: future ? 'not-allowed' : 'pointer',
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
