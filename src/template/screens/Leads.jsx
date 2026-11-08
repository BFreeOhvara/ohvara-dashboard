import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Phone, Search, Wallet, Clock, MapPin, Check, X, ClipboardCheck, Users, Link2, MessageSquareWarning, Archive, PhoneForwarded, Inbox } from 'lucide-react'
import { useDataSource, useSampleLeads, useSampleLead, useSampleBilling, useSampleActions, useSampleSettings } from '../data'
import { Avatar, Chip, Seg, Drawer, Empty, Pending, Switch, useNote } from '../kit'
import { stageChip, OutcomeDrawer, OutcomePrompt, NoShowUndo } from '../LeadOutcome'
import { RecordDrawer, Stepper, Block } from '../Record'
import { SpendSliders, TakeLeads } from '../PlanBuilder'
import { takeOk } from '../../lib/leadSplit'
import { LANES, CLOSED_LANE, LEAD_STEPS, laneOf } from '../stages'
import { needsOutcome, agentCallTask, confirmedByText, atLabel, clockNow } from '../leadLifecycle'
import { agentStatusOf, agentEvents, closedReason } from '../agentView'
import { dailyTotal, openSlotsPerWeek, spendOk } from '../spendPlan'
import { usd } from '../motion'
import { FeedbackDrawer } from '../Talk'
import { paths } from '../paths'
import { FirstRun } from '../DataState'
import '../leads873.css'
import '../p878.css'
import { FilterPills } from '../FilterPills'

// P878: Leads as a board of the agent's five statuses (agentView.js), left to right: Our team is on it, Booked, Needs
// you, Follow up, Sold. Closed sits under a filter, with its reason on each lead. Never call attempts, the text sequence
// or where a lead came from. Status tabs above filter to one lane (?lane=). A card opens the lead in a drawer at its own
// URL (paths.lead); the board stays put behind it. On a desktop each lane scrolls inside itself.
const shortWhen = l => {
  if (l.stage === 'ringing') return 'Now'
  const st = agentStatusOf(l)
  if (st === 'closed') return 'Closed'
  if (st === 'on_it') return l.appt ? l.appt.replace(/, Nov \d+,/, '') : 'Team on it'
  if (l.stage === 'sold') return l.submitted ? 'Submitted' : 'Add details'
  if (l.stage === 'follow_up' && l.follow) return `Call ${l.follow.split(',')[0]}`
  return l.appt ? l.appt.replace(/, Nov \d+,/, '') : 'No time'
}
const whenOf = l => (l.stage === 'ringing' ? 'Ringing now' : l.stage === 'follow_up' && l.follow ? `Call back ${l.follow}` : l.appt || `Came in ${l.assigned_at}`)
const tagOf = l => {
  if (needsOutcome(l, clockNow())) return ['violet', 'Mark outcome']
  if (agentCallTask(l)) return ['warn', 'Call them back']
  if (l.stage === 'sold' && !l.submitted) return ['warn', 'Finish details']
  if (confirmedByText(l)) return ['blue', 'Confirmed']
  if (l.stage === 'ringing') return ['warn', 'Live transfer']
  return null
}

function LeadCard({ l, i, onAnswer }) {
  const live = l.kind === 'live_call'
  const tone = laneOf(l).tone
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
        <span className="lc-ev-by">{e.by} · {atLabel(e.at, clockNow())}</span>
        {isText && <div className={`tp-bub lc-bub${theirs ? '' : ' me'}`}>{e.text}{!theirs && <small>Automatic · preview, sends when your leads go live</small>}{theirs && <small>From {lead.first_name}</small>}</div>}
        {e.kind === 'call_task' && <span className={`lc-task is-${e.task === 'you' ? 'you' : 'team'}`}>{e.task === 'you' ? 'For you' : 'For our team'}</span>}
        {e.audit && <span className="lc-task is-audit">Kept on the record</span>}
      </div>
    </li>
  )
}

