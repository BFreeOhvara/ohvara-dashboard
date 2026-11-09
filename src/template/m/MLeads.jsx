import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Clock, MapPin, Search, Wallet, ChevronRight, Users, Link2, ClipboardCheck, PhoneForwarded, X, MessageSquareWarning } from 'lucide-react'
import { useSampleLeads, useSampleLead, useSampleActions, useSampleBilling, useDataSource } from '../data'
import { Avatar, Chip, Pending, useNote } from '../kit'
import { stageChip, OutcomeDrawer, NoShowUndo } from '../LeadOutcome'
import { FeedbackDrawer } from '../Talk'
import { LANES, CLOSED_LANE, laneOf } from '../stages'
import { agentCallTask, confirmedByText, atLabel, clockNow } from '../leadLifecycle'
import { agentStatusOf, agentEvents, closedReason, needsResult, resultsFor, isLiveCall, liveCalls, RESULT_LABEL, RESULT_MEANING } from '../agentView'
import { dailyTotal } from '../spendPlan'
import { usd } from '../motion'
import { paths } from '../paths'
import { Sheet, ActionSheet, ActRow } from './Sheet'
import { CallBtn } from './bits'
import { SpendSheet } from './MMore'
import { mp } from './mpaths'
import { targetOf } from '../../lib/deedstoneCall'
import { DeedstoneCallButton } from '../DeedstoneCall'

// P908 — Leads on a phone: one status at a time. Swipe sideways (or tap a status) to move between Booked, No show,
// Follow up, Not interested, Sold and Closed, each with its count. Cards are full width with Call in thumb reach;
// a card opens the lead as a full-screen sheet, and "Pick the result" is a bottom sheet. Live calls pin on top.
const LANE_ALL = [...LANES, CLOSED_LANE]
const RESULT_TONE = { sold: 'green', no_show: 'mute', follow_up: 'teal', not_interested: 'warn', booked: 'blue' }
const whenOf = l => (l.stage === 'ringing' ? 'Ringing now' : isLiveCall(l) ? 'Live call' : l.stage === 'follow_up' && l.follow ? `Call back ${l.follow}` : l.appt || `Came in ${l.assigned_at}`)
const tagOf = l => {
  if (l.stage === 'ringing') return 'Ringing'
  if (needsResult(l, clockNow())) return 'Mark result'
  if (agentCallTask(l)) return 'Call them back'
  if (l.stage === 'sold' && !l.submitted) return 'Finish details'
  if (confirmedByText(l)) return 'Confirmed'
  return null
}
const nameOf = l => `${l.first_name} ${l.last_name}`

// A live call waiting for its result (ringing now, or taken and not marked). P917: the agent answers on their phone, so
// the card is only for the result: "Live call", Mark result, no Answer.
export function LiveStrip({ leads, compact = false }) {
  const calls = liveCalls(leads)
  if (!calls.length) return null
  const btn = `mx-btn is-primary${compact ? ' is-sm' : ' is-wide'}`
  return (
    <ul className={`mx-live${compact ? ' is-compact' : ''}`} aria-label={`Live calls, ${calls.length}`}>
      {calls.map(l => {
        const ringing = l.stage === 'ringing'
        return (
          <li key={l.id} className={`mx-livecard${ringing ? ' is-ringing' : ''}`}>
            <span className="mx-live-k"><PhoneIncoming size={15} aria-hidden="true" />Live call</span>
            <span className="mx-live-n"><b>{nameOf(l)}</b><small>{l.city}, {l.state} · {l.age_band}</small></span>
            <Link to={mp.lead(l.id, true)} className={btn}><ClipboardCheck size={18} aria-hidden="true" />{compact ? 'Mark' : 'Mark result'}</Link>
          </li>
        )
      })}
    </ul>
  )
}

