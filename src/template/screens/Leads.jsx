import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Search, Wallet, RotateCcw, Clock, MapPin, Check, X, ClipboardCheck, Users, Link2, MessageSquareWarning, PhoneForwarded, Inbox } from 'lucide-react'
import { useDataSource, useSampleLeads, useSampleLead, useSampleBilling, useSampleActions, useSampleSettings } from '../data'
import { Avatar, Chip, Seg, Drawer, Empty, useNote } from '../kit'
import { stageChip, OutcomeDrawer, OutcomePrompt, NoShowUndo } from '../LeadOutcome'
import { RecordDrawer, Stepper, Block } from '../Record'
import { SpendSliders } from '../PlanBuilder'
import { LANES, laneOf } from '../stages'
import { agentCallTask, confirmedByText, atLabel, clockNow } from '../leadLifecycle'
import { agentStatusOf, agentStatus, leadMessages, notInterestedLine, closedReason, needsResult, resultsFor, canMove, isLiveCall, liveCalls, RESULT_LABEL, RESULT_STATUS } from '../agentView'
import { LiveCalls } from '../LiveCall'
import { dailyTotal, openSlotsPerWeek, spendOk, planOf, bandOf } from '../spendPlan'
import { usd } from '../motion'
import { FeedbackDrawer } from '../Talk'
import { CallOrCopy as CallOr } from '../CallOrCopy'
import { paths } from '../paths'
import { FirstRun } from '../DataState'
import '../leads873.css'
import '../p878.css'
import { FilterPills } from '../FilterPills'
import { ReactivateDrawer, ReactivationCards } from '../Reactivate'
import { AddLeadsCard, AddServicingCard } from '../Products955'
import { useProducts } from '../useProducts'

// P898: Leads as a board of the agent's five statuses (agentView.js), left to right: Booked, No show, Follow up, Not
// interested, Sold. P924: no Closed: a lead that never reached the agent (couldn't reach, opted out, wrong number)
// is never on the agent's side. P910: a live transfer isn't a column: it's pinned above the board (LiveCall.jsx) until the agent picks how it
// went, and there are no All / Appointments / Live calls tabs, only the status filters. Leads the team is still calling
// aren't on the board. A lead that needs the agent says so on its card ("Mark
// result"). Never call attempts, the text sequence or where a lead came from. A card opens the lead in a drawer at its
// own URL (paths.lead); the board stays put behind it. On a desktop each lane scrolls inside itself.
const shortWhen = (l, serve = true) => {
  const st = agentStatusOf(l)
  if (st === 'closed') return 'Closed'
  if (l.stage === 'ringing') return 'Now'
  if (isLiveCall(l)) return 'Live call'
  if (st === 'no_show') return 'Rebook link sent'
  if (st === 'not_interested') return notInterestedLine(l)
  if (l.stage === 'sold') return l.submitted ? 'Submitted' : serve ? 'Add details' : 'Sold'
  if (l.stage === 'follow_up' && l.follow) return `Call ${l.follow.split(',')[0]}`
  return l.appt ? l.appt.replace(/, Nov \d+,/, '') : 'No time'
}
const whenOf = l => (l.stage === 'ringing' ? 'Ringing now' : l.stage === 'showed' && !l.apptAt ? 'Live call' : l.stage === 'follow_up' && l.follow ? `Call back ${l.follow}` : l.appt || `Came in ${l.assigned_at}`)
const tagOf = (l, serve = true) => {
  if (l.stage === 'ringing') return ['warn', 'Ringing']
  if (needsResult(l, clockNow())) return ['violet', 'Mark result']
  if (agentCallTask(l)) return ['warn', 'Call them back']
  if (serve && l.stage === 'sold' && !l.submitted) return ['warn', 'Finish details']
  // P952: booked or transferred from one of the agent's old-lead lists.
  if (l.reactivated) return ['green', 'Your own lead']
  if (confirmedByText(l)) return ['blue', 'Confirmed']
  return null
}

