import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Phone, Search, Wallet, Clock, MessageSquare, MapPin, Check, X } from 'lucide-react'
import { useSampleLeads, useSampleLead, useSampleBilling, useSampleActions } from '../data'
import { Avatar, Chip, Money, Seg, Switch, Drawer, Empty, Pending, useNote } from '../kit'
import { stageChip, OutcomeDrawer } from '../LeadOutcome'
import { RecordDrawer, Stepper, Block } from '../Record'
import { LANES, LEAD_STEPS, laneOf } from '../stages'
import { paths } from '../paths'

// Leads as a board: lanes by stage, cards filled with the stage colour. A card opens the lead in a drawer
// at its own URL (paths.lead); the board stays put behind it. On a desktop each lane scrolls inside itself.
const shortWhen = l => (l.appt ? l.appt.replace(/, Nov \d+,/, '') : l.stage === 'ringing' ? 'Now' : l.follow ? `Call ${l.follow.split(',')[0]}` : 'No time')
const whenOf = l => l.appt || (l.stage === 'ringing' ? 'Ringing now, 0:14' : l.follow ? `Call back ${l.follow}` : 'No time set')

function LeadCard({ l, i, onAccept }) {
  const live = l.kind === 'live_call'
  const tone = laneOf(l.stage).tone
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }}>
      <Link to={paths.lead(l.id)} className="fx-cover" aria-label={`Open ${l.first_name} ${l.last_name}`} />
      <div className="fx-lcard-top"><span className="fx-kind">{live ? <PhoneIncoming size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}{live ? 'Live call' : 'Appointment'}</span>{tone === 'warn' && <span className="fx-tag">{stageChip(l.stage)[1]}</span>}</div>
      <h3>{l.first_name} {l.last_name}</h3>
      <p>{l.city}, {l.state} · {l.age_band}</p>
      <div className="fx-lcard-bot">
        <span className="fx-big">{shortWhen(l)}</span>
        {l.stage === 'ringing'
          ? <button type="button" className="tp-primary sm fx-accent fx-over" onClick={() => onAccept(l)}><Phone size={14} />Accept</button>
          : <Avatar name={`${l.first_name} ${l.last_name}`} />}
      </div>
    </article>
  )
}

const TEXTS = [
  ['Automatic', 'Tue, Oct 27, 6:12 PM', 'Hi {n}, thanks for your request about mortgage protection. Your agent will call you in a few minutes.'],
  ['{n}', 'Tue, Oct 27, 6:40 PM', 'Tomorrow after 5 works'],
  ['Automatic', 'Wed, Oct 28, 5:11 PM', 'You are booked. Need a different time? [reschedule link]'],
]
const JOURNEY = [['Came in', 'Tue, Oct 27, 6:12 PM', 'Filled in the mortgage protection form.'], ['Our team called', 'Tue, Oct 27, 6:14 PM', 'No answer. Sent a text to pick a time.'], ['Replied', 'Tue, Oct 27, 6:40 PM', 'Picked tomorrow after 5.'], ['Booked on your calendar', 'Wed, Oct 28, 5:10 PM', 'The team booked the appointment.']]

