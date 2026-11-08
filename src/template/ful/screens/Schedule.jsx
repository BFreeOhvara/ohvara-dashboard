import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Phone, MessageSquare, CalendarClock, MapPin, CircleCheck, PhoneMissed, Forward, ArrowRight, Users, Clock, ChevronRight, CalendarOff, Undo2, CalendarCheck } from 'lucide-react'
import { useFulCalls, useFulActions, useFulSchedule, useFulBooked, useFulShift, useVaBooking, useFulAgents, useFulClock, useFulSource, minutesOf } from '../data'
import { FirstRun } from '../../DataState'
import { Avatar, Chip, Drawer, Empty, Field, Seg, useNote } from '../../kit'
import { DayBox, WeekStrip, WeekList } from '../../DayBox'
import { SlotPick } from '../../SlotPick'
import { useOpenDay, useStickyDay } from '../../useOpenDay'
import { useClientZone } from '../../useClientZone'
import { sampleSlots, hoursLine } from '../../carriers'
import { vaSlots, freeVa, clockOf, zoneAbbr } from '../../../lib/callSlots'
import { RecordDrawer, Block } from '../../Record'
import { CountUp } from '../../motion'
import { LeadDrawer } from './Queue'
import { DayOffDrawer } from '../Shift'
import { useDayOffActions } from '../../../hooks/useVaShiftsShell'
import { companyDay, dateLabel, rangeText } from '../../../lib/vaShifts'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { SwapsHolidays } from '../Clock879'
import { DocsBlock, GateStep } from '../Docs886'
import { useGate } from '../../docs886/data'

// P846 — Schedule (it was Calls): the VA's week as the same calendar the agent has, with everything they have to do
// at a time on it: cancellation calls, booked callbacks (people from the Queue) and the appointments they booked for
// agents. Colours come from the palette (call status, Callback, Booked for an agent). Any item opens its drawer at
// its own address (/fulfillment/schedule/<id>): a call keeps everything the Calls page had (client facts, the
// checklist, result buttons, notes, Move, Pass on); a callback opens the Queue's person drawer; a booking opens its
// details. Under the calendar, the week's rota (who is on which day) and the Request a day off action. Sample only.
// P854: no Week/Day toggle. The week is full width; click a day (its header, a strip chip, or empty space in its
// column) and the page switches to that day with its box sliding in from the right (shared with the agent Calendar:
// ../../DayBox, ?day= in the URL). Blocks sit by their instant on the VA's clock, the client's time beside it when it
// differs. Move and Pass on obey the 30-minute rule (lib/callSlots): a taken time is greyed out.