function LeadCard({ l, i, onResult }) {
  const live = l.kind === 'live_call'
  const tone = laneOf(l).tone
  const { serve } = useProducts()
  const tag = tagOf(l, serve)
  const result = l.stage !== 'ringing' && needsResult(l, clockNow())
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }} data-stage={l.stage}>
      <Link to={paths.lead(l.id)} className="fx-cover" aria-label={`Open ${l.first_name} ${l.last_name}`} />
      <div className="fx-lcard-top"><span className="fx-kind">{live ? <PhoneIncoming size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}{live ? 'Live call' : 'Appointment'}</span>{tag && <span className="fx-tag">{tag[1]}</span>}</div>
      <h3>{l.first_name} {l.last_name}</h3>
      <p>{l.city}, {l.state} · {l.age_band}</p>
      <div className="fx-lcard-bot">
        <span className="fx-big">{shortWhen(l, serve)}</span>
        {result
          ? <button type="button" className="tp-primary sm fx-accent fx-over" onClick={() => onResult(l)}><ClipboardCheck size={14} />Mark result</button>
          : <Avatar name={`${l.first_name} ${l.last_name}`} tone={tone} />}
      </div>
    </article>
  )
}

// P898: the number with copy (CallOrCopy.jsx, shared with the client drawer). P929: no Call on a desktop (calls go out
// from the agent's phone, P916's phone flow in src/template/m); the number and Copy stay.
const CallOrCopy = ({ lead, closed }) => <CallOr phone={lead.phone} target={null} closed={closed} />

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
        <span className="lc-ev-h"><b>{e.label}</b>{later && <span className="lc-sched">{e.kind === 'text_sent' ? 'Planned' : 'Next'}</span>}</span>
        <span className="lc-ev-by">{e.by} · {atLabel(e.at, clockNow())}</span>
        {isText && <div className={`tp-bub lc-bub${theirs ? '' : ' me'}`}>{e.text}{!theirs && <small>Automatic · preview, sends when your leads go live</small>}{theirs && <small>From {lead.first_name}</small>}</div>}
        {e.kind === 'call_task' && <span className={`lc-task is-${e.task === 'you' ? 'you' : 'team'}`}>{e.task === 'you' ? 'For you' : 'For our team'}</span>}
        {e.audit && <span className="lc-task is-audit">Kept on the record</span>}
      </div>
    </li>
  )
}

