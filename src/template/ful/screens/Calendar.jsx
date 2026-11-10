import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Phone, MessageSquare, CalendarClock, MapPin, CircleCheck, PhoneMissed, Forward, ArrowRight, Users, ChevronRight, Handshake, FileX2, LifeBuoy, PencilLine, Ban, PhoneIncoming, HeartHandshake, CalendarHeart, UserX } from 'lucide-react'
import { useFulCalls, useFulActions, useFulSchedule, useVaBooking, useFulClock, useFulSource, minutesOf, STATE_WORD } from '../data'
import { Avatar, Chip, Drawer, Empty, Field, PillTabs, Seg, useNote } from '../../kit'
import { DayBox, WeekList } from '../../DayBox'
import { SlotPick } from '../../SlotPick'
import { useOpenDay, useStickyDay } from '../../useOpenDay'
import { useClientZone } from '../../useClientZone'
import { sampleSlots, hoursLine } from '../../carriers'
import { vaSlots, freeVa, zoneAbbr } from '../../../lib/callSlots'
import { RecordDrawer, Block } from '../../Record'
import { CountUp } from '../../motion'
import { TaskDrawer } from './Servicing'
import { CALL_TYPES, FILTERS, filterOf } from '../bookings'
import { StartCall } from '../StartCall'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { DocsBlock, GateStep } from '../Docs886'
import { useGate } from '../../docs886/data'
import { BeforeCall } from '../BeforeCall'

// P918 — Calendar: every booked call (this was the Schedule page; Schedule is now the VA's own hours). This week ·
// Next week with a chip per call type beside it; no day buttons, no Show panel, no colour key. A call opens its view
// (client, agent, why, the short script, the steps, Start call), and Start call turns on only near the call's time.
// P846 — Schedule (it was Calls): the VA's week as the same calendar the agent has, with everything they have to do
// at a time on it (P907: booked calls only, see below). Any item opens its drawer at its own address
// (/fulfillment/schedule/<id>): a cancel-the-old-policy call keeps everything the Calls page had (client facts, the
// checklist, result buttons, notes, Move, Pass on); every other booking opens its servicing drawer. Under the calendar, the week's rota (who is on which day) and the Request a day off action. Sample only.
// P854: no Week/Day toggle. The week is full width; click a day (its header, a strip chip, or empty space in its
// column) and the page switches to that day with its box sliding in from the right (shared with the agent Calendar:
// ../../DayBox, ?day= in the URL). Blocks sit by their instant on the VA's clock, the client's time beside it when it
// differs. Move and Pass on obey the 30-minute rule (lib/callSlots): a taken time is greyed out.
// P907: the VA works in bookings. The Schedule is booked calls only, every one given its time by the system: hand-off
// calls after a sale, cancelling the old policy, save calls, change requests, cancel requests, callbacks (a missed
// incoming call or a reply that needs a person), welcome calls and yearly reviews. No queue, no appointments booked for
// agents. Colour = the kind of call (four families, legend below); done is grey. A cancellation opens its call drawer;
// every other booking opens its servicing drawer here, with Move.

