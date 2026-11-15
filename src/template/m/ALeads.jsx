import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Upload, Users, Link2, PhoneForwarded, ChevronRight, MessageSquareWarning, StickyNote, CalendarX, Search, X, PhoneIncoming } from 'lucide-react'
import { useSampleLeads, useSampleLead, useSampleActions, useSampleBilling, useSampleAppointments, useDataSource, useSampleSettings } from '../data'
import { whenBoth, theirTime } from './zoneTime'
import { CantMakeIt } from '../screens/Calendar'
import { useNote } from '../kit'
import { NoShowUndo } from '../LeadOutcome'
import { FeedbackDrawer } from '../Talk'
import { agentStatusOf, leadMessages, resultsFor, isLiveCall, liveAt, liveCalls, liveFacts, notInterestedLine } from '../agentView'
import { agentCallTask, atLabel, clockNow, timeLabel, dayLabel } from '../leadLifecycle'
import { dailyTotal, deliveredOf, openSlotsPerWeek, spendOk, planOf, bandOf } from '../spendPlan'
import { SpendSliders } from '../PlanBuilder'
import { ReactivationCards } from '../Reactivate'
import { usd } from '../motion'
import { paths } from '../paths'
import { targetOf } from '../../lib/deedstoneCall'
import { DeedstoneCallButton } from '../DeedstoneCall'
import { AddLeadsCard, AddServicingCard } from '../Products955'
import { useProducts } from '../useProducts'
import { useStretchPill } from '../../hooks/useStretchPill'
import { useApp, SubPage, Ini, CallButton, BottomSheet, rise } from './AppKit'
import { TONE, TAG, stageOf } from './appModel'
import { LANES, LANE_TONE, LANE_FROM, laneOfLead, leadMatches } from './p1002'
import './p1002.css'
import './p1015.css'
import { useEdgeFade } from './useEdgeFade'

// P967 — Leads: a sliding highlight in each lane's colour, a one-line hint, and every lead a full card in its colour.
// P1002: the lanes are the desktop's five (Booked · No show · Follow up · Not interested · Sold); live calls and imported
// lists are pinned above them, and there is a search and the daily spend sheet. Mark opens How did it go?.
// A lead opens as its own screen: a coloured hero, their text, what they told us,
// what happened, and Call / How did it go? at the bottom.
const nameOf = l => `${l.first_name} ${l.last_name}`
const placeOf = l => [[l.city, l.state].filter(Boolean).join(', '), l.age_band].filter(Boolean).join(' · ')
const timeOf = at => (at && at.length >= 16 ? timeLabel(at) : '')

export function whenOf(l, stage) {
  if (l.stage === 'ringing') return 'Live call · ringing now'
  if (stage === 'mark') return isLiveCall(l) ? `Live call${timeOf(liveAt(l)) ? ` · ${timeOf(liveAt(l))}` : ''}` : `Booked call · ${l.appt || 'time passed'}`
  if (stage === 'booked') return l.appt || 'Booked'
  if (stage === 'follow') return l.follow ? `Call back ${l.follow}` : 'Call back · you pick the time'
  if (stage === 'sold') return 'Sold'
  if (agentStatusOf(l) === 'no_show') return `No show${l.appt ? ` · ${l.appt}` : ''} · rebook text sent`
  return notInterestedLine(l).replace('Not interested', 'Not sold')
}