function LeadCard({ l }) {
  const tone = laneOf(l).tone
  const tag = tagOf(l)
  const result = l.stage !== 'ringing' && needsResult(l, clockNow())
  const closed = agentStatusOf(l) === 'closed'
  return (
    <li className={`mx-lcard fx-card is-${tone}`}>
      <Link to={mp.lead(l.id)} className="mx-cover" aria-label={`Open ${nameOf(l)}`} />
      <div className="mx-lcard-top"><span className="mx-kind">{l.kind === 'live_call' ? <PhoneIncoming size={14} aria-hidden="true" /> : <CalendarDays size={14} aria-hidden="true" />}{l.kind === 'live_call' ? 'Live call' : 'Appointment'}</span>{tag && <span className="mx-tag">{tag}</span>}</div>
      <div className="mx-lcard-mid">
        <Avatar name={nameOf(l)} tone={tone} />
        <span className="tp-grow"><b>{nameOf(l)}</b><small>{l.city}, {l.state} · {l.age_band}</small></span>
        {!closed && <CallBtn phone={l.rawPhone || l.phone} to={targetOf('lead', l)} />}
      </div>
      <p className="mx-lcard-when"><Clock size={15} aria-hidden="true" />{closed ? closedReason(l) : whenOf(l)}</p>
      {result && <Link to={mp.lead(l.id, true)} className="mx-btn is-primary is-wide mx-over"><ClipboardCheck size={18} aria-hidden="true" />Mark result</Link>}
    </li>
  )
}

// The status picker: the results this lead's status allows, each with its one-line meaning.
export function StatusPicker({ lead, open, onClose }) {
  const { moveLead } = useSampleActions()
  const note = useNote()
  const [outcome, setOutcome] = useState(null)
  const pick = k => {
    onClose()
    if (k === 'booked') { moveLead(lead.id, 'booked'); note(`${lead.first_name} moved to Booked`) } else setOutcome(k)
  }
  return (
    <>
      <ActionSheet open={open} onClose={onClose} title={`How did it go with ${lead.first_name}?`} sub={isLiveCall(lead) ? 'You took the live call' : lead.appt ? `Appointment ${lead.appt}` : null}>
        {resultsFor(lead).map(k => <ActRow key={k} tone={RESULT_TONE[k]} label={RESULT_LABEL[k]} sub={RESULT_MEANING[k]} onClick={() => pick(k)} />)}
      </ActionSheet>
      <OutcomeDrawer lead={outcome ? lead : null} kind={outcome} onClose={() => setOutcome(null)} />
    </>
  )
}