const START = 8 // the grid runs 8:00 AM to 6:00 PM, the carriers' hours
const ROWS = 10
const SLOT = 30 // minutes an event block covers (a block is time over name), so close times sit side by side
const HOURS = Array.from({ length: ROWS }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const SAMPLE_NOW = '1:32 PM' // sample clock: the next call is 28 minutes after it
const WEEK_LABEL = ['This week', 'Next week']
const TYPE_ICON = { handoff: Handshake, cancel_old: FileX2, save: LifeBuoy, change: PencilLine, cancel_request: Ban, callback: PhoneIncoming, welcome: HeartHandshake, noshow: UserX, review: CalendarHeart }
const typeWord = e => e.word || CALL_TYPES[e.type]?.label || CALL_WORD[e.status] || 'Call'
const stateWord = e => (e.state ? STATE_WORD[e.state] : CALL_WORD[e.status]) || ''

// Side-by-side lanes for items that overlap: { ref -> [lane, lanes in its cluster] }.
function lanesOf(list) {
  const out = new Map()
  let cluster = []
  let ends = []
  let clusterEnd = -1
  const flush = () => { const of = Math.max(1, ends.length); cluster.forEach(([e, k]) => out.set(e.ref, [k, of])); cluster = []; ends = []; clusterEnd = -1 }
  for (const e of list) {
    const s = minutesOf(e.time)
    if (cluster.length && s >= clusterEnd) flush()
    let k = ends.findIndex(end => end <= s)
    if (k < 0) { k = ends.length; ends.push(0) }
    ends[k] = s + SLOT
    clusterEnd = Math.max(clusterEnd, s + SLOT)
    cluster.push([e, k])
  }
  flush()
  return out
}

// P918: the short script for a cancel-the-old-policy call.
const sayCancel = k => `Hi ${k.client.client_first_name || k.name.split(' ')[0]}, this is (your name) with Deedstone, calling for ${k.agent.split(' ')[0]}. Your new ${k.carrier} policy is in place, so let’s call ${k.old_carrier} together and cancel the old one, so you never pay for both. Do you have ten minutes?`

// A cancellation call (what the Calls page's drawer was, with every part kept). Start call opens the live-call overlay.
export function CallDrawer({ id, onClose }) {
  const { data: calls } = useFulCalls()
  const { markCall, saveCallNotes, moveCall, showLive } = useFulActions()
  const note = useNote()
  const k = calls.find(x => x.id === id) || calls[0]
  const [panel, setPanel] = useState(null)
  const [notes, setNotes] = useState(k.notes)
  const [endNote, setEndNote] = useState('')
  // P854: Move picks a new time on the client's clock; a slot is open when a VA on shift is free then (you first).
  const book = useVaBooking()
  const found = useClientZone(k.client.state, k.client.city)
  const zone = k.tz ? { ...found, tz: k.tz, auto: true } : found
  const { today: TODAY, nowIso: NOW_ISO, bookDays: BOOK_DAYS, dayName, dateText, isoOf } = useFulClock()
  const [mDay, setMDay] = useState(k.day > TODAY ? k.day : BOOK_DAYS[1][1])
  const [mTime, setMTime] = useState('')
  const clocks = useMemo(() => sampleSlots(isoOf(mDay), zone.tz, k.old_carrier), [mDay, zone.tz, k.old_carrier, isoOf])
  const slots = vaSlots({ date: isoOf(mDay), clocks, clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load, prefer: book.me, exceptId: k.id })
  const mPick = slots.find(x => x.clock === mTime && x.open && x.iso >= NOW_ISO)
  // Pass on: to another VA on shift who is free at this call's time.
  const taker = freeVa({ iso: k.iso, team: book.team, calls: book.calls, load: book.load, skip: [book.me] })
  const tone = CALL_TONE[k.status]
  const first = k.name.split(' ')[0]
  const open = k.status === 'booked' || k.status === 'no_answer'
  // P886/P899: the old policy goes once the new one is issued, before the old one's next draft.
  const gate = useGate(k.name)
  return (
    <RecordDrawer label={`Call with ${k.name}`} kicker={<>Cancel the old policy · {dayName(k.day)}, {dateText(k.day)} <HelpDot lesson="carrier_call" inline /></>} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{k.day === TODAY ? 'Today' : `${dayName(k.day)}, ${dateText(k.day)}`} · {k.when}</span><Chip tone={tone}>{CALL_WORD[k.status]}</Chip></div>
        <h2>{k.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{k.client.city}, {k.client.state} · {k.agent}'s client</p>
        <div className="fx-hero-bot"><span className="fs-swap is-hero"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={16} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></span><Avatar name={k.name} tone={tone} /></div>
      </>}
      actions={open ? <>
        <StartCall iso={k.iso} done={!open} blocked={!gate.open} why="Waits for the new policy to be issued" onStart={() => showLive(k.id)} />
        <button type="button" className="tp-btn ov-ghost" disabled={!gate.open} onClick={() => setPanel('cancelled')}><CircleCheck size={15} />Cancelled</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => { markCall(k.id, 'no_answer', { notes: notes || 'No answer.' }); note(`No answer logged for ${first}`) }}><PhoneMissed size={15} />No answer</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('move')}><CalendarClock size={15} />Move</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('pass')}><Forward size={15} />Pass on</button>
      </> : <>
        <Link to={fp('clients', k.client_id)} className="tp-btn ov-ghost"><Users size={15} />Open client</Link>
        <span className="tp-grow" />
        <Link to={fp('messages')} className="tp-btn ov-ghost"><MessageSquare size={14} />Message {k.agent.split(' ')[0]}</Link>
      </>}>
      {/* P923: what the agent said under "Before our team calls" (the replacement, their note), first. */}
      {open && <BeforeCall client={k.client} agent={k.agent} oldCarrier={k.old_carrier} cancelBy={gate.old_draft} />}
      {k.status === 'cancelled' && (
        <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />Old policy cancelled</h3></header><p className="tp-mid">{k.confirmation ? `Confirmation ${k.confirmation}.` : `Done on the call with ${first}.`}</p></section>
      )}
      {/* P888: the replacement gate and the cancellation papers are steps on this call, not boxes of their own. */}
      <Block title="On this call">
        <ol className="fs-steps">
          {k.status !== 'cancelled' && <GateStep who={k.name} />}
          {[['Confirm it is them', 'Name, date of birth, last four of the old policy'], ['Say why you’re calling', null], [`Call ${k.old_carrier} together`, gate.cancel_by ? `Cancel before the ${gate.old_draft} draft so they never pay twice` : 'Ask to cancel the old policy, end date today'], ['Questions about coverage', `Those go to ${k.agent}, not on this call`]].map(([a, b], i) => <li key={a} className={k.status === 'cancelled' ? 'done' : i === 0 && open && gate.open ? 'now' : ''}><i /><div><b>{a}</b>{b ? <span>{b}</span> : <p className="fs-say">“{sayCancel(k)}”</p>}</div></li>)}
          <li className={k.status === 'cancelled' ? 'done' : ''}><i /><div><b>Cancellation papers</b><span>If {k.old_carrier} wants a signed form or a letter.</span><DocsBlock bare who={k.name} carrier={k.old_carrier} kinds={['cancellation_request']} /></div></li>
        </ol>
      </Block>
      <Block title="Client">
        <dl className="fx-facts">{[['Phone', k.client.client_phone], ['New policy', k.client.policy_number], ['Premium', `$${k.client.monthly_premium.toFixed(2)} a month`], ['Agent', k.agent]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
      </Block>
      <Block title="Notes" sub="The agent sees these">
        <textarea className="tp-input fx-ta" aria-label="Notes" rows={3} placeholder="What happened on the call" value={notes} onChange={e => setNotes(e.target.value)} />
        {notes !== k.notes && <button type="button" className="tp-primary sm fx-accent fx-self" onClick={() => { saveCallNotes(k.id, notes); note('Notes saved') }}>Save notes</button>}
      </Block>

      <Drawer open={panel === 'cancelled'} center onClose={() => setPanel(null)} title="Old policy cancelled" sub={`${k.name} · ${k.old_carrier}`}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { markCall(k.id, 'cancelled', { notes: [notes, endNote.trim()].filter(Boolean).join('\n') }); note(`Old policy cancelled for ${first}`); setPanel(null) }}><CircleCheck size={16} />Save</button>}>
        <Field label="Note" hint={`Optional. ${k.agent.split(' ')[0]} sees it`}><textarea className="tp-input fx-ta" rows={3} value={endNote} placeholder="Anything worth knowing about the call" onChange={e => setEndNote(e.target.value)} /></Field>
      </Drawer>
      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={`${k.name} · the client's time`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!mPick} onClick={() => {
          const mine = mPick.va.id === book.me
          moveCall(k.id, mPick.iso, mPick.va.id)
          note(`Moved to ${dayName(mDay)}, ${dateText(mDay)}, ${mTime} ${zoneAbbr(zone.tz, mPick.iso)}, their time. ${first} gets a text with the new time${mine ? '' : `. ${mPick.va.name} has it now`}`)
          setPanel(null)
        }}><CalendarClock size={16} />Move it</button>}>
        <SlotPick days={BOOK_DAYS} day={mDay} onDay={setMDay} slots={slots} value={mTime} onPick={setMTime} zone={zone} place={`${k.client.city}, ${k.client.state}`}
          viewerTz={book.viewerTz} mine={book.me} notBefore={NOW_ISO} showVa label="New time" hint={hoursLine(k.old_carrier)} />
      </Drawer>
      <Drawer open={panel === 'pass'} center onClose={() => setPanel(null)} title="Pass this call on?" sub={k.name}
        footer={<><button type="button" className="tp-primary fx-accent" disabled={!taker} onClick={() => { markCall(k.id, 'passed', { passed_to: taker.id }); note(`Passed on to ${taker.name}`); setPanel(null) }}><Forward size={16} />Pass it on</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel(null)}>Keep it</button></>}>
        {taker
          ? <p className="tp-mid">{taker.name} takes it: on shift and free at {k.when}. Use this when you can't make the time.</p>
          : <p className="tp-mid">Nobody else on shift is free at {k.when}: each has a call within 30 minutes. Move it to another time instead.</p>}
      </Drawer>
    </RecordDrawer>
  )
}