const START = 8 // the grid runs 8:00 AM to 6:00 PM, the carriers' hours
const ROWS = 10
const SLOT = 30 // minutes an event block covers (a block is time over name), so close times sit side by side
const HOURS = Array.from({ length: ROWS }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const SAMPLE_NOW = '1:32 PM' // sample clock: the next call is 28 minutes after it
const WEEK_LABEL = ['This week', 'Next week']
const KIND_ICON = { call: Phone, callback: Clock, booked: CalendarCheck }

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

// A cancellation call (what the Calls page's drawer was, with every part kept). Start call opens the live-call overlay.
export function CallDrawer({ id, onClose }) {
  const { data: calls } = useFulCalls()
  const { markCall, saveCallNotes, moveCall, showLive } = useFulActions()
  const note = useNote()
  const k = calls.find(x => x.id === id) || calls[0]
  const [panel, setPanel] = useState(null)
  const [conf, setConf] = useState('')
  const [notes, setNotes] = useState(k.notes)
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
    <RecordDrawer label={`Call with ${k.name}`} kicker={<>Cancellation call · {dayName(k.day)}, {dateText(k.day)} <HelpDot lesson="schedule" inline /></>} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{k.day === TODAY ? 'Today' : `${dayName(k.day)}, ${dateText(k.day)}`} · {k.when}</span><Chip tone={tone}>{CALL_WORD[k.status]}</Chip></div>
        <h2>{k.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{k.client.city}, {k.client.state} · {k.agent}'s client</p>
        <div className="fx-hero-bot"><span className="fs-swap is-hero"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={16} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></span><Avatar name={k.name} tone={tone} /></div>
      </>}
      actions={open ? <>
        <button type="button" className="tp-primary fx-accent" disabled={!gate.open} title={gate.open ? undefined : 'Waits for the new policy to be issued'} onClick={() => showLive(k.id)}><Phone size={16} />Start call</button>
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
      {k.status === 'cancelled' && (
        <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />Old policy cancelled</h3></header><p className="tp-mid">Confirmation {k.confirmation}.</p></section>
      )}
      {/* P888: the replacement gate and the cancellation papers are steps on this call, not boxes of their own. */}
      <Block title="On this call">
        <ol className="fs-steps">
          {k.status !== 'cancelled' && <GateStep who={k.name} />}
          {[['Confirm it is them', 'Name, date of birth, last four of the old policy'], [`Call ${k.old_carrier} together`, gate.cancel_by ? `Cancel before the ${gate.old_draft} draft so they never pay twice` : 'Ask to cancel the old policy, end date today'], ['Get the confirmation number', 'Type it in when you mark Cancelled'], ['Questions about coverage', `Those go to ${k.agent}, not on this call`]].map(([a, b], i) => <li key={a} className={k.status === 'cancelled' ? 'done' : i === 0 && open && gate.open ? 'now' : ''}><i /><div><b>{a}</b><span>{b}</span></div></li>)}
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
        footer={<button type="button" className="tp-primary fx-accent" disabled={conf.trim().length < 4} onClick={() => { markCall(k.id, 'cancelled', { confirmation: conf.trim().toUpperCase(), notes }); note('Cancelled. Saved with the confirmation number'); setPanel(null) }}><CircleCheck size={16} />Save</button>}>
        <Field label="Confirmation number" hint="From the carrier, on the call"><input value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>
      </Drawer>
      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={`${k.name} · the client's time`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!mPick} onClick={() => {
          const mine = mPick.va.id === book.me
          moveCall(k.id, mPick.iso, mPick.va.id)
          note(`Moved to ${dayName(mDay)}, ${dateText(mDay)}, ${mTime} ${zoneAbbr(zone.tz, mPick.iso)}, the client's time${mine ? '' : `. ${mPick.va.name} has it`}`)
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

// An appointment the VA booked for an agent: it is on the agent's calendar; here are its details.
function BookedDrawer({ id, onClose }) {
  const { data: booked } = useFulBooked()
  const { data: agents } = useFulAgents()
  const { today: TODAY, dayName, dateText } = useFulClock()
  const note = useNote()
  const b = booked.find(x => x.id === id)
  if (!b) return <RecordDrawer label="Not on your schedule" kicker="Schedule" onClose={onClose} hero={<h2>Already handled</h2>}><p className="fx-calm">This one is not on your schedule any more.</p></RecordDrawer>
  const first = b.agent.split(' ')[0]
  const ag = agents.find(a => a.id === b.agent_id)
  const theirs = ag && b.iso ? `${clockOf(b.iso, ag.tz)} ${zoneAbbr(ag.tz, b.iso)}` : b.time
  const client = b.iso && b.tz ? `${clockOf(b.iso, b.tz)} ${zoneAbbr(b.tz, b.iso)}` : ''
  return (
    <RecordDrawer label={`Appointment for ${b.agent} with ${b.name}`} kicker={`Booked for ${first}`} tone="teal" onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{b.day === TODAY ? 'Today' : `${dayName(b.day)}, ${dateText(b.day)}`} · {b.when}</span><Chip tone="teal">Booked for {first}</Chip></div>
        <h2>{b.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{b.city}, {b.state} · {b.type}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{b.phone}</b><Avatar name={b.name} tone="teal" /></div>
      </>}
      actions={<>
        <Link to={fp('messages')} className="tp-primary fx-accent"><MessageSquare size={15} />Message {first}</Link>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => { note(`Asked the team to move ${b.name}'s appointment`); onClose() }}><CalendarClock size={15} />Ask to move</button>
      </>}>
      <Block title="Appointment" sub="You booked this">
        <dl className="fx-facts">{[['Agent', b.agent], ['When', `${dayName(b.day)}, ${dateText(b.day)}, ${b.time} your time`], [`${first}'s time`, theirs], ...(client ? [["Client's time", `${client} (${b.city}, ${b.state})`]] : []), ['About', b.type], ['Phone', b.phone]].map(([a, v]) => <div key={a}><dt>{a}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      <Block title="What happens next">
        <p className="tp-mid">It is on {first}'s calendar inside their hours. {first} calls {b.name.split(' ')[0]} at that time. If the client asks to change it, the team moves it and tells you.</p>
      </Block>
    </RecordDrawer>
  )
}

// The week's rota: who is on which day (two or three VAs a day), mine marked, with the day-off requests.
// P851 Phase 2: the real rota once 231 is applied (live), the sample until then.
function Rota({ week, onAsk }) {
  const { data: s } = useFulShift()
  const { cancel } = useDayOffActions()
  const note = useNote()
  if (s.notSet) return <FirstRun icon={CalendarOff} title="Your rota isn't set up yet" sub="Who is on shift each day shows here once the team's rota is built. Your calls and callbacks above are real." />
  const days = s.days[week] || []
  const people = [s.me, ...Array.from(new Map(days.flatMap(d => d.vas).filter(v => !v.me).map(v => [v.id, v])).values())]
  const mine = s.dayOffs.filter(o => days.some(d => d.date === o.date))
  const label = s.live && days.length ? `${WEEK_LABEL[week]}, ${rangeText(days[0].date, days.at(-1).date)}` : WEEK_LABEL[week]
  const todayIso = s.live ? companyDay() : s.days.flat().find(d => d.today)?.date || ''
  const takeBack = o => cancel(o).then(() => note(`Took back your day off on ${dateLabel(o.date)}`), e => note(e?.message || 'That did not save. Try again.'))
  return (
    <section className="fx-tile fs-rota" style={{ '--i': 2 }} aria-label="Who is on shift">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Who's on shift</h2><p>{label} · two or three VAs a day · {s.shift.text}</p></span>
        <button type="button" className="tp-btn ov-ghost" onClick={onAsk}><CalendarOff size={15} />Request a day off</button>
      </header>
      <div className="fs-rota-sc">
        <table className="fs-rota-t">
          <caption className="tp-sr">The shift rota for {label.toLowerCase()}</caption>
          <thead><tr><th scope="col"><span className="tp-sr">VA</span></th>{days.map(d => <th key={d.day} scope="col" className={d.today ? 'is-today' : ''}>{d.name} <b>{d.day}</b></th>)}</tr></thead>
          <tbody>
            {people.map(v => (
              <tr key={v.id} className={v.me ? 'is-me' : ''}>
                <th scope="row"><Avatar name={v.name} /><span>{v.me ? 'You' : v.name}</span></th>
                {days.map(d => {
                  const on = d.vas.find(x => x.id === v.id)
                  return <td key={d.day} className={d.today ? 'is-today' : ''}>{on ? <span className={`fs-pill${on.off ? ' is-off' : ''}`}>{on.off ? (on.offStatus === 'approved' ? 'Off' : 'Off asked') : 'On'}</span> : <span className="fs-none" aria-label="Not on">·</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine.length > 0 && (
        <ul className="fs-offs" aria-label="Your day-off requests">
          {mine.map(o => (
            <li key={o.id}><CalendarOff size={14} aria-hidden="true" /><span className="tp-grow">{o.status === 'approved' ? 'You have' : 'You asked'} {dateLabel(o.date)} off{o.why ? ` · ${o.why}` : ''}. {o.status === 'declined' ? 'The team said no, so you are on.' : o.status === 'approved' ? 'Approved.' : 'The team knows.'}</span>
              {o.date > todayIso && <button type="button" className="fx-pillbtn" onClick={() => takeBack(o)}><Undo2 size={13} />Take it back</button>}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

const TO_DO = i => !i.done

export default function Schedule() {
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
  const [ask, setAsk] = useState(false)
  const { day, open, close, search } = useOpenDay(ALL_DAYS, { esc: !id && !ask, isoOf: clock.isoOf })
  const { view, leaving } = useStickyDay(day)
  // An open day (from a link) shows its own week.
  const week = view != null ? (WEEKS[1].includes(view) ? 1 : 0) : weekPick
  const shown = items.filter(i => show === 'all' || (show === 'todo' ? TO_DO(i) : !TO_DO(i)))
  const ofDay = d => shown.filter(i => i.day === d)
  const days = WEEKS[week]
  const cols = view != null ? [view] : days
  const pickWeek = w => { setWeek(w); if (day != null) close() }
  const to = ref => ({ pathname: fp('schedule', ref), search })
  const closeDrawer = () => navigate({ pathname: fp('schedule'), search })
  // A callback that was handled, or a booking that is gone, still opens its drawer (it says so); the id says which kind.
  const kind = (items.find(i => i.ref === id) || {}).kind || (id?.startsWith('cl-') ? 'call' : id?.startsWith('vq-') ? 'callback' : id?.startsWith('ap-') ? 'booked' : null)
  const headKey = d => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d) } }

  const Ev = ({ e, lane: [k, of] }) => {
    const top = Math.max(0, Math.min(100, ((minutesOf(e.time) - START * 60) / (ROWS * 60)) * 100))
    return (
      <Link to={to(e.ref)} className={`tp-ev is-${e.tone}`} aria-label={`${e.when}, ${e.name}, ${e.word}`}
        style={{ top: `${top}%`, height: `calc(${(SLOT / (ROWS * 60)) * 100}% - 2px)`, left: `calc(${(k / of) * 100}% + 3px)`, width: `calc(${100 / of}% - 6px)` }}>
        <b>{e.when}</b><span>{e.name}</span>
      </Link>
    )
  }
  const counts = { all: items.length, todo: items.filter(TO_DO).length, done: items.filter(i => !TO_DO(i)).length }
  const list = view != null ? ofDay(view) : []
  const rest = view != null ? shown.filter(i => i.day > view && days.includes(i.day)).slice(0, 4) : []

  return (
    <div className="tp-page fx-page fs-sched">
      <div className="fx-tools">
        <Seg label="Week" value={week} onChange={pickWeek} options={WEEK_LABEL.map((label, key) => ({ key, label }))} />
        <WeekStrip days={days} day={view} today={TODAY} onOpen={open} has={d => ofDay(d).length > 0} name={dayName} num={dayNum} />
        <span className="tp-grow" />
        <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'all', label: 'All', count: counts.all }, { key: 'todo', label: 'To do', count: counts.todo }, { key: 'done', label: 'Done', count: counts.done }]} />
        <HelpDot lesson="schedule" />
      </div>
      <ul className="fs-legend" aria-label="Colours">
        {Object.entries(CALL_WORD).map(([s, w]) => <li key={s} className={`is-${CALL_TONE[s]}`}><i aria-hidden="true" />{w}</li>)}
        <li className="is-warn"><i aria-hidden="true" />Callback</li>
        <li className="is-teal"><i aria-hidden="true" />Booked for an agent</li>
      </ul>

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
          <DayBox title={`${dayName(view)}, ${dateText(view)}`} sub={list.length ? `${list.length} on your schedule` : 'Nothing scheduled'} leaving={leaving} onClose={close}>
            <b className="tp-num fx-huge2"><CountUp value={list.length} /><small> {list.length === 1 ? 'item' : 'items'}</small></b>
            <ul className="fx-rows">
              {list.map(e => { const Icon = KIND_ICON[e.kind]; return (
                <li key={e.ref}><Link to={to(e.ref)} className={`fx-row is-${e.tone}`}><span className="fx-row-ic"><Icon size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.name}</b><small>{e.when} · {e.word} · {e.sub}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>
              ) })}
            </ul>
            {list.length === 0 && <Empty title="A free day" sub={show === 'all' ? 'Nothing is booked for this day.' : 'Try All.'} />}
            {rest.length > 0 && <>
              <h3 className="fx-h3">Rest of the week</h3>
              <ul className="fx-rows">
                {rest.map(e => <li key={e.ref}><Link to={to(e.ref)} className={`fx-row is-${e.tone}`}><span className="tp-grow"><b>{e.name}</b><small>{dayName(e.day)} {e.when} · {e.word}</small></span></Link></li>)}
              </ul>
            </>}
          </DayBox>
        )}
      </div>

      <Rota week={week} onAsk={() => setAsk(true)} />
      {!real && <SwapsHolidays />}
      <DayOffDrawer open={ask} onClose={() => setAsk(false)} />

      {id && kind === 'call' && <CallDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && kind === 'callback' && <LeadDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && kind === 'booked' && <BookedDrawer key={id} id={id} onClose={closeDrawer} />}
      {id && !kind && <RecordDrawer label="Not on your schedule" kicker="Schedule" onClose={closeDrawer} hero={<h2>Not on your schedule</h2>}><p className="fx-calm">That item is not here any more.</p></RecordDrawer>}
    </div>
  )
}