function LeadDrawer({ id, onClose }) {
  const { data: lead } = useSampleLead(id)
  const { moveLead, addLeadNote, callBack, askTeamToCall, sendBookingLink } = useSampleActions()
  const note = useNote()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [prompt, setPrompt] = useState(params.get('outcome') === '1')
  const [panel, setPanel] = useState(null)
  useEffect(() => {
    if (params.get('outcome') || params.get('call')) setParams({}, { replace: true })
  }, [params, setParams])
  const name = `${lead.first_name} ${lead.last_name}`
  const lane = laneOf(lead)
  const current = LEAD_STEPS.some(s => s.key === lead.stage) ? lead.stage : 'booked'
  const chip = stageChip(lead.stage, lead)
  const asks = [['Mortgage balance', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone]]
  const pick = k => (k === 'booked' ? (moveLead(lead.id, 'booked'), note(`${name} moved to Booked`)) : setOutcome(k))
  const events = agentEvents(lead)
  const lastDone = events.reduce((n, e, i) => (e.state === 'done' ? i : n), -1)
  const closed = lane.key === 'closed'
  const task = agentCallTask(lead)
  const call = () => { if (task) callBack(lead.id); note(`Calling ${lead.phone}. Calls connect when your leads go live`) }
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
        <button type="button" className="tp-primary fx-accent" disabled={closed} onClick={call}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" disabled={closed} onClick={() => setPanel('team')}><Users size={14} />Ask our team to call</button>
        {lead.stage === 'follow_up' && <button type="button" className="tp-btn ov-ghost" disabled={lead.linkSent} onClick={() => { sendBookingLink(lead.id); note(`Booking link sent. ${lead.first_name} picks a time on your calendar`) }}><Link2 size={14} />{lead.linkSent ? 'Link sent' : 'Send booking link'}</button>}
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('sold')}><Check size={14} />Sold</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setOutcome('not_interested')}><X size={14} />Not interested</button>
      </>}>
      <NoShowUndo lead={lead} />
      {task && <button type="button" className="lc-nudge" onClick={call}><PhoneForwarded size={16} aria-hidden="true" /><span className="tp-grow"><b>{lead.first_name} asked you to call</b><small>{'“'}{lead.reply.text}{'”'} We told them someone calls shortly.</small></span><span className="lc-nudge-go">Call</span></button>}
      {needsOutcome(lead, clockNow()) && <button type="button" className="lc-nudge" onClick={() => setPrompt(true)}><ClipboardCheck size={16} aria-hidden="true" /><span className="tp-grow"><b>How did it go?</b><small>{lead.stage === 'showed' ? 'You talked. Mark the outcome' : `The appointment at ${lead.appt} ended`}</small></span><span className="lc-nudge-go">Mark outcome</span></button>}
      {lead.stage === 'sold' && !lead.submitted && <Link to={paths.submit(lead.id)} className="fx-nudge">Finish the servicing details. The team takes it from there.</Link>}
      {closed && <p className="lc-closed"><b>{closedReason(lead)}.</b> {lead.stage === 'opted_out' ? 'All calls and texts stopped.' : 'No more calls or texts.'} A reply from them brings them back as a new lead.</p>}
      {lane.key === 'on_it' && lead.stage !== 'ringing' && <p className="lc-closed">Our team is on it. Nothing for you to do yet: you hear from us when they{'’'}re booked or on the line.</p>}
      <Block title="What they told us">
        <dl className="fx-facts">{asks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <Pending>Consent wording pending</Pending>
      </Block>
      <Block title="Messages and changes" sub="Every text is automatic, and so is every answer to theirs. If they need a person, a call task goes to you or our team. Read only.">
        {events.length
          ? <ol className="tp-tl fx-tl lc-tl">{events.map((e, i) => <Row key={e.id} e={e} lead={lead} last={i === lastDone} />)}</ol>
          : <Empty title="Nothing yet" sub="Texts and changes show here as they happen." />}
        <Pending>Opt-out line pending lawyer review</Pending>
      </Block>
      <Block title="Notes" sub="Only you and our team see these">
        {lead.note && <p className="fx-note">{lead.note}</p>}
        <textarea className="tp-input fx-ta" aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
        {draft.trim() && <button type="button" className="tp-btn ov-ghost fx-self" onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>}
      </Block>
      <button type="button" className="tp-link lc-fb" onClick={() => setPanel('feedback')}><MessageSquareWarning size={14} aria-hidden="true" />Feedback on how our team handled {lead.first_name}</button>
      <OutcomeDrawer lead={outcome ? lead : null} kind={outcome} onClose={() => setOutcome(null)} />
      {prompt && <OutcomePrompt lead={lead} onClose={() => setPrompt(false)} />}
      <AskTeamDrawer open={panel === 'team'} lead={lead} onClose={() => setPanel(null)} onSend={why => { askTeamToCall(lead.id, why); note(`Our team calls ${lead.first_name}. You see it here`) }} />
      <FeedbackDrawer open={panel === 'feedback'} lead={lead} onClose={() => setPanel(null)} />
    </RecordDrawer>
  )
}

