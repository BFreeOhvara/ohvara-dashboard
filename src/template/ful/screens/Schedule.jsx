import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Phone, MessageSquare, CalendarClock, MapPin, CircleCheck, PhoneMissed, Forward, ArrowRight, Users, Clock, ChevronRight, CalendarOff, Undo2, CalendarCheck } from 'lucide-react'
import { useFulCalls, useFulActions, useFulSchedule, useFulBooked, useFulShift, TODAY, WEEKS, dayName, minutesOf } from '../data'
import { Avatar, Chip, Drawer, Empty, Field, PillTabs, Seg, useNote } from '../../kit'
import { RecordDrawer, Block } from '../../Record'
import { CountUp } from '../../motion'
import { LeadDrawer } from './Queue'
import { DayOffDrawer } from '../Shift'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE } from '../words'

// P846 — Schedule (it was Calls): the VA's week as the same calendar the agent has, with everything they have to do
// at a time on it: cancellation calls, booked callbacks (people from the Queue) and the appointments they booked for
// agents. Colours come from the palette (call status, Callback, Booked for an agent). Any item opens its drawer at
// its own address (/fulfillment/schedule/<id>): a call keeps everything the Calls page had (client facts, the
// checklist, result buttons, notes, Move, Pass on); a callback opens the Queue's person drawer; a booking opens its
// details. Under the calendar, the week's rota (who is on which day) and the Request a day off action. Sample only.

const START = 8 // the grid runs 8:00 AM to 6:00 PM, the carriers' hours
const ROWS = 10
const SLOT = 30 // minutes an event block covers (a block is time over name), so close times sit side by side
const HOURS = Array.from({ length: ROWS }, (_, i) => START + i)
const label12 = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const NOW = '1:32 PM' // sample clock: the next call is 28 minutes after it
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

const MOVE_TIMES = [[6, '11:00 AM'], [6, '3:30 PM'], [9, '10:00 AM'], [9, '1:30 PM']]