export default function ALeads() {
  const app = useApp()
  const { data: leads } = useSampleLeads()
  const { data: bill } = useSampleBilling()
  const { has } = useProducts()
  const money = usd()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [spend, setSpend] = useState(false)
  const now = clockNow()
  // P1002: the desktop's five lanes (Booked · No show · Follow up · Not interested · Sold). A lead that needs its result
  // sits in Booked with its Mark button; live calls and imported lists are pinned above the lanes, as on the desktop.
  const shown = useMemo(() => leads.filter(l => leadMatches(l, q)), [leads, q])
  const live = useMemo(() => liveCalls(shown), [shown])
  const staged = useMemo(() => shown.map(l => ({ l, lane: laneOfLead(l), stage: stageOf(l, now) })).filter(x => x.lane), [shown, now])
  const counts = Object.fromEntries(LANES.map(s => [s.key, staged.filter(x => x.lane === s.key).length]))
  const lane = LANE_FROM[params.get('stage') || params.get('lane')] || 'booked'
  const info = LANES.find(s => s.key === lane)
  const rows = staged.filter(x => x.lane === lane).sort((a, b) => (b.stage === 'mark') - (a.stage === 'mark'))
  const pick = k => setParams(prev => { const p = new URLSearchParams(prev); p.set('stage', k); p.delete('lane'); return p }, { replace: true })
  const seg = useRef(null)
  const { fade, onScroll } = useEdgeFade(seg, [lane]) // P1015: a soft fade on the side with more lanes
  useStretchPill(seg, { activeKey: lane, selector: 'button.is-on' })
  useEffect(() => {
    // Scroll the lane strip only: scrollIntoView would also slide the whole page strip (.ma-viewport) sideways.
    const box = seg.current, on = box?.querySelector('button.is-on')
    if (box && on) box.scrollLeft = Math.max(0, on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2)
  }, [lane])
  const dl = deliveredOf({ booked: bill.booked, live: bill.live || 0 })

  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise">
        <span className="ma-grow"><h1>Leads</h1><small>{dl.total} sent to you this week</small></span>
        <button type="button" className="ma-chip is-solid ma-press" onClick={() => app.openSub('import')}><Upload size={16} aria-hidden="true" />Import</button>
        {has('leads') && <button type="button" className="ma-chip ma-press" aria-label="Change your daily lead spend" onClick={() => setSpend(true)}><span className="tp-money">{money(dailyTotal(bill.spend))}</span>/day</button>}
      </div>

      <label className="ma-search is-small ma-rise" style={rise(0)}><Search size={18} aria-hidden="true" /><input type="search" aria-label="Find a lead" placeholder="Find by name, city or phone" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>

      {/* P1002: pinned above the lanes, as on the desktop: imported lists, then live calls */}
      <div className="ma-embed ma-pinned"><ReactivationCards /></div>
      {live.length > 0 && (
        <section className="ma-live" aria-label={`Live calls, ${live.length}`}>
          {live.map(l => <LiveCard key={l.id} l={l} />)}
        </section>
      )}

      <div className={`ma-seg is-stages is-lanes ma-rise${fade}`} style={rise(1)} role="tablist" aria-label="Lead status" ref={seg} onScroll={onScroll}>
        {LANES.map(s => (
          <button key={s.key} type="button" role="tab" aria-selected={lane === s.key} className={`is-${LANE_TONE[s.key]}${lane === s.key ? ' is-on' : ''}`} onClick={() => pick(s.key)}>
            {s.label} <span>{counts[s.key]}</span>
          </button>
        ))}
      </div>
      <div className="ma-hintrow ma-rise" style={rise(1)}>
        <p>{info.explain}</p>
      </div>

      <ul className="ma-cards ma-rise" style={rise(2)} key={lane}>
        {rows.map(({ l, stage: st }, i) => {
          const tone = st === 'mark' ? TONE.mark : LANE_TONE[lane]
          return (
            <li key={l.id} className={`ma-lead is-${tone}`} style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
              <Link to={paths.lead(l.id)} state={{ tab: 'leads' }} className="ma-lead-open">
                <Ini name={nameOf(l)} />
                <span className="ma-grow"><b>{nameOf(l)}</b><small className="is-when">{whenOf(l, st)}</small><small>{placeOf(l)}</small></span>
              </Link>
              {st === 'mark'
                ? <button type="button" className="ma-mark ma-press" onClick={() => app.markLead(l)}>Mark</button>
                : <span className="ma-tag">{st === 'lost' ? info.label : TAG[st] || info.label}</span>}
            </li>
          )
        })}
      </ul>
      {!rows.length && <p className="ma-empty">{q.trim() ? 'No lead matches that search.' : info.empty}</p>}
      <AddLeadsCard compact className="ma-suggest" />
      <AddServicingCard leads={leads} className="ma-suggest" />

      <SpendSheet open={spend} onClose={() => setSpend(false)} />
    </div>
  )
}

