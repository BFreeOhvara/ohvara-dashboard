import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Phone, Search, Wallet, Clock, MessageSquare, MapPin, Check, X, ClipboardCheck, Send } from 'lucide-react'
import { useSampleLeads, useSampleLead, useSampleBilling, useSampleActions } from '../data'
import { Avatar, Chip, Money, Seg, Drawer, Empty, Pending, useNote } from '../kit'
import { stageChip, OutcomeDrawer, OutcomePrompt } from '../LeadOutcome'
import { RecordDrawer, Stepper, Block } from '../Record'
import { BudgetSlider } from '../PlanBuilder'
import { LANES, LEAD_STEPS, laneOf } from '../stages'
import { STAGES, MAX_TRIES, needsOutcome, atLabel, SAMPLE_NOW } from '../leadLifecycle'
import { paths } from '../paths'
import '../leads873.css'

// Leads as a board: one lane per step of the lead's path (P873, leadLifecycle.js), left to right. Stage tabs above
// filter to one lane (?lane=). A card opens the lead in a drawer at its own URL (paths.lead); the board stays put
// behind it. On a desktop each lane scrolls inside itself.
const shortWhen = l => {
  if (l.stage === 'ringing') return 'Now'
  if (l.stage === 'new') return 'Calling now'
  if (l.stage === 'calling') return `Try ${Math.min(l.tries || 1, MAX_TRIES)} of ${MAX_TRIES}`
  if (l.stage === 'missed') return 'Rebooking'
  if (STAGES[l.stage]?.lane === 'closed') return STAGES[l.stage].label
  if (l.stage === 'follow_up' && l.follow) return `Call ${l.follow.split(',')[0]}`
  return l.appt ? l.appt.replace(/, Nov \d+,/, '') : 'No time'
}
const whenOf = l => (l.stage === 'ringing' ? 'Ringing now' : l.stage === 'follow_up' && l.follow ? `Call back ${l.follow}` : l.appt || `Came in ${l.assigned_at}`)
const tagOf = l => {
  if (needsOutcome(l, SAMPLE_NOW)) return ['violet', 'Mark outcome']
  if (l.reply && !l.reply.seen) return ['teal', 'Replied']
  if (l.stage === 'calling') return null
  return laneOf(l.stage).tone === 'warn' ? stageChip(l.stage, l) : null
}

function LeadCard({ l, i, onAnswer }) {
  const live = l.kind === 'live_call'
  const tone = laneOf(l.stage).tone
  const tag = tagOf(l)
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }} data-stage={l.stage}>
      <Link to={paths.lead(l.id)} className="fx-cover" aria-label={`Open ${l.first_name} ${l.last_name}`} />
      <div className="fx-lcard-top"><span className="fx-kind">{live ? <PhoneIncoming size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}{live ? 'Live call' : 'Appointment'}</span>{tag && <span className="fx-tag">{tag[1]}</span>}</div>
      <h3>{l.first_name} {l.last_name}</h3>
      <p>{l.city}, {l.state} · {l.age_band}</p>
      <div className="fx-lcard-bot">
        <span className="fx-big">{shortWhen(l)}</span>
        {l.stage === 'ringing'
          ? <button type="button" className="tp-primary sm fx-accent fx-over" onClick={() => onAnswer(l)}><Phone size={14} />Answer</button>
          : <Avatar name={`${l.first_name} ${l.last_name}`} tone={tone} />}
      </div>
    </article>
  )
}

// One timeline row, shaped like a lead-events row. Texts show as bubbles; what the system or the agent sends is a
// preview until texting is switched on.
function Row({ e, lead, last }) {
  const isText = e.kind === 'text_sent' || e.kind === 'text_received'
  const theirs = e.kind === 'text_received'
  const later = e.state === 'scheduled'
  return (
    <li className={`lc-ev${later ? ' is-later' : last ? ' now' : ' done'}`} data-kind={e.kind}>
      <i />
      <div>
        <span className="lc-ev-h"><b>{e.label}</b>{later && <span className="lc-sched">{e.kind === 'text_sent' ? 'Scheduled' : 'Next'}</span>}</span>
        <span className="lc-ev-by">{e.by} · {atLabel(e.at, SAMPLE_NOW)}</span>
        {isText && <div className={`tp-bub lc-bub${theirs ? '' : ' me'}`}>{e.text}{!theirs && <small>Preview · sends when your leads go live</small>}{theirs && <small>From {lead.first_name}</small>}</div>}
      </div>
    </li>
  )
}