const ASK_WHY = ['I can’t reach them', 'They want a different time', 'Check their details', 'Something else']
function LeadSheet({ id, onClose }) {
  const { data: lead } = useSampleLead(id)
  const { addLeadNote, askTeamToCall, sendBookingLink, callBack, rebookLead } = useSampleActions()
  const source = useDataSource()
  const [fb, setFb] = useState(false)
  const note = useNote()
  const [params, setParams] = useSearchParams()
  const [pick, setPick] = useState(params.get('outcome') === '1')
  const [ask, setAsk] = useState(false)
  const [draft, setDraft] = useState('')
  useEffect(() => { if (params.get('outcome')) setParams({}, { replace: true }) }, [params, setParams])
  const name = nameOf(lead)
  const lane = laneOf(lead)
  const chip = stageChip(lead.stage, lead)
  const closed = lane.key === 'closed'
  const task = agentCallTask(lead)
  const canPick = resultsFor(lead).length > 0
  const events = agentEvents(lead)
  const facts = [['Mortgage', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone]]
  return (
    <Sheet open onClose={onClose} title={name} kicker={`Lead · came in ${lead.created}`} tone={lane.tone}
      footer={closed ? null : <>
        <CallBtn big phone={lead.rawPhone || lead.phone} to={targetOf('lead', lead)} />
        {canPick && <button type="button" className="mx-btn is-wide" onClick={() => setPick(true)}><ClipboardCheck size={18} aria-hidden="true" />Pick the result</button>}
      </>}>
      <div className={`mx-hero fx-card is-${lane.tone}`}>
        <div className="mx-hero-top"><span><Clock size={14} aria-hidden="true" />{whenOf(lead)}</span><Chip tone={chip[0]}>{chip[1]}</Chip></div>
        <p><MapPin size={14} aria-hidden="true" />{lead.city}, {lead.state} · {lead.kind === 'live_call' ? 'Live call' : 'Appointment'}</p>
        <b className="mx-hero-big tp-money">{lead.mortgage_balance_band.replace(' to ', '–')}</b>
      </div>
      <NoShowUndo lead={lead} />
      {task && <DeedstoneCallButton target={targetOf('lead', lead)} className="mx-nudge is-warn" onCall={() => callBack(lead.id)}><PhoneForwarded size={18} aria-hidden="true" /><span className="tp-grow"><b>{lead.first_name} asked you to call</b><small>“{lead.reply.text}”</small></span><ChevronRight size={18} aria-hidden="true" /></DeedstoneCallButton>}
      {lead.stage === 'sold' && !lead.submitted && <Link to={paths.submit(lead.id)} className="mx-nudge is-green"><span className="tp-grow"><b>Finish the servicing details</b><small>The team takes it from there</small></span><ChevronRight size={18} aria-hidden="true" /></Link>}
      {closed && <p className="mx-note"><b>{closedReason(lead)}.</b> No more calls or texts. A reply from them brings them back as a new lead.</p>}
      {agentStatusOf(lead) === 'team' && <p className="mx-note">Our team is calling {lead.first_name}. Nothing for you to do yet: they land on Booked.</p>}
      {agentStatusOf(lead) === 'no_show' && !lead.undo && (
        <div className="mx-note"><b>No show{lead.appt ? ` at ${lead.appt}` : ''}.</b> We sent {lead.first_name} a one-tap link to rebook. {lead.vaCall ? `${lead.vaCall.va || 'Our team'} is booked to call ${atLabel(lead.vaCall.at, clockNow())} if they haven’t picked a time.` : 'If they don’t pick a time, our team calls to book them again.'}
          {source === 'sample' && <button type="button" className="mx-btn is-wide mx-gap" onClick={() => { rebookLead(lead.id); note(`${lead.first_name} picked a new time. Back on Booked`) }}>Sample: they pick a new time</button>}</div>
      )}
      {!closed && (
        <ul className="mx-list">
          <li><ActRow icon={Users} label="Ask our team to call" sub="The next free person calls right away" onClick={() => setAsk(true)} /></li>
          {lead.stage === 'follow_up' && <li><ActRow icon={Link2} label={lead.linkSent ? 'Booking link sent' : 'Send booking link'} sub="They pick a time on your calendar" disabled={lead.linkSent} onClick={() => { sendBookingLink(lead.id); note(`Booking link sent to ${lead.first_name}`) }} /></li>}
        </ul>
      )}
      <section className="mx-card">
        <h3>What they told us</h3>
        <dl className="mx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <Pending>Consent wording pending</Pending>
      </section>
      <section className="mx-card">
        <h3>Messages and changes</h3>
        <p className="mx-sub">Every text is automatic. Read only.</p>
        <ol className="mx-tl">{events.map(e => (
          <li key={e.id} className={e.state === 'scheduled' ? 'is-later' : ''}><i aria-hidden="true" /><span><b>{e.label}</b><small>{e.by} · {atLabel(e.at, clockNow())}</small>{e.text && <q>{e.text}</q>}</span></li>
        ))}</ol>
      </section>
      <section className="mx-card">
        <h3>Notes</h3>
        {lead.note && <p className="mx-sub">{lead.note}</p>}
        <textarea className="mx-input mx-ta" aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
        {draft.trim() && <button type="button" className="mx-btn is-wide" onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>}
      </section>
      <button type="button" className="mx-btn is-ghost is-wide" onClick={() => setFb(true)}><MessageSquareWarning size={18} aria-hidden="true" />Feedback on how our team handled {lead.first_name}</button>
      <FeedbackDrawer open={fb} lead={lead} onClose={() => setFb(false)} />
      <StatusPicker lead={lead} open={pick} onClose={() => setPick(false)} />
      <ActionSheet open={ask} onClose={() => setAsk(false)} title="Ask our team to call" sub={`${name} · ${lead.phone}`}>
        {ASK_WHY.map(w => <ActRow key={w} icon={Users} label={w} onClick={() => { askTeamToCall(lead.id, w); setAsk(false); note(`Our team calls ${lead.first_name}. You see it here`) }} />)}
      </ActionSheet>
    </Sheet>
  )
}