export default function Calendar() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: items } = useFulSchedule()
  const clock = useFulClock()
  const real = useFulSource() === 'real'
  const { today: TODAY, weeks: WEEKS, dayName, dateText, dayNum } = clock
  const ALL_DAYS = WEEKS.flat()
  // The red now-line: the sample clock (1:32 PM), or the real minute on the viewer's clock.
  const NOW = real ? new Date(clock.nowIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: clock.tz }) : SAMPLE_NOW
  const [weekPick, setWeek] = useState(0)
  const [show, setShow] = useState('all')
  const { day, open, close, search } = useOpenDay(ALL_DAYS, { esc: !id, isoOf: clock.isoOf })
  const { view, leaving } = useStickyDay(day)
  // An open day (from a link) shows its own week.
  const week = view != null ? (WEEKS[1].includes(view) ? 1 : 0) : weekPick
  const shown = items.filter(i => show === 'all' || filterOf(i) === show)
  const ofDay = d => shown.filter(i => i.day === d)
  const days = WEEKS[week]
  const cols = view != null ? [view] : days
  const pickWeek = w => { setWeek(w); if (day != null) close() }
  const to = ref => ({ pathname: fp('calendar', ref), search })
  const closeDrawer = () => navigate({ pathname: fp('calendar'), search })
  // A booking that was moved to another VA, or handled, still opens its drawer (it says so); the id says which kind.
  const kind = (items.find(i => i.ref === id) || {}).kind || (id ? (id.startsWith('cl-') ? 'call' : 'task') : null)
  const headKey = d => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d) } }

  const Ev = ({ e, lane: [k, of] }) => {
    const top = Math.max(0, Math.min(100, ((minutesOf(e.time) - START * 60) / (ROWS * 60)) * 100))
    return (
      <Link to={to(e.ref)} className={`tp-ev is-${e.tone}`} aria-label={`${e.when}, ${e.name}, ${typeWord(e)}, ${stateWord(e)}`} title={`${typeWord(e)} · ${e.name}`}
        style={{ top: `${top}%`, height: `calc(${(SLOT / (ROWS * 60)) * 100}% - 2px)`, left: `calc(${(k / of) * 100}% + 3px)`, width: `calc(${100 / of}% - 6px)` }}>
        <b>{e.when}</b><span>{e.name}</span>
      </Link>
    )
  }
  // P918: All plus one chip per call type, counted over the week on show.
  const inWeek = items.filter(i => days.includes(i.day))
  const chips = [{ key: 'all', label: 'All', count: inWeek.length }, ...FILTERS.map(([key, label]) => ({ key, label, count: inWeek.filter(i => filterOf(i) === key).length }))]
  const list = view != null ? ofDay(view) : []
  const rest = view != null ? shown.filter(i => i.day > view && days.includes(i.day)).slice(0, 4) : []

  return (
    <div className="tp-page fx-page fs-sched fs-cal">
      <div className="fx-tools fs-cal-tools">
        <Seg label="Week" value={week} onChange={pickWeek} options={WEEK_LABEL.map((label, key) => ({ key, label }))} />
        <PillTabs label="Call type" className="fx-filters fs-cal-chips" itemClass="fx-filter" value={show} onChange={setShow} items={chips} />
        <HelpDot lesson="calendar" />
      </div>

      <WeekList days={days} today={TODAY} onOpen={open} name={dayName} num={dayNum} itemsOf={ofDay} line={e => `${e.time} ${e.name}`} />

      <div className="fx-grid" data-fold data-fold-fit="360">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week`} style={{ '--i': 0, '--days': cols.length, '--rows': ROWS }} aria-label={view != null ? `${dayName(view)}, ${dateText(view)}` : WEEK_LABEL[week]}>
          <div className="tp-tgrid-h"><span />{cols.map(d => (
            <b key={d} role="button" tabIndex={0} aria-pressed={d === view} title={d === view ? 'Back to the week' : `Open ${dayName(d)} ${dayNum(d)}`} className={`${d === TODAY ? 'today' : ''}${d === view ? ' is-on' : ''}`} onClick={() => open(d)} onKeyDown={headKey(d)}>
              {dayName(d)} <span>{dayNum(d)}</span>{d === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {cols.map(d => {
              const dayItems = ofDay(d)
              const lanes = lanesOf(dayItems)
              return (
                <div key={d} className={`tp-tcol${d === TODAY ? ' today' : ''}`} data-day={d} onClick={e => { if (view == null && e.target === e.currentTarget) open(d) }}>
                  {dayItems.map(e => <Ev key={e.ref} e={e} lane={lanes.get(e.ref)} />)}
                  {d === TODAY && <i className="tp-now" style={{ top: `${((minutesOf(NOW) - START * 60) / (ROWS * 60)) * 100}%` }} aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </section>

        {view != null && (
          <DayBox title={`${dayName(view)}, ${dateText(view)}`} sub={list.length ? `${list.length} booked` : 'Nothing booked'} leaving={leaving} onClose={close}>
            <b className="tp-num fx-huge2"><CountUp value={list.length} /><small> {list.length === 1 ? 'item' : 'items'}</small></b>
            <ul className="fx-rows">
              {list.map(e => { const Icon = TYPE_ICON[filterOf(e)] || Phone; return (
                <li key={e.ref}><Link to={to(e.ref)} className={`fx-row is-${e.tone}`}><span className="fx-row-ic"><Icon size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.name}</b><small>{e.when} · {typeWord(e)} · {stateWord(e)}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>
              ) })}
            </ul>
            {list.length === 0 && <Empty title="A free day" sub={show === 'all' ? 'Nothing is booked for this day.' : 'Try All.'} />}
            {rest.length > 0 && <>
              <h3 className="fx-h3">Rest of the week</h3>
              <ul className="fx-rows">
                {rest.map(e => <li key={e.ref}><Link to={to(e.ref)} className={`fx-row is-${e.tone}`}><span className="tp-grow"><b>{e.name}</b><small>{dayName(e.day)} {e.when} · {typeWord(e)}</small></span></Link></li>)}
              </ul>
            </>}
          </DayBox>
        )}
      </div>

      {id && kind === 'call' && <CallDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && kind && kind !== 'call' && <TaskDrawer key={id} id={id} onClose={closeDrawer} />}

      {id && !kind && <RecordDrawer label="Not on your calendar" kicker="Calendar" onClose={closeDrawer} hero={<h2>Not on your calendar</h2>}><p className="fx-calm">That item is not here any more.</p></RecordDrawer>}
    </div>
  )
}