// A cancellation call (what the Calls page's drawer was, with every part kept). Start call opens the live-call overlay.
export function CallDrawer({ id, onClose }) {
  const { data: calls } = useFulCalls()
  const { markCall, saveCallNotes, moveCall, showLive } = useFulActions()
  const note = useNote()
  const k = calls.find(x => x.id === id) || calls[0]
  const [panel, setPanel] = useState(null)
  const [conf, setConf] = useState('')
  const [notes, setNotes] = useState(k.notes)
  const [move, setMove] = useState(0)
  const tone = CALL_TONE[k.status]
  const first = k.name.split(' ')[0]
  const open = k.status === 'booked' || k.status === 'no_answer'
  return (
    <RecordDrawer label={`Call with ${k.name}`} kicker={`Cancellation call · ${dayName(k.day)}, Nov ${k.day}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{k.day === TODAY ? 'Today' : `${dayName(k.day)}, Nov ${k.day}`} · {k.time}</span><Chip tone={tone}>{CALL_WORD[k.status]}</Chip></div>
        <h2>{k.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{k.client.city}, {k.client.state} · {k.agent}'s client</p>
        <div className="fx-hero-bot"><span className="fs-swap is-hero"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={16} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></span><Avatar name={k.name} tone={tone} /></div>
      </>}
      actions={open ? <>
        <button type="button" className="tp-primary fx-accent" onClick={() => showLive(k.id)}><Phone size={16} />Start call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('cancelled')}><CircleCheck size={15} />Cancelled</button>
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
        <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />Old policy cancelled</h3></header><p className="tp-mid">Confirmation {k.confirmation}. It counts toward this week's pay once it is checked.</p></section>
      )}
      <Block title="On this call">
        <ol className="tp-tl fx-tl">
          {[['Confirm it is them', 'Name, date of birth, last four of the old policy'], [`Call ${k.old_carrier} together`, 'Ask to cancel the old policy, end date today'], ['Get the confirmation number', 'Type it in when you mark Cancelled'], ['Questions about coverage', `Those go to ${k.agent}, not on this call`]].map(([a, b], i) => <li key={a} className={k.status === 'cancelled' ? 'done' : i === 0 && open ? 'now' : ''}><i /><div><b>{a}</b><span>{b}</span></div></li>)}
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
        footer={<button type="button" className="tp-primary fx-accent" disabled={conf.trim().length < 4} onClick={() => { markCall(k.id, 'cancelled', { confirmation: conf.trim().toUpperCase(), notes }); note('Cancelled. It shows on Pay as checking'); setPanel(null) }}><CircleCheck size={16} />Save</button>}>
        <Field label="Confirmation number" hint="From the carrier, on the call"><input value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>
      </Drawer>
      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={`${k.name} · their time`}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { const [d, t] = MOVE_TIMES[move]; moveCall(k.id, d, t); note(`Moved to ${dayName(d)}, Nov ${d}, ${t}`); setPanel(null) }}><CalendarClock size={16} />Move it</button>}>
        <PillTabs role="radiogroup" label="New time" className="fx-chips fs-wrap" itemClass="fx-chip" value={move} onChange={setMove} items={MOVE_TIMES.map(([d, t], i) => ({ key: i, label: <><small>{dayName(d)} {d}</small><b>{t}</b></> }))} />
        <p className="tp-sub">Carrier lines are open 8:00 AM to 6:00 PM.</p>
      </Drawer>
      <Drawer open={panel === 'pass'} center onClose={() => setPanel(null)} title="Pass this call on?" sub={k.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { markCall(k.id, 'passed'); note('Passed on to the team'); setPanel(null) }}><Forward size={16} />Pass it on</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel(null)}>Keep it</button></>}>
        <p className="tp-mid">Another VA takes it. Use this when you can't make the time.</p>
      </Drawer>
    </RecordDrawer>
  )
}

// An appointment the VA booked for an agent: it is on the agent's calendar; here are its details.
function BookedDrawer({ id, onClose }) {
  const { data: booked } = useFulBooked()
  const note = useNote()
  const b = booked.find(x => x.id === id)
  if (!b) return <RecordDrawer label="Not on your schedule" kicker="Schedule" onClose={onClose} hero={<h2>Already handled</h2>}><p className="fx-calm">This one is not on your schedule any more.</p></RecordDrawer>
  const first = b.agent.split(' ')[0]
  return (
    <RecordDrawer label={`Appointment for ${b.agent} with ${b.name}`} kicker={`Booked for ${first}`} tone="teal" onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{b.day === TODAY ? 'Today' : `${dayName(b.day)}, Nov ${b.day}`} · {b.time}</span><Chip tone="teal">Booked for {first}</Chip></div>
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
        <dl className="fx-facts">{[['Agent', b.agent], ['When', `${dayName(b.day)}, Nov ${b.day}, ${b.time} (agent's time)`], ['About', b.type], ['Phone', b.phone]].map(([a, v]) => <div key={a}><dt>{a}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      <Block title="What happens next">
        <p className="tp-mid">It is on {first}'s calendar inside their hours. {first} calls {b.name.split(' ')[0]} at that time. If the client asks to change it, the team moves it and tells you.</p>
      </Block>
    </RecordDrawer>
  )
}

// The week's rota: who is on which day (two or three VAs a day), mine marked, with the day-off requests.
function Rota({ week, onAsk }) {
  const { data: s } = useFulShift()
  const { cancelDayOff } = useFulActions()
  const note = useNote()
  const days = s.days[week]
  const people = [s.me, ...Array.from(new Map(days.flatMap(d => d.vas).filter(v => !v.me).map(v => [v.id, v])).values())]
  const mine = s.dayOffs.filter(o => days.some(d => d.day === o.day))
  return (
    <section className="fx-tile fs-rota" style={{ '--i': 2 }} aria-label="Who is on shift">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Who's on shift</h2><p>{WEEK_LABEL[week]} · two or three VAs a day · {s.shift.text}</p></span>
        <button type="button" className="tp-btn ov-ghost" onClick={onAsk}><CalendarOff size={15} />Request a day off</button>
      </header>
      <div className="fs-rota-sc">
        <table className="fs-rota-t">
          <caption className="tp-sr">The shift rota for {WEEK_LABEL[week].toLowerCase()}</caption>
          <thead><tr><th scope="col"><span className="tp-sr">VA</span></th>{days.map(d => <th key={d.day} scope="col" className={d.today ? 'is-today' : ''}>{d.name} <b>{d.day}</b></th>)}</tr></thead>
          <tbody>
            {people.map(v => (
              <tr key={v.id} className={v.me ? 'is-me' : ''}>
                <th scope="row"><Avatar name={v.name} /><span>{v.me ? 'You' : v.name}</span></th>
                {days.map(d => {
                  const on = d.vas.find(x => x.id === v.id)
                  return <td key={d.day} className={d.today ? 'is-today' : ''}>{on ? <span className={`fs-pill${on.off ? ' is-off' : ''}`}>{on.off ? 'Off asked' : 'On'}</span> : <span className="fs-none" aria-label="Not on">·</span>}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine.length > 0 && (
        <ul className="fs-offs" aria-label="Your day-off requests">
          {mine.map(o => (
            <li key={o.id}><CalendarOff size={14} aria-hidden="true" /><span className="tp-grow">You asked off {dayName(o.day)}, Nov {o.day}{o.why ? ` · ${o.why}` : ''}. The team knows.</span>
              <button type="button" className="fx-pillbtn" onClick={() => { cancelDayOff(o.day); note(`Took back your day off on ${dayName(o.day)}, Nov ${o.day}`) }}><Undo2 size={13} />Take it back</button></li>
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
  const [view, setView] = useState('week')
  const [week, setWeek] = useState(0)
  const [day, setDay] = useState(TODAY)
  const [show, setShow] = useState('all')
  const [ask, setAsk] = useState(false)
  const shown = items.filter(i => show === 'all' || (show === 'todo' ? TO_DO(i) : !TO_DO(i)))
  const ofDay = d => shown.filter(i => i.day === d)
  const days = WEEKS[week]
  const cols = view === 'day' ? [day] : days
  const pickWeek = w => { setWeek(w); setDay(w === 0 ? TODAY : WEEKS[1][0]) }
  const close = () => navigate(fp('schedule'))
  // A callback that was handled, or a booking that is gone, still opens its drawer (it says so); the id says which kind.
  const kind = (items.find(i => i.ref === id) || {}).kind || (id?.startsWith('cl-') ? 'call' : id?.startsWith('vq-') ? 'callback' : id?.startsWith('ap-') ? 'booked' : null)

  const Ev = ({ e, lane: [k, of] }) => {
    const top = Math.max(0, Math.min(100, ((minutesOf(e.time) - START * 60) / (ROWS * 60)) * 100))
    return (
      <Link to={fp('schedule', e.ref)} className={`tp-ev is-${e.tone}`} aria-label={`${e.time}, ${e.name}, ${e.word}`}
        style={{ top: `${top}%`, height: `calc(${(SLOT / (ROWS * 60)) * 100}% - 2px)`, left: `calc(${(k / of) * 100}% + 3px)`, width: `calc(${100 / of}% - 6px)` }}>
        <b>{e.time}</b><span>{e.name}</span>
      </Link>
    )
  }
  const counts = { all: items.length, todo: items.filter(TO_DO).length, done: items.filter(i => !TO_DO(i)).length }
  const rest = shown.filter(i => i.day > day && days.includes(i.day)).slice(0, 4)

  return (
    <div className="tp-page fx-page fs-sched">
      <div className="fx-tools">
        <Seg label="View" value={view} onChange={setView} options={[{ key: 'week', label: 'Week' }, { key: 'day', label: 'Day' }]} />
        <Seg label="Week" value={week} onChange={pickWeek} options={WEEK_LABEL.map((label, key) => ({ key, label }))} />
        <PillTabs label="Day" className="fx-chips" itemClass="fx-chip" value={day} onChange={setDay}
          items={days.map(d => ({ key: d, label: <><small>{dayName(d)}</small><b>{d}</b></>, extra: d === TODAY ? <i className="fs-today" aria-label="today" /> : day !== d && ofDay(d).length > 0 ? <i aria-hidden="true" /> : null }))} />
        <span className="tp-grow" />
        <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'all', label: 'All', count: counts.all }, { key: 'todo', label: 'To do', count: counts.todo }, { key: 'done', label: 'Done', count: counts.done }]} />
      </div>
      <ul className="fs-legend" aria-label="Colours">
        {Object.entries(CALL_WORD).map(([s, w]) => <li key={s} className={`is-${CALL_TONE[s]}`}><i aria-hidden="true" />{w}</li>)}
        <li className="is-warn"><i aria-hidden="true" />Callback</li>
        <li className="is-teal"><i aria-hidden="true" />Booked for an agent</li>
      </ul>

      <div className="fx-grid">
        <section className="fx-tile fx-s8 fx-week" style={{ '--i': 0, '--days': cols.length, '--rows': ROWS }} aria-label={week === 0 ? 'This week' : 'Next week'}>
          <div className="tp-tgrid-h"><span />{cols.map(d => <b key={d} className={d === TODAY ? 'today' : ''}>{dayName(d)} <span>{d}</span>{d === TODAY && <small>Today</small>}</b>)}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS.map(h => <span key={h}>{label12(h)}</span>)}</div>
            {cols.map(d => {
              const list = ofDay(d)
              const lanes = lanesOf(list)
              return (
                <div key={d} className={`tp-tcol${d === TODAY ? ' today' : ''}`}>
                  {list.map(e => <Ev key={e.ref} e={e} lane={lanes.get(e.ref)} />)}
                  {d === TODAY && <i className="tp-now" style={{ top: `${((minutesOf(NOW) - START * 60) / (ROWS * 60)) * 100}%` }} aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </section>

        <aside className="fx-tile fx-s4 fx-agenda" style={{ '--i': 1 }} aria-label="Agenda">
          <header className="fx-tile-h"><span className="tp-grow"><h2>{dayName(day)}, Nov {day}</h2><p>{ofDay(day).length ? `${ofDay(day).length} on your schedule` : 'Nothing scheduled'}</p></span></header>
          <b className="tp-num fx-huge2"><CountUp value={ofDay(day).length} /><small> {ofDay(day).length === 1 ? 'item' : 'items'}</small></b>
          <ul className="fx-rows">
            {ofDay(day).map(e => { const Icon = KIND_ICON[e.kind]; return (
              <li key={e.ref}><Link to={fp('schedule', e.ref)} className={`fx-row is-${e.tone}`}><span className="fx-row-ic"><Icon size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.name}</b><small>{e.time} · {e.word} · {e.sub}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>
            ) })}
          </ul>
          {ofDay(day).length === 0 && <Empty title="A free day" sub={show === 'all' ? 'Nothing is booked for this day.' : 'Try All.'} />}
          {rest.length > 0 && <>
            <h3 className="fx-h3">Rest of the week</h3>
            <ul className="fx-rows">
              {rest.map(e => <li key={e.ref}><Link to={fp('schedule', e.ref)} className={`fx-row is-${e.tone}`}><span className="tp-grow"><b>{e.name}</b><small>{dayName(e.day)} {e.time} · {e.word}</small></span></Link></li>)}
            </ul>
          </>}
        </aside>
      </div>

      <Rota week={week} onAsk={() => setAsk(true)} />
      <DayOffDrawer open={ask} onClose={() => setAsk(false)} />

      {id && kind === 'call' && <CallDrawer key={id} id={id} onClose={close} />}
      {id && kind === 'callback' && <LeadDrawer key={id} id={id} onClose={close} />}
      {id && kind === 'booked' && <BookedDrawer key={id} id={id} onClose={close} />}
      {id && !kind && <RecordDrawer label="Not on your schedule" kicker="Schedule" onClose={close} hero={<h2>Not on your schedule</h2>}><p className="fx-calm">That item is not here any more.</p></RecordDrawer>}
    </div>
  )
}