export default function MLeads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: leads } = useSampleLeads()
  const { data: billing } = useSampleBilling()
  const source = useDataSource()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [find, setFind] = useState(false)
  const [spend, setSpend] = useState(false)
  const laneKey = LANE_ALL.some(l => l.key === params.get('lane')) ? params.get('lane') : 'booked'
  const idx = LANE_ALL.findIndex(l => l.key === laneKey)
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => !n || `${nameOf(l)} ${l.city} ${l.phone}`.toLowerCase().includes(n))
  const inLane = lane => shown.filter(l => agentStatusOf(l) === lane.key && !(lane.key === 'booked' && isLiveCall(l)))
  const pager = useRef(null)
  const tabs = useRef(null)
  const setLane = k => setParams(prev => { const p = new URLSearchParams(prev); p.set('lane', k); return p }, { replace: true })

  // The pager follows the picked status; a swipe picks the status it lands on.
  useLayoutEffect(() => {
    const el = pager.current
    if (!el) return
    const left = idx * el.clientWidth
    if (Math.abs(el.scrollLeft - left) > 4) el.scrollTo({ left, behavior: el.dataset.ready ? 'smooth' : 'instant' })
    el.dataset.ready = '1'
    tabs.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [idx])
  const onScroll = () => {
    const el = pager.current
    clearTimeout(el._t)
    el._t = setTimeout(() => {
      const i = Math.round(el.scrollLeft / el.clientWidth)
      if (LANE_ALL[i] && i !== idx) setLane(LANE_ALL[i].key)
    }, 90)
  }
  const money = usd()

  return (
    <div className="mx-page mx-leads">
      <div className="mx-tools">
        {find
          ? <label className="mx-find"><Search size={18} aria-hidden="true" /><input autoFocus aria-label="Find a lead" placeholder="Name, city or phone" value={q} onChange={e => setQ(e.target.value)} /><button type="button" className="mx-ib" aria-label="Close search" onClick={() => { setQ(''); setFind(false) }}><X size={18} aria-hidden="true" /></button></label>
          : <>
            <button type="button" className="mx-pill" onClick={() => setSpend(true)} aria-label="Change your daily lead spend"><Wallet size={17} aria-hidden="true" /><b className="tp-money">{money(dailyTotal(billing.spend))}</b><small>a day</small><ChevronRight size={16} aria-hidden="true" /></button>
            <span className="tp-grow" />
            <button type="button" className="mx-ib is-soft" aria-label="Find a lead" onClick={() => setFind(true)}><Search size={20} aria-hidden="true" /></button>
          </>}
      </div>

      <LiveStrip leads={shown} compact />

      <div className="mx-stabs" role="tablist" aria-label="Status" ref={tabs}>
        {LANE_ALL.map(l => (
          <button key={l.key} type="button" role="tab" aria-selected={l.key === laneKey} className={`mx-stab is-${l.tone}`} onClick={() => setLane(l.key)}>
            <i aria-hidden="true" />{l.label}<span>{inLane(l).length}</span>
          </button>
        ))}
      </div>
      <p className="mx-explain">{LANE_ALL[idx].explain}</p>

      <div className="mx-pager" ref={pager} onScroll={onScroll} aria-label="Leads by status">
        {LANE_ALL.map(lane => {
          const rows = inLane(lane)
          return (
            <section key={lane.key} className="mx-lane" aria-label={`${lane.label}, ${rows.length}`} aria-hidden={lane.key !== laneKey}>
              {rows.length
                ? <ul className="mx-cards">{rows.map(l => <LeadCard key={l.id} l={l} />)}</ul>
                : <p className="mx-empty">{n ? 'No lead matches that search.' : lane.empty}</p>}
            </section>
          )
        })}
      </div>

      {id && (source === 'sample' || leads.some(l => l.id === id)) && <LeadSheet key={id} id={id} onClose={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(mp.leads(laneKey)))} />}
      <SpendSheet open={spend} onClose={() => setSpend(false)} />
    </div>
  )
}