function LeadDrawer({ id, onClose }) {
  const { data: lead } = useSampleLead(id)
  const { moveLead, addLeadNote } = useSampleActions()
  const note = useNote()
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState(null)
  const name = `${lead.first_name} ${lead.last_name}`
  const lane = laneOf(lead.stage)
  const current = LEAD_STEPS.some(s => s.key === lead.stage) ? lead.stage : 'booked'
  const asks = [['Mortgage balance', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone]]
  const pick = k => (k === 'booked' ? (moveLead(lead.id, 'booked'), note(`${name} moved to Booked`)) : setOutcome(k))
  return (
    <RecordDrawer label={name} kicker={`Lead · came in ${lead.created}`} tone={lane.tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{whenOf(lead)}</span><Chip tone={stageChip(lead.stage)[0]}>{stageChip(lead.stage)[1]}</Chip></div>
        <h2>{name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{lead.city}, {lead.state} · {lead.kind === 'live_call' ? 'Live call' : 'Appointment'}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big">{lead.mortgage_balance_band.replace(' to ', '–')}</b><Avatar name={name} /></div>
      </>}
      stepper={<Stepper label="Move this lead" steps={LEAD_STEPS} current={current} onPick={pick} />}
      actions={<>
        <button type="button" className="tp-primary fx-accent" onClick={() => note(`Calling ${lead.phone}`)}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => note(`Text started with ${lead.first_name}`)}><MessageSquare size={14} />Text</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('sold')}><Check size={14} />Sold</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('not_interested')}><X size={14} />Not interested</button>
      </>}>
      {lead.stage === 'sold' && <Link to={paths.submit()} className="fx-nudge">Sold. Submit it for servicing and the team takes it from here.</Link>}
      <Block title="What they told us">
        <dl className="fx-facts">{asks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <Pending>Consent wording pending</Pending>
      </Block>
      <Block title="Notes" sub="Only you and our team see these">
        {lead.note && <p className="fx-note">{lead.note}</p>}
        <textarea className="tp-input fx-ta" aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
        {draft.trim() && <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>}
      </Block>
      <Block title="Timeline">
        <ol className="tp-tl fx-tl">{JOURNEY.map(([t, at, d], i) => <li key={t} className={i === JOURNEY.length - 1 ? 'now' : 'done'}><i /><div><b>{t}</b><span>{at}. {d}</span></div></li>)}</ol>
      </Block>
      <Block title="Texts" sub={`Automatic texts stop as soon as ${lead.first_name} replies, books or opts out.`}>
        <div className="tp-chat">{TEXTS.map(([from, at, text]) => {
          const them = from === '{n}'
          return <div key={at} className={`tp-bub${them ? '' : ' me'}`}>{text.replace('{n}', lead.first_name)}<small>{them ? lead.first_name : from} · {at}</small></div>
        })}</div>
      </Block>
      <OutcomeDrawer lead={outcome ? lead : null} kind={outcome} onClose={() => setOutcome(null)} />
    </RecordDrawer>
  )
}

export default function Leads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: leads } = useSampleLeads()
  const { data: billing } = useSampleBilling()
  const { moveLead } = useSampleActions()
  const note = useNote()
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [spend, setSpend] = useState(false)
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => (kind === 'all' || (kind === 'live' ? l.kind === 'live_call' : l.kind === 'appointment'))
    && (!n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n)))
  const total = billing.leadTypes.filter(t => t.on).reduce((s, t) => s + t.weekly, 0)
  const accept = l => { moveLead(l.id, 'booked'); note(`You took the call with ${l.first_name}. The team dropped off`) }
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Lead type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: leads.length }, { key: 'appointments', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live_call').length }]} />
        <span className="tp-grow" />
        <button type="button" className="fx-pillbtn" onClick={() => setSpend(true)}><Wallet size={15} aria-hidden="true" /><Money v={total} cents={false} /><small>a week</small></button>
      </div>

      <div className="fx-board" role="region" aria-label="Leads by stage">
        {LANES.map((lane, li) => {
          const rows = shown.filter(l => lane.stages.includes(l.stage))
          return (
            <section key={lane.key} className={`fx-lane is-${lane.tone}`} style={{ '--i': li }} aria-label={`${lane.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{lane.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} i={card++} onAccept={accept} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No lead matches that search.' : lane.empty} />}
              </div>
            </section>
          )
        })}
      </div>

      {id && <LeadDrawer id={id} onClose={() => navigate(paths.leads())} />}
      <SpendDrawer open={spend} onClose={() => setSpend(false)} />
    </div>
  )
}

function SpendDrawer({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { setLeadType } = useSampleActions()
  const note = useNote()
  return (
    <Drawer open={open} onClose={onClose} title="Change spend" sub={`Sample prices, not final · next charge ${billing.next_charge}`} footer={<button type="button" className="tp-primary fx-accent" onClick={() => { note('Spend updated'); onClose() }}>Done</button>}>
      {billing.leadTypes.map(t => <div key={t.key} className="tp-row"><span className="tp-ic teal">{t.key === 'live' ? <PhoneIncoming size={16} /> : <CalendarDays size={16} />}</span><div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub}</p></div><Money v={t.weekly} cents={false} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
    </Drawer>
  )
}
