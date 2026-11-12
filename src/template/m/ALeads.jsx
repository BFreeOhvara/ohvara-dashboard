import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Upload, Users, Link2, PhoneForwarded, ChevronRight, MessageSquareWarning, StickyNote, CalendarX } from 'lucide-react'
import { useSampleLeads, useSampleLead, useSampleActions, useSampleBilling, useSampleAppointments, useDataSource } from '../data'
import { CantMakeIt } from '../screens/Calendar'
import { useNote } from '../kit'
import { NoShowUndo } from '../LeadOutcome'
import { FeedbackDrawer } from '../Talk'
import { agentStatusOf, leadMessages, resultsFor, isLiveCall, liveAt, notInterestedLine } from '../agentView'
import { agentCallTask, atLabel, clockNow, timeLabel } from '../leadLifecycle'
import { dailyTotal, deliveredOf } from '../spendPlan'
import { usd } from '../motion'
import { paths } from '../paths'
import { targetOf } from '../../lib/deedstoneCall'
import { DeedstoneCallButton } from '../DeedstoneCall'
import { AddLeadsCard, AddServicingCard } from '../Products955'
import { useProducts } from '../useProducts'
import { useStretchPill } from '../../hooks/useStretchPill'
import { useApp, SubPage, Toggle, Ini, CallButton, BottomSheet, rise } from './AppKit'
import { STAGES, TONE, TAG, stageOf, inStage } from './appModel'

// P967 — Leads: four stages (To mark · Booked · Follow up · Sold), a sliding highlight in each stage's colour, a
// one-line hint, and every lead a full card in its stage's colour. Mark opens How did it go?. Sold has Show closed
// (no shows and not sold, in grey). A lead opens as its own screen: a coloured hero, their text, what they told us,
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
// Old lane links (?lane=no_show, …) land on the stage that holds them.
const LANE_TO = { booked: 'booked', follow: 'follow', sold: 'sold', no_show: 'sold', not_interested: 'sold', mark: 'mark' }

export default function ALeads() {
  const app = useApp()
  const { data: leads } = useSampleLeads()
  const { data: bill } = useSampleBilling()
  const { has } = useProducts()
  const money = usd()
  const [params, setParams] = useSearchParams()
  const [closed, setClosed] = useState(() => ['no_show', 'not_interested'].includes(params.get('lane')))
  const now = clockNow()
  const staged = useMemo(() => leads.map(l => ({ l, stage: stageOf(l, now) })).filter(x => x.stage), [leads, now])
  const counts = Object.fromEntries(STAGES.map(s => [s.key, staged.filter(x => x.stage === s.key).length]))
  const fromUrl = LANE_TO[params.get('stage') || params.get('lane')]
  const stage = fromUrl || (counts.mark ? 'mark' : 'booked')
  const info = STAGES.find(s => s.key === stage)
  const rows = staged.filter(x => inStage(x.stage, stage, closed))
  const pick = k => setParams(prev => { const p = new URLSearchParams(prev); p.set('stage', k); p.delete('lane'); return p }, { replace: true })
  const seg = useRef(null)
  useStretchPill(seg, { activeKey: stage, selector: 'button.is-on' })
  const dl = deliveredOf({ booked: bill.booked, live: bill.live || 0 })

  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise">
        <span className="ma-grow"><h1>Leads</h1><small>{dl.total} sent to you this week</small></span>
        <button type="button" className="ma-chip is-solid ma-press" onClick={() => app.openSub('import')}><Upload size={16} aria-hidden="true" />Import</button>
        {has('leads') && <button type="button" className="ma-chip ma-press" onClick={() => app.open(paths.billing())}><span className="tp-money">{money(dailyTotal(bill.spend))}</span>/day</button>}
      </div>

      <div className="ma-seg is-stages ma-rise" style={rise(0)} role="tablist" aria-label="Lead stages" ref={seg}>
        {STAGES.map(s => (
          <button key={s.key} type="button" role="tab" aria-selected={stage === s.key} className={`is-${TONE[s.key]}${stage === s.key ? ' is-on' : ''}`} onClick={() => pick(s.key)}>
            {s.label} <span>{counts[s.key]}</span>
          </button>
        ))}
      </div>
      <div className="ma-hintrow ma-rise" style={rise(1)}>
        <p>{info.hint}</p>
        {stage === 'sold' && <label className="ma-closed">Show closed<Toggle small tone="sage" on={closed} label="Show closed leads" onChange={setClosed} /></label>}
      </div>

      <ul className="ma-cards ma-rise" style={rise(2)} key={`${stage}-${closed}`}>
        {rows.map(({ l, stage: st }, i) => (
          <li key={l.id} className={`ma-lead is-${TONE[st]}`} style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
            <Link to={paths.lead(l.id)} state={{ tab: 'leads' }} className="ma-lead-open">
              <Ini name={nameOf(l)} />
              <span className="ma-grow"><b>{nameOf(l)}</b><small className="is-when">{whenOf(l, st)}</small><small>{placeOf(l)}</small></span>
            </Link>
            {st === 'mark'
              ? <button type="button" className="ma-mark ma-press" onClick={() => app.markLead(l)}>Mark</button>
              : <span className="ma-tag">{TAG[st]}</span>}
          </li>
        ))}
      </ul>
      {!rows.length && <p className="ma-empty">{info.empty}</p>}
      <AddLeadsCard compact className="ma-suggest" />
      <AddServicingCard leads={leads} className="ma-suggest" />
    </div>
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
