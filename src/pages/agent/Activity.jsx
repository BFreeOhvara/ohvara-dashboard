import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarDays, Inbox, Sun, Clock, Moon, TriangleAlert } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicyEvents, usePolicyStory } from '../../hooks/useAgentActivity'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { DayHero, ActivityBox, ActivityFeed, FeedNote, ActivityDrawer } from '../../components/agent/AgentUI'
import { ACTIVITY_ROWS, activityRow, EVENT_ICON, kindTone, eventIconKey } from '../../lib/activityKinds'
import { fullName } from '../../lib/policyFormat'
import { callWhen, callAt } from '../../lib/scheduling'
import { SUBSTATUS_LABEL, tabOf, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

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

// The feed's sentence for one event.
function describe(e) {
  const d = e.detail || {}
  const tz = tzOf(e)
  const attempt = d.attempt > 1 ? ` (try ${d.attempt})` : ''
  switch (e.kind) {
    case 'booked':
      if (e.from_status) return d.scheduled_call_at ? `Back to Booked, call set for ${callAt(d.scheduled_call_at, tz)}` : 'Back to Booked'
      return `Booked a call with Fulfillment${d.scheduled_call_at ? ` for ${callAt(d.scheduled_call_at, tz)}` : ''}`
    case 'in_progress':  return `${who(e)} started a call${attempt}`
    case 'no_answer':    return `Call ended with no answer${attempt}${reasonOf(d)}`
    case 'cancelled':    return 'Old policy confirmed cancelled'
    case 'moved':        return `Call moved to ${callAt(d.to, tz)}`
    case 'edited':       return editedText(d)
    default:             return e.kind
  }
}

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth']

// The client story's Journey step for one event (label + sub line).
function storyStep(e, isAdmin) {
  const d = e.detail || {}
  const tz = tzOf(e)
  const when = callWhen(e.at)
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

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The old day's half of the slide: a static copy of each day-dependent block
// ([data-day-slide]) goes out towards the side you came from while React
// mounts the new day, which comes in from the other side (.ov-slide-from-*).
// The copy sits in the block's .ov-slide-frame, which clips while it runs.
function slideOut(root, dir) {
  if (!root) return
  const reduce = reducedMotion()
  const dx = dir === 'prev' ? 32 : -32
  root.querySelectorAll('[data-day-slide]').forEach(node => {
    const frame = node.parentElement
    if (!frame || !node.offsetWidth || typeof node.animate !== 'function') return
    const ghost = node.cloneNode(true)
    ghost.removeAttribute('data-day-slide')
    ghost.removeAttribute('class')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    ghost.dataset.slideGhost = ''
    Object.assign(ghost.style, { position: 'absolute', left: '0', top: '0', width: `${node.offsetWidth}px`, pointerEvents: 'none' })
    frame.classList.add('is-sliding')
    frame.appendChild(ghost)
    const duration = reduce ? 120 : 240
    const anim = ghost.animate(
      reduce ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }],
      { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    )
    const done = () => {
      if (!ghost.isConnected) return
      ghost.remove()
      if (!frame.querySelector('[data-slide-ghost]')) frame.classList.remove('is-sliding')
    }
    anim.onfinish = done
    anim.oncancel = done
    // A hidden tab can pause the animation; never leave the copy behind.
    setTimeout(done, duration + 200)
  })
}

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

  const events = usePolicyEvents(day, isAdmin ? null : profile?.id)
  const bookings = useAgentBookings(isAdmin ? null : profile?.id)

  // `row` is the status an event counts and reads under: its own for Booked / Calls /
  // No answer / Cancelled, the client's current one for Moved and Edited.
  const bookingOf = new Map((bookings.data || []).map(p => [p.id, p]))
  const all = (events.data || []).map(e => ({
    key: `e-${e.id}`, id: e.id, kind: e.kind, rebook: !!e.from_status, at: e.at, policyId: e.policy_id, agentId: e.agent_id,
    client: fullName(e.policy), agent: e.agent?.full_name, text: describe(e),
    row: activityRow(e.kind, bookingOf.has(e.policy_id) ? tabOf(bookingOf.get(e.policy_id)) : null),
  }))
  const feed = isAdmin ? excludeTestAccounts(all, profile?.id, 'agentId') : all

  const counts = Object.fromEntries(ACTIVITY_ROWS.map(k => [k, 0]))
  feed.forEach(i => { counts[i.row] += 1 })
  const clients = new Set(feed.map(i => i.policyId)).size
  const groups = PARTS
    .map(part => ({ ...part, items: feed.filter(i => part.test(new Date(i.at).getHours())).sort((a, b) => new Date(a.at) - new Date(b.at)) }))
    .filter(g => g.items.length)

  // ── The open client's drawer (in the URL, so refresh works) ──
  const withParams = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const openClient = item => withParams(next => { next.set('client', item.policyId); next.set('event', item.id) })
  const closeClient = () => withParams(next => { next.delete('client'); next.delete('event') })

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
  else if (events.error) note = <FeedNote icon={TriangleAlert} tone={{ fg: 'var(--danger)', tint: 'var(--danger-dim)' }} error>Couldn&rsquo;t load activity: {events.error.message}</FeedNote>
  else if (!feed.length) {
    note = back === 0
      ? <FeedNote icon={Inbox} tone={kindTone('booked')}>Nothing yet today. Bookings, calls and cancellations show up here as they happen.</FeedNote>
      : <FeedNote icon={CalendarDays} tone={kindTone('no_answer')}>Nothing happened on this day.</FeedNote>
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
        summary={loadingDay ? 'Loading…' : feed.length ? `${plural(feed.length, 'event')} happened with ${plural(clients, 'client')}` : 'Nothing happened this day.'}
        summaryShort={loadingDay ? 'Loading…' : feed.length ? `${plural(feed.length, 'event')} · ${plural(clients, 'client')}` : 'Nothing happened'}
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
        title={boxTitle(back, day)} counts={counts}
      />

      <ActivityFeed
        dayKey={dayKey} slideClass={slideClass}
        groups={groups} note={note} activeKey={drawerOpen && eventId ? `e-${eventId}` : null} onOpen={openClient} showAgent={isAdmin}
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