export default function Leads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: leads } = useSampleLeads()
  const source = useDataSource()
  const { data: billing } = useSampleBilling()
  const { moveLead } = useSampleActions()
  const note = useNote()
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [spend, setSpend] = useState(false)
  const [params, setParams] = useSearchParams()
  const showClosed = params.get('closed') === '1'
  const ALL = showClosed ? [...LANES, CLOSED_LANE] : LANES
  const laneKey = ALL.some(l => l.key === params.get('lane')) ? params.get('lane') : 'all'
  const setLane = k => setParams({ ...(k === 'all' ? {} : { lane: k }), ...(showClosed ? { closed: '1' } : {}) }, { replace: true })
  const setClosed = on => setParams(on ? { closed: '1', lane: 'closed' } : {}, { replace: true })
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => (kind === 'all' || (kind === 'live' ? l.kind === 'live_call' : l.kind === 'appointment'))
    && (!n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n)))
  const servicing = billing.products !== 'leads'
  const inLane = (lane, l) => agentStatusOf(l, { servicing }) === lane.key
  const answer = l => { moveLead(l.id, 'showed'); note(`You took the call with ${l.first_name}. The team dropped off`); navigate(paths.lead(l.id)) }
  const lanes = laneKey === 'all' ? ALL : ALL.filter(l => l.key === laneKey)
  const money = usd()
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Lead type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: leads.length }, { key: 'appointments', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live_call').length }]} />
        <span className="tp-grow" />
        <label className="lc-closedsw"><Archive size={15} aria-hidden="true" /><span>Show closed</span><Switch on={showClosed} label="Show closed leads" onChange={setClosed} /></label>
        <button type="button" className="fx-pillbtn" aria-label="Change your daily lead spend" onClick={() => setSpend(true)}><Wallet size={15} aria-hidden="true" /><b className="tp-money">{money(dailyTotal(billing.spend))}</b><small>a day</small></button>
      </div>

      {/* P893: each status pill in its own colour with its count, like the Clients page; the picked one goes darker */}
      <FilterPills label="Status" value={laneKey} onChange={setLane} items={[{ key: 'all', label: showClosed ? 'All' : 'All open', count: shown.filter(x => ALL.some(l => inLane(l, x))).length }, ...ALL.map(l => ({ key: l.key, label: l.label, tone: l.tone, count: shown.filter(x => inLane(l, x)).length }))]} />
      <p className="lc-explain">{(ALL.find(l => l.key === laneKey) || { explain: 'Five statuses, left to right. Our team works every lead until it’s booked or on the line with you.' }).explain}</p>

      {leads.length === 0 && <FirstRun icon={Inbox} title="Your leads show here" sub="Each lead lands here the moment it comes in. Our team calls it right away, books it on your calendar or rings you live, and you see every step." />}
      <div className={`fx-board lc-board${lanes.length === 1 ? ' is-one' : ''}`} style={{ '--lanes': lanes.length }} role="region" aria-label="Leads by stage">
        {lanes.map((lane, li) => {
          const rows = shown.filter(l => inLane(lane, l))
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

      {id && (source === 'sample' || leads.some(l => l.id === id)) && <LeadDrawer id={id} onClose={() => navigate(paths.leads())} />}
      <SpendDrawer open={spend} onClose={() => setSpend(false)} />
    </div>
  )
}

// The daily lead spend, from the Leads page: the same sliders as Billing. Sample only, nothing is charged.
function SpendDrawer({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setSpend, setTake } = useSampleActions()
  const note = useNote()
  const [spend, setDraft] = useState({ daily: dailyTotal(billing.spend) })
  const [take, setTakeDraft] = useState(billing.take)
  return (
    <Drawer open={open} onClose={onClose} title="Daily lead spend" sub="Draft prices · a change starts tomorrow at 12:00 AM your time"
      footer={<button type="button" className="tp-primary fx-accent" disabled={!spendOk(billing.plan, spend) || !takeOk(take)} onClick={() => { setSpend(spend); setTake(take); note('Lead spend saved. Starts tomorrow. Sample only, nothing was charged'); onClose() }}>Save lead spend</button>}>
      <SpendSliders spend={spend} onSpend={setDraft} plan={billing.plan} mode={take.mode} id="leads-spend" openSlots={openSlotsPerWeek(settings.week)} />
      <TakeLeads take={take} onTake={setTakeDraft} id="leads-take" />
    </Drawer>
  )
}

// Ask our team to call: a call task for the team on this lead, with a reason.
const ASK_WHY = ['I can’t reach them', 'They want a different time', 'Check their details', 'Something else']
function AskTeamDrawer({ open, lead, onClose, onSend }) {
  const [why, setWhy] = useState(ASK_WHY[0])
  return (
    <Drawer open={open} onClose={onClose} title="Ask our team to call" sub={`${lead.first_name} ${lead.last_name} · ${lead.phone}`}
      footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { onSend(why); onClose() }}><Users size={15} />Ask our team</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Seg role="radiogroup" label="Why" className="lc-why" value={why} onChange={setWhy} options={ASK_WHY.map(w => ({ key: w, label: w }))} />
      <p className="tp-sub">The next free person on our team calls {lead.first_name} right away (at 8 AM if it{'’'}s after hours). It shows on this lead.</p>
    </Drawer>
  )
}
