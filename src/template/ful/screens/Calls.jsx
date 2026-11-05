import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Phone, PhoneOff, MessageSquare, CalendarClock, MapPin, CircleCheck, PhoneMissed, Forward, ArrowRight, Users } from 'lucide-react'
import { useFulCalls, useFulActions, TODAY, dayName } from '../data'
import { Avatar, Chip, Drawer, Empty, Field, PillTabs, Seg, useNote } from '../../kit'
import { RecordDrawer, Block } from '../../Record'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE } from '../words'

// P845 — Calls: the VA's cancellation calls (closing a client's old policy with the old carrier once the new one is
// in force). A day picker (the same stretch tabs), the day's calls as cards filled with their status colour, and a
// call opens in a drawer at its own URL with the result buttons. Calling from the portal stays off (voice_live):
// Start call says so and shows the numbers to dial. Sample only.
const DAYS = [2, 3, 4, 5, 6]

function CallCard({ k, i }) {
  const tone = CALL_TONE[k.status]
  return (
    <article className={`fx-card fx-ccard fs-callcard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('calls', k.id)} className="fx-cover" aria-label={`Open the call with ${k.name}`} />
      <div className="fx-ccard-top"><b className="fs-time tp-num">{k.time}</b><span className="fx-tag">{CALL_WORD[k.status]}</span></div>
      <h3>{k.name}</h3>
      <p>{k.agent}'s client · {k.client.city}, {k.client.state}</p>
      <div className="fs-swap"><span><small>Closing</small><b>{k.old_carrier}</b></span><ArrowRight size={14} aria-hidden="true" /><span><small>Keeping</small><b>{k.carrier}</b></span></div>
      <div className="fx-ccard-bot">
        <span>{k.status === 'cancelled' ? `Confirmation ${k.confirmation}` : k.notes || 'Nothing noted yet'}</span>
        <span className="tp-grow" />
        <Avatar name={k.name} tone={tone} />
      </div>
    </article>
  )
}

const MOVE_TIMES = [[6, '11:00 AM'], [6, '3:30 PM'], [9, '10:00 AM'], [9, '1:30 PM']]

function CallDrawer({ id, onClose }) {
  const { data: calls } = useFulCalls()
  const { markCall, saveCallNotes, moveCall } = useFulActions()
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
        <button type="button" className="tp-primary fx-accent" onClick={() => setPanel('call')}><Phone size={16} />Start call</button>
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

      <Drawer open={panel === 'call'} center onClose={() => setPanel(null)} title="Call screen" sub={`${k.name} and ${k.old_carrier}`}>
        <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" />Calling from the portal is switched off for now. Dial from your phone, then mark the result here.</p>
        <dl className="fx-facts">{[[`${first}'s phone`, k.client.client_phone], [`${k.old_carrier} service line`, '(800) 555-0110']].map(([a, b]) => <div key={a}><dt>{a}</dt><dd className="tp-num">{b}</dd></div>)}</dl>
      </Drawer>
      <Drawer open={panel === 'cancelled'} center onClose={() => setPanel(null)} title="Old policy cancelled" sub={`${k.name} · ${k.old_carrier}`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={conf.trim().length < 4} onClick={() => { markCall(k.id, 'cancelled', { confirmation: conf.trim().toUpperCase(), notes }); note('Cancelled. It shows on Pay as checking'); setPanel(null) }}><CircleCheck size={16} />Save</button>}>
        <Field label="Confirmation number" hint="From the carrier, on the call"><input value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>
      </Drawer>
      <Drawer open={panel === 'move'} center onClose={() => setPanel(null)} title="Move this call" sub={`${k.name} · their time`}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { const [d, t] = MOVE_TIMES[move]; moveCall(k.id, d, t); note(`Moved to ${dayName(d) || 'Mon'}, Nov ${d}, ${t}`); setPanel(null) }}><CalendarClock size={16} />Move it</button>}>
        <PillTabs role="radiogroup" label="New time" className="fx-chips fs-wrap" itemClass="fx-chip" value={move} onChange={setMove} items={MOVE_TIMES.map(([d, t], i) => ({ key: i, label: <><small>{dayName(d) || 'Mon'} {d}</small><b>{t}</b></> }))} />
        <p className="tp-sub">Carrier lines are open 8:00 AM to 6:00 PM.</p>
      </Drawer>
      <Drawer open={panel === 'pass'} center onClose={() => setPanel(null)} title="Pass this call on?" sub={k.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { markCall(k.id, 'passed'); note('Passed on to the team'); setPanel(null) }}><Forward size={16} />Pass it on</button><button type="button" className="tp-btn ov-ghost" onClick={() => setPanel(null)}>Keep it</button></>}>
        <p className="tp-mid">Another VA takes it. Use this when you can't make the time.</p>
      </Drawer>
    </RecordDrawer>
  )
}

export default function Calls() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: calls } = useFulCalls()
  const [day, setDay] = useState(TODAY)
  const [show, setShow] = useState('all')
  const ofDay = calls.filter(k => k.day === day)
  const rows = ofDay.filter(k => show === 'all' || (show === 'todo' ? k.status === 'booked' || k.status === 'no_answer' : k.status === 'cancelled' || k.status === 'passed'))
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <PillTabs label="Day" className="fx-chips" itemClass="fx-chip" value={day} onChange={setDay}
          items={DAYS.map(d => ({ key: d, label: <><small>{dayName(d)}</small><b>{d}</b></>, extra: d === TODAY ? <i className="fs-today" aria-label="today" /> : null }))} />
        <span className="tp-grow" />
        <Seg label="Show" value={show} onChange={setShow} options={[{ key: 'all', label: 'All', count: ofDay.length }, { key: 'todo', label: 'To call', count: ofDay.filter(k => k.status === 'booked' || k.status === 'no_answer').length }, { key: 'done', label: 'Done', count: ofDay.filter(k => k.status === 'cancelled' || k.status === 'passed').length }]} />
      </div>
      <ul className="fs-legend" aria-label="Colours">{Object.entries(CALL_WORD).map(([s, w]) => <li key={s} className={`is-${CALL_TONE[s]}`}><i aria-hidden="true" />{w}</li>)}</ul>

      <div className="fx-cgrid fs-cgrid" aria-label={`Calls on ${dayName(day)}`}>
        {rows.map((k, i) => <CallCard key={k.id} k={k} i={i} />)}
        {rows.length === 0 && <section className="fx-tile"><Empty title="No calls here" sub={show === 'all' ? 'Nothing booked that day.' : 'Try All.'} /></section>}
      </div>

      {id && <CallDrawer key={id} id={id} onClose={() => navigate(fp('calls'))} />}
    </div>
  )
}