// P1002: a live call, pinned above the lanes until the agent picks how it went (desktop LiveCall.jsx): what the AI
// collected, and one button that opens the same result sheet as Mark.
function LiveCard({ l }) {
  const app = useApp()
  const ringing = l.stage === 'ringing'
  const at = liveAt(l)
  const when = ringing ? 'Ringing now' : at ? (at.slice(0, 10) === clockNow().slice(0, 10) ? `Today, ${timeLabel(at)}` : `${dayLabel(at)}, ${timeLabel(at)}`) : 'Live call'
  return (
    <article className={`ma-livecard is-sky${ringing ? ' is-ringing' : ''}`} aria-label={`Live call, ${nameOf(l)}`}>
      <header><span className="ma-livecard-k"><PhoneIncoming size={15} aria-hidden="true" />Live call</span><span className="ma-livecard-w">{ringing && <i aria-hidden="true" />}{when}</span></header>
      <h3><Link to={paths.lead(l.id)} state={{ tab: 'leads' }}>{nameOf(l)}</Link></h3>
      <dl>{liveFacts(l).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <button type="button" className="ma-btn is-white is-tall ma-press" onClick={() => app.markLead(l)}>How did it go?</button>
    </article>
  )
}

// P1002: the daily lead spend from Leads (desktop SpendDrawer): the same sliders as Billing. Sample only, nothing is
// charged.
function SpendSheet({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setSpend } = useSampleActions()
  const note = useNote()
  const [spend, setDraft] = useState({ daily: dailyTotal(billing.spend) })
  return (
    <BottomSheet open={open} onClose={onClose} label="Daily lead spend" tall className="ma-spendsheet">
      <p className="ma-sheet-t">Daily lead spend</p>
      <p className="ma-sheet-s">A change starts tomorrow at 12:00 AM your time</p>
      <div className="ma-embed">
        <SpendSliders spend={spend} onSpend={setDraft} plan={billing.plan} mode="both" id="leads-spend" openSlots={openSlotsPerWeek(settings.week)} band={{ tier: planOf(billing), ...bandOf(planOf(billing)) }} />
      </div>
      <button type="button" className="ma-btn is-solid is-tall is-grow ma-press" disabled={!spendOk(billing.plan, spend)} onClick={() => { setSpend(spend); note('Lead spend saved. Starts tomorrow. Sample only, nothing was charged'); onClose() }}>Save lead spend</button>
    </BottomSheet>
  )
}

// P974: servicing-only agents have Clients in the bar; Leads opens from Account as a screen of its own.
export function ALeadsSub() {
  return <SubPage bare title="Leads" className="is-leads"><ALeads /></SubPage>
}

// ── One lead ──────────────────────────────────────────────────────────────────────────────────────────────────
const ASK_WHY = ['I can’t reach them', 'They want a different time', 'Check their details', 'Something else']
export function ALead({ id }) {
  const source = useDataSource()
  const { data: leads } = useSampleLeads()
  if (source !== 'sample' && !leads.some(l => l.id === id)) return <SubPage title="Lead"><p className="ma-empty">This lead isn’t yours, or it’s gone.</p></SubPage>
  return <LeadScreen id={id} />
}

function LeadScreen({ id }) {
  const app = useApp()
  const { data: lead } = useSampleLead(id)
  const { serve } = useProducts()
  const { addLeadNote, askTeamToCall, sendBookingLink, callBack, rebookLead } = useSampleActions()
  const source = useDataSource()
  const note = useNote()
  const [fb, setFb] = useState(false)
  const [ask, setAsk] = useState(false)
  const [draft, setDraft] = useState('')
  const [cant, setCant] = useState(false)
  const { data: appts } = useSampleAppointments()
  const { data: zoneSet } = useSampleSettings() // P989: the lead's own time beside yours
  const now = clockNow()
  const st = stageOf(lead, now) || 'booked'
  const status = agentStatusOf(lead)
  const name = nameOf(lead)
  const first = lead.first_name
  const canPick = resultsFor(lead).length > 0
  const task = agentCallTask(lead)
  const closed = status === 'closed'
  const said = lead.reply?.text || lead.text || ''
  const events = leadMessages(lead)
  const facts = [['Mortgage', lead.mortgage_balance_band], ['Age', lead.age_band], ['Homeowner', lead.homeowner == null ? null : lead.homeowner ? 'Yes' : 'No'],
    ['Smoker', lead.smoker == null ? null : lead.smoker ? 'Yes' : 'No'], ['Best time', lead.best_time], ['Phone', lead.phone], ['Wants', lead.wants]].filter(([, v]) => v != null && String(v).trim())
  const kind = lead.stage === 'ringing' || isLiveCall(lead) || lead.kind === 'live_call' ? 'Live call' : lead.stage === 'follow_up' ? 'Follow-up call' : 'Booked call'
  const tag = st === 'mark' ? 'Needs your result' : TAG[st]
  const appt = appts.find(a => a.kind !== 'client' && a.ref === lead.id)
  const foot = closed ? null : <>
    <CallButton className="ma-btn is-solid is-grow is-tall" phone={lead.rawPhone || lead.phone} to={targetOf('lead', lead)} label={`Call ${first}`} />
    {canPick && <button type="button" className="ma-btn is-white is-grow is-tall ma-press" onClick={() => app.markLead(lead)}>How did it go?</button>}
  </>
  return (
    <SubPage title={name} line={`Came in ${lead.created || lead.came || ''}`.trim()} foot={foot}>
      <div className={`ma-hero is-${TONE[st]} ma-rise`}>
        <i className="ma-glow" aria-hidden="true" />
        <div className="ma-hero-top"><span>{kind}</span><span className="ma-tag">{tag}</span></div>
        <b>{st === 'mark' || st === 'booked' ? (lead.appt || whenOf(lead, st)) : whenOf(lead, st)}</b>
        {(st === 'mark' || st === 'booked') && appt && theirTime(appt, zoneSet?.timeZone) && <span className="ma-hero-place">{whenBoth(appt, zoneSet?.timeZone)}</span>}
        <span className="ma-hero-place">{placeOf(lead)}</span>
      </div>

      <NoShowUndo lead={lead} />
      {task && (
        <DeedstoneCallButton target={targetOf('lead', lead)} className="ma-nudge is-apricot ma-press" onCall={() => callBack(lead.id)}>
          <PhoneForwarded size={18} aria-hidden="true" /><span className="ma-grow"><b>{first} asked you to call</b>{lead.reply?.text && <small>“{lead.reply.text}”</small>}</span><ChevronRight size={18} aria-hidden="true" />
        </DeedstoneCallButton>
      )}
      {serve && lead.stage === 'sold' && !lead.submitted && <Link to={paths.submit(lead.id)} className="ma-nudge is-sage ma-press"><span className="ma-grow"><b>Finish the servicing details</b><small>Our team takes it from there</small></span><ChevronRight size={18} aria-hidden="true" /></Link>}
      {status === 'team' && <p className="ma-card-note">Our team is calling {first}. Nothing for you to do yet: they land on Booked.</p>}
      {status === 'no_show' && !lead.undo && (
        <div className="ma-card-note"><b>No show{lead.appt ? ` at ${lead.appt}` : ''}.</b> We sent {first} a one-tap link to rebook. If they haven’t picked a time, our AI caller calls them to book again.
          {source === 'sample' && <button type="button" className="ma-btn is-soft ma-press" onClick={() => { rebookLead(lead.id); note(`${first} picked a new time. Back on Booked`) }}>Sample: they pick a new time</button>}
        </div>
      )}

      {said && !task && (
        <div className="ma-said">
          <span className="ma-said-ic" aria-hidden="true">“</span>
          <span><b>{first} texted</b><span>{said}</span></span>
        </div>
      )}

      <section className="ma-glass ma-pad">
        <p className="ma-sec-t">What they told us</p>
        <dl className="ma-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="ma-glass ma-pad">
        <p className="ma-sec-t">What happened</p>
        {events.length
          ? <ol className="ma-tl">{events.map((e, i) => <li key={e.id || i}><i aria-hidden="true" className={i === events.length - 1 ? `is-${TONE[st]}` : ''} /><span><b>{e.label}</b><small>{[e.by, atLabel(e.at, now)].filter(Boolean).join(' · ')}</small>{e.text && <q>{e.text}</q>}</span></li>)}</ol>
          : <p className="ma-muted">Nothing yet.</p>}
      </section>

      {!closed && (
        <div className="ma-glass ma-list">
          <button type="button" className="ma-row" onClick={() => setAsk(true)}><span className="ma-sym is-sky"><Users size={17} aria-hidden="true" /></span><span className="ma-grow"><b>Ask our team to call</b><small>The next free person calls right away</small></span><ChevronRight size={18} className="ma-chev" aria-hidden="true" /></button>
          {lead.stage === 'follow_up' && <button type="button" className="ma-row" disabled={lead.linkSent} onClick={() => { sendBookingLink(lead.id); note(`Booking link sent to ${first}`) }}><span className="ma-sym is-butter"><Link2 size={17} aria-hidden="true" /></span><span className="ma-grow"><b>{lead.linkSent ? 'Booking link sent' : 'Send booking link'}</b><small>They pick a time on your calendar</small></span></button>}
          {st === 'booked' && appt && <button type="button" className="ma-row" onClick={() => setCant(true)}><span className="ma-sym is-apricot"><CalendarX size={17} aria-hidden="true" /></span><span className="ma-grow"><b>Can’t make it</b><small>We move {first} to another time</small></span><ChevronRight size={18} className="ma-chev" aria-hidden="true" /></button>}
          <button type="button" className="ma-row" onClick={() => setFb(true)}><span className="ma-sym is-stone"><MessageSquareWarning size={17} aria-hidden="true" /></span><span className="ma-grow"><b>Feedback on our team</b><small>How we handled {first}</small></span><ChevronRight size={18} className="ma-chev" aria-hidden="true" /></button>
        </div>
      )}

      <section className="ma-glass ma-pad">
        <p className="ma-sec-t"><StickyNote size={16} aria-hidden="true" />Notes</p>
        {lead.note && <p className="ma-muted">{lead.note}</p>}
        <textarea className="ma-input is-area" aria-label="Add a note" placeholder="Add a note" value={draft} onChange={e => setDraft(e.target.value)} />
        {draft.trim() && <button type="button" className="ma-btn is-solid ma-press" onClick={() => { addLeadNote(lead.id, draft.trim()); setDraft(''); note('Note saved') }}>Save note</button>}
      </section>

      {cant && appt && <CantMakeIt appt={appt} lead={lead} onClose={() => setCant(false)} />}
      <FeedbackDrawer open={fb} lead={lead} onClose={() => setFb(false)} />
      <BottomSheet open={ask} onClose={() => setAsk(false)} label="Ask our team to call">
        <p className="ma-sheet-t">Ask our team to call</p>
        <p className="ma-sheet-s">{name} · {lead.phone}</p>
        {ASK_WHY.map(w => <button key={w} type="button" className="ma-pick" onClick={() => { askTeamToCall(lead.id, w); setAsk(false); note(`Our team calls ${first}. You see it here`) }}><span className="ma-pick-ic is-sky" aria-hidden="true"><Users size={18} /></span><span className="ma-grow"><b>{w}</b></span></button>)}
      </BottomSheet>
    </SubPage>
  )
}