// P949: also the pop-up a booking opens on Calendar (`extra` = the calendar's own buttons, e.g. Can't make it).
export function LeadDrawer({ id, onClose, extra = null }) {
  const { data: lead } = useSampleLead(id)
  const { serve } = useProducts()
  const { moveLead, addLeadNote, askTeamToCall, sendBookingLink, rebookLead } = useSampleActions()
  const source = useDataSource()
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
  // P894: the drawer's buttons are the results this lead's status allows, nothing else.
  const steps = resultsFor(lead).map(k => ({ key: k, label: RESULT_LABEL[k], tone: agentStatus(RESULT_STATUS[k]).tone })) // P929: board colours
  const chip = stageChip(lead.stage, lead, { noServicing: !serve })
  const asks = [['Mortgage balance', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner ? 'Yes' : 'No'], ['Smoker', lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone]]
  const pick = k => (k === 'booked' ? (moveLead(lead.id, 'booked'), note(`${name} moved to Booked`)) : setOutcome(k))
  const status = agentStatusOf(lead)
  const events = leadMessages(lead)
  const closed = lane.key === 'closed'
  const task = agentCallTask(lead)
  return (
    <RecordDrawer label={name} kicker={`Lead · came in ${lead.created}`} tone={lane.tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{whenOf(lead)}</span><Chip tone={chip[0]}>{chip[1]}</Chip></div>
        <h2>{name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{lead.city}, {lead.state} · {lead.kind === 'live_call' ? 'Live call' : 'Appointment'}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big">{lead.mortgage_balance_band.replace(' to ', '–')}</b><Avatar name={name} tone={lane.tone} /></div>
      </>}
      stepper={steps.length ? <Stepper label="Pick the result" steps={steps} current={null} onPick={pick} /> : null}
      actions={<>
        <CallOrCopy lead={lead} closed={closed} />
        <button type="button" className="tp-btn ov-ghost" disabled={closed} onClick={() => setPanel('team')}><Users size={14} />Ask our team to call</button>
        {lead.stage === 'follow_up' && <button type="button" className="tp-btn ov-ghost" disabled={lead.linkSent} onClick={() => { sendBookingLink(lead.id); note(`Booking link sent. ${lead.first_name} picks a time on your calendar`) }}><Link2 size={14} />{lead.linkSent ? 'Link sent' : 'Send booking link'}</button>}
        {extra}
        <span className="tp-grow" />
        {canMove(lead, 'sold') && <button type="button" className={`tp-btn is-res is-${agentStatus('sold').tone}`} onClick={() => setOutcome('sold')}><Check size={14} />Sold</button>}
        {canMove(lead, 'not_interested') && <button type="button" className={`tp-btn is-res is-${agentStatus('not_interested').tone}`} onClick={() => setOutcome('not_interested')}><X size={14} />Not interested</button>}
      </>}>
      <NoShowUndo lead={lead} />
      {task && <div className="lc-nudge is-static"><PhoneForwarded size={16} aria-hidden="true" /><span className="tp-grow"><b>{lead.first_name} asked you to call</b><small>{'“'}{lead.reply.text}{'”'} We told them someone calls shortly.</small></span><span className="lc-nudge-go">Call from your phone</span></div>}
      {needsResult(lead, clockNow()) && <button type="button" className="lc-nudge" onClick={() => setPrompt(true)}><ClipboardCheck size={16} aria-hidden="true" /><span className="tp-grow"><b>How did it go?</b><small>{isLiveCall(lead) ? 'You took the live call. Pick the result' : `The appointment at ${lead.appt} has passed`}</small></span><span className="lc-nudge-go">Mark result</span></button>}
      {serve && lead.stage === 'sold' && !lead.submitted && <Link to={paths.submit(lead.id)} className="fx-nudge">Finish the servicing details. The team takes it from there.</Link>}
      {closed && <p className="lc-closed"><b>{closedReason(lead)}.</b> {lead.stage === 'opted_out' ? 'All calls and texts stopped.' : 'No more calls or texts.'} A reply from them brings them back as a new lead.</p>}
      {status === 'team' && <p className="lc-closed">Our team is calling {lead.first_name}. Nothing for you to do yet: they land on Booked.</p>}
      {status === 'no_show' && !lead.undo && <div className="lc-closed"><p><b>No show{lead.appt ? ` at ${lead.appt}` : ''}.</b> We sent {lead.first_name} a one-tap link to rebook. If they haven’t picked a time, our AI caller calls them to book again. When they rebook, they go back to Booked on your calendar.</p>
        {source === 'sample' && <button type="button" className="tp-btn ov-ghost sm" onClick={() => { rebookLead(lead.id); note(`${lead.first_name} picked a new time. Back on Booked`) }}>Sample: they pick a new time</button>}</div>}
      <Block title="What they told us">
        <dl className="fx-facts">{asks.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      <Block title="Messages" sub="The texts sent to and from them">
        {events.length
          ? <ol className="tp-tl fx-tl lc-tl">{events.map((e, i) => <Row key={e.id || i} e={e} lead={lead} last={i === events.length - 1} />)}</ol>
          : <p className="fx-calm" data-empty="messages">No messages yet.</p>}
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

// P917 (P968: now every block above the status pills): the status columns never shrink for the live-call cards. On a desktop the Leads page holds still at the window's
// height and the lanes scroll inside; this hands the cards' height to the page (--lc-live-h on <html>, leads873.css) so
// the window grows by exactly that much and scrolls, like Clients. When the cards go away the board keeps its size.
function useLiveRoom() {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement
    if (!el) return undefined
    const set = () => {
      const h = el.getBoundingClientRect().height
      const gap = h > 0 ? parseFloat(getComputedStyle(el.parentElement).rowGap) || 0 : 0 // the page's gap under the cards
      root.style.setProperty('--lc-live-h', `${h + gap}px`)
    }
    set()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--lc-live-h') }
  }, [])
  return ref
}

export default function Leads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: leads } = useSampleLeads()
  const source = useDataSource()
  const { data: billing } = useSampleBilling()
  const [q, setQ] = useState('')
  const [spend, setSpend] = useState(false)
  const [params, setParams] = useSearchParams()
  // P955: ?react=1 (Billing → Start a reactivation list) opens Import leads. Without Leads, no daily spend here.
  const [react, setReact] = useState(() => params.get('react') === '1')
  const { has } = useProducts()
  const closeReact = () => { setReact(false); if (params.get('react')) { const p = new URLSearchParams(params); p.delete('react'); setParams(p, { replace: true }) } }
  // P924: no Closed on Leads. A lead that never reached the agent is never on their side (useSampleLeads).
  const ALL = LANES
  const laneKey = ALL.some(l => l.key === params.get('lane')) ? params.get('lane') : 'all'
  const setLane = k => setParams(k === 'all' ? {} : { lane: k }, { replace: true })
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => !n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n))
  const live = liveCalls(shown)
  const liveRef = useLiveRoom()
  const inLane = (lane, l) => agentStatusOf(l) === lane.key
  const result = l => navigate(`${paths.lead(l.id)}?outcome=1`)
  const lanes = laneKey === 'all' ? ALL : ALL.filter(l => l.key === laneKey)
  const money = usd()
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <span className="tp-grow" />
        {/* P952: bring a list of old leads; our AI calls them (Reactivate.jsx) */}
        <button type="button" className="fx-pillbtn" onClick={() => setReact(true)}><RotateCcw size={15} aria-hidden="true" />Import leads</button>
        {has('leads') && <button type="button" className="fx-pillbtn" aria-label="Change your daily lead spend" onClick={() => setSpend(true)}><Wallet size={15} aria-hidden="true" /><b className="tp-money">{money(dailyTotal(billing.spend))}</b><small>a day</small></button>}
      </div>

      {/* P968: everything above the status pills (imported lists, Add cards, live calls) sits in one block whose height is
          handed to the page (useLiveRoom), so the stage columns below keep their full height and the window scrolls */}
      <div ref={liveRef} className="lc-above">
        <ReactivationCards />
        <AddLeadsCard compact />
        <AddServicingCard leads={leads} />
        {/* P910: live calls pinned on top, ringing first, each with Sold · Follow up · Not interested. P917: the board
            keeps its full size below them and the page scrolls */}
        <div className="lc-live"><LiveCalls calls={live} /></div>
      </div>

      {/* P893: each status pill in its own colour with its count, like the Clients page; the picked one goes darker */}
      <FilterPills label="Status" value={laneKey} onChange={setLane} items={[{ key: 'all', label: 'All', count: shown.filter(x => ALL.some(l => inLane(l, x))).length }, ...ALL.map(l => ({ key: l.key, label: l.label, tone: l.tone, count: shown.filter(x => inLane(l, x)).length }))]} />
      {laneKey !== 'all' && <p className="lc-explain">{ALL.find(l => l.key === laneKey).explain}</p>}

      {leads.length === 0 && <FirstRun icon={Inbox} title="Your leads show here" sub="Each lead lands here the moment it comes in. Our team calls it right away, books it on your calendar or rings you live, and you see every step." />}
      <div className={`fx-board lc-board${lanes.length === 1 ? ' is-one' : ''}`} style={{ '--lanes': lanes.length }} role="region" aria-label="Leads by stage">
        {lanes.map((lane, li) => {
          const rows = shown.filter(l => inLane(lane, l))
          return (
            <section key={lane.key} className={`fx-lane is-${lane.tone}`} style={{ '--i': li }} aria-label={`${lane.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{lane.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} i={card++} onResult={result} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No lead matches that search.' : lane.empty} />}
              </div>
            </section>
          )
        })}
      </div>

      {id && (source === 'sample' || leads.some(l => l.id === id)) && <LeadDrawer id={id} onClose={() => navigate(paths.leads())} />}
      <SpendDrawer open={spend} onClose={() => setSpend(false)} />
      <ReactivateDrawer open={react} onClose={closeReact} />
    </div>
  )
}

// The daily lead spend, from the Leads page: the same sliders as Billing. Sample only, nothing is charged.
function SpendDrawer({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setSpend } = useSampleActions()
  const note = useNote()
  const [spend, setDraft] = useState({ daily: dailyTotal(billing.spend) })
  return (
    <Drawer open={open} onClose={onClose} title="Daily lead spend" sub="A change starts tomorrow at 12:00 AM your time"
      footer={<button type="button" className="tp-primary fx-accent" disabled={!spendOk(billing.plan, spend)} onClick={() => { setSpend(spend); note('Lead spend saved. Starts tomorrow. Sample only, nothing was charged'); onClose() }}>Save lead spend</button>}>
      <SpendSliders spend={spend} onSpend={setDraft} plan={billing.plan} mode="both" id="leads-spend" openSlots={openSlotsPerWeek(settings.week)} band={{ tier: planOf(billing), ...bandOf(planOf(billing)) }} />
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