function LeadDrawer({ id, onClose }) {
  const { data: lead } = useSampleLead(id)
  const { moveLead, addLeadNote, replyLead } = useSampleActions()
  const note = useNote()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState('')
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [prompt, setPrompt] = useState(params.get('outcome') === '1')
  const [replying, setReplying] = useState(params.get('reply') === '1')
  const replyRef = useRef(null)
  useEffect(() => {
    if (params.get('outcome') || params.get('reply')) setParams({}, { replace: true })
  }, [params, setParams])
  useEffect(() => { if (replying) replyRef.current?.focus({ preventScroll: false }) }, [replying])
  const name = `${lead.first_name} ${lead.last_name}`
  const lane = laneOf(lead.stage)
  const current = LEAD_STEPS.some(s => s.key === lead.stage) ? lead.stage : 'booked'
  const chip = stageChip(lead.stage, lead)
  const asks = [['Mortgage balance', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone]]
  const pick = k => (k === 'booked' ? (moveLead(lead.id, 'booked'), note(`${name} moved to Booked`)) : setOutcome(k))
  const events = lead.events || []
  const lastDone = events.reduce((n, e, i) => (e.state === 'done' ? i : n), -1)
  const closed = lane.key === 'closed'
  const send = () => { replyLead(lead.id, text.trim()); setText(''); setReplying(false); note('Text saved. It sends when your leads go live') }
  return (
    <RecordDrawer label={name} kicker={`Lead · came in ${lead.created}`} tone={lane.tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{whenOf(lead)}</span><Chip tone={chip[0]}>{chip[1]}</Chip></div>
        <h2>{name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{lead.city}, {lead.state} · {lead.kind === 'live_call' ? 'Live call' : 'Appointment'}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big">{lead.mortgage_balance_band.replace(' to ', '–')}</b><Avatar name={name} tone={lane.tone} /></div>
      </>}
      stepper={<Stepper label="Move this lead" steps={LEAD_STEPS} current={current} onPick={pick} />}
      actions={<>
        <button type="button" className="tp-primary fx-accent" onClick={() => note(`Calling ${lead.phone}. Calls connect when your leads go live`)}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" disabled={lead.stage === 'opted_out'} onClick={() => setReplying(true)}><MessageSquare size={14} />Text</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('sold')}><Check size={14} />Sold</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('not_interested')}><X size={14} />Not interested</button>
      </>}>
      {needsOutcome(lead, SAMPLE_NOW) && <button type="button" className="lc-nudge" onClick={() => setPrompt(true)}><ClipboardCheck size={16} aria-hidden="true" /><span className="tp-grow"><b>How did it go?</b><small>{lead.stage === 'showed' ? 'You talked. Mark the outcome' : `The appointment at ${lead.appt} ended`}</small></span><span className="lc-nudge-go">Mark outcome</span></button>}
      {lead.stage === 'sold' && !lead.submitted && <Link to={paths.submit(lead.id)} className="fx-nudge">Sold. Submit it for servicing and the team takes it from here.</Link>}
      {closed && <p className="lc-closed">{lead.stage === 'opted_out' ? 'Opted out. All calls and texts stopped.' : 'Closed. No more calls or texts.'} {lead.stage === 'unreachable' ? 'A reply to a check-in brings them back as a new lead.' : ''}</p>}
      <Block title="What they told us">
        <dl className="fx-facts">{asks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <Pending>Consent wording pending</Pending>
      </Block>
      <Block title="Timeline" sub="Every call, text and change, oldest first. Texts stop once they reply, book or opt out.">
        {events.length
          ? <ol className="tp-tl fx-tl lc-tl">{events.map((e, i) => <Row key={e.id} e={e} lead={lead} last={i === lastDone} />)}</ol>
          : <Empty title="Nothing yet" sub="Calls, texts and changes show here as they happen." />}
        {(replying || (lead.reply && !lead.reply.seen)) && lead.stage !== 'opted_out' && <div className="lc-reply">
          <textarea ref={replyRef} className="tp-input fx-ta" aria-label={`Text ${lead.first_name}`} placeholder={`Text ${lead.first_name}`} value={text} onChange={e => setText(e.target.value)} />
          <span className="lc-reply-f"><small>Saved now. It sends when your leads go live.</small><button type="button" className="tp-primary sm fx-accent" disabled={!text.trim()} onClick={send}><Send size={14} aria-hidden="true" />Send</button></span>
        </div>}
        <Pending>Opt-out line pending lawyer review</Pending>
      </Block>
      <Block title="Notes" sub="Only you and our team see these">
        {lead.note && <p className="fx-note">{lead.note}</p>}
        <textarea className="tp-input fx-ta" aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
        {draft.trim() && <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>}
      </Block>
      <OutcomeDrawer lead={outcome ? lead : null} kind={outcome} onClose={() => setOutcome(null)} />
      {prompt && <OutcomePrompt lead={lead} onClose={() => setPrompt(false)} />}
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
  const [params, setParams] = useSearchParams()
  const laneKey = LANES.some(l => l.key === params.get('lane')) ? params.get('lane') : 'all'
  const setLane = k => setParams(k === 'all' ? {} : { lane: k }, { replace: true })
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => (kind === 'all' || (kind === 'live' ? l.kind === 'live_call' : l.kind === 'appointment'))
    && (!n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n)))
  const answer = l => { moveLead(l.id, 'showed'); note(`You took the call with ${l.first_name}. The team dropped off`); navigate(paths.lead(l.id)) }
  const lanes = laneKey === 'all' ? LANES : LANES.filter(l => l.key === laneKey)
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Lead type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: leads.length }, { key: 'appointments', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live_call').length }]} />
        <span className="tp-grow" />
        <button type="button" className="fx-pillbtn" aria-label="Change your weekly budget" onClick={() => setSpend(true)}><Wallet size={15} aria-hidden="true" /><Money v={billing.budget.weekly} cents={false} /><small>a week</small></button>
      </div>

      <Seg label="Stage" className="lc-stages" value={laneKey} onChange={setLane} options={[{ key: 'all', label: 'All stages', count: shown.length }, ...LANES.map(l => ({ key: l.key, label: l.label, count: shown.filter(x => l.stages.includes(x.stage)).length }))]} />

      <div className={`fx-board lc-board${lanes.length === 1 ? ' is-one' : ''}`} role="region" aria-label="Leads by stage">
        {lanes.map((lane, li) => {
          const rows = shown.filter(l => lane.stages.includes(l.stage))
          return (
            <section key={lane.key} className={`fx-lane is-${lane.tone}`} style={{ '--i': li }} aria-label={`${lane.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{lane.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} i={card++} onAnswer={answer} />)}
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

// The weekly budget, from the Leads page: same slider as Billing. Sample only, nothing is charged.
function SpendDrawer({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { setBudget } = useSampleActions()
  const note = useNote()
  const [weekly, setWeekly] = useState(billing.budget.weekly)
  const [mode, setMode] = useState(billing.budget.mode)
  return (
    <Drawer open={open} onClose={onClose} title="Weekly budget" sub={`Draft prices · starts with the charge on ${billing.next_charge}`}
      footer={<button type="button" className="tp-primary fx-accent" onClick={() => { setBudget(weekly, mode); note('Budget saved. Sample only, nothing was charged'); onClose() }}>Save budget</button>}>
      <BudgetSlider weekly={weekly} mode={mode} onWeekly={setWeekly} onMode={setMode} id="leads-budget" />
    </Drawer>
  )
}
