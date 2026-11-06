import { useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { Search, PhoneIncoming, CalendarCheck, PhoneForwarded, MapPin, Clock, Shuffle, Check } from 'lucide-react'
import { useAdmLeads, useAdmAgents, useAdmActions, useAdmViewAs } from '../data'
import { Avatar, Chip, Empty, Seg, useNote } from '../../template/kit'
import { RecordDrawer, Block, Stepper } from '../../template/Record'
import { Dropdown, DField } from '../kit'
import { ap } from '../paths'
import { LEAD_LANES, STAGE_WORD, KIND_WORD, stageTone } from '../words'

// P849 — Leads (the inbounds page, on screen as Leads): every lead across every agent this week on one board, in
// stage colours: Needs routing (no agent yet, missed transfers), Booked, Transferred, Sold, Not sold. A card opens the
// lead at /admin/inbounds/:id, where an admin routes it to an agent or moves its stage. Jordan's login sees it read
// only. Sample only: nothing is routed or dialled for real.
const KIND_ICON = { appointment: CalendarCheck, live: PhoneForwarded }
const STEPS = [{ key: 'booked', label: 'Booked' }, { key: 'transferred', label: 'Transferred' }, { key: 'sold', label: 'Sold' }, { key: 'not_sold', label: 'Not sold' }]

function LeadCard({ l, i }) {
  const tone = stageTone(l.stage)
  const Icon = KIND_ICON[l.kind]
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }}>
      <Link to={ap('leads', l.id)} className="fx-cover" aria-label={`Open ${l.name}`} />
      <div className="fx-lcard-top"><span className="fx-kind"><Icon size={13} aria-hidden="true" />{KIND_WORD[l.kind]}</span>{l.stage === 'missed' && <span className="fx-tag">Missed</span>}</div>
      <h3>{l.name}</h3>
      <p>{l.product} · {l.city}, {l.state}</p>
      <div className="fx-lcard-bot"><span className="fx-big">{l.agent ? l.agent.split(' ')[0] : 'No agent'}</span><small className="ad-came">{l.came.replace('Today, ', '')}</small></div>
    </article>
  )
}

function LeadDrawer({ id, onClose, readOnly }) {
  const { data: leads } = useAdmLeads()
  const { data: agents } = useAdmAgents()
  const { assignLead, setLeadStage } = useAdmActions()
  const note = useNote()
  const l = leads.find(x => x.id === id)
  const [pick, setPick] = useState(null)
  if (!l) return <RecordDrawer label="Not found" kicker="Leads" onClose={onClose} hero={<h2>No lead here</h2>}><p className="fx-calm">This lead is not in this week's list.</p></RecordDrawer>
  const tone = stageTone(l.stage)
  const lane = LEAD_LANES.find(x => x.stages.includes(l.stage))
  const fits = agents.filter(a => a.access && a.states.includes(l.state))
  const options = (fits.length ? fits : agents).map(a => ({ value: a.id, label: a.name, sub: `${a.active ? (a.onDuty ? 'On duty' : 'Off duty') : 'Booking only'} · licensed in ${a.states.join(', ')}` }))
  const to = pick || l.agent_id || options[0]?.value
  const route = () => { assignLead(l.id, to); note(`${l.name} routed to ${agents.find(a => a.id === to).name}`) }
  const steps = STEPS.filter(s => (l.kind === 'live' ? s.key !== 'booked' : s.key !== 'transferred'))
  return (
    <RecordDrawer label={l.name} kicker={`Lead · came in ${l.came}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{l.kind === 'live' ? 'Live call' : `Appointment ${l.appt}`}</span><Chip tone={tone}>{STAGE_WORD[l.stage]}</Chip></div>
        <h2>{l.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{l.city}, {l.state} · {l.product}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{l.phone}</b><Avatar name={l.name} tone={tone} /></div>
      </>}
      stepper={readOnly || ['unassigned', 'missed'].includes(l.stage) ? null : <Stepper label="Stage" steps={steps} current={l.stage} onPick={s => { setLeadStage(l.id, s); note(`${l.name}: ${STAGE_WORD[s]}`) }} />}
      actions={readOnly ? null : <>
        <button type="button" className="tp-primary fx-accent" onClick={route} disabled={!to || to === l.agent_id}><Shuffle size={16} />{l.agent_id ? 'Move to this agent' : 'Route to this agent'}</button>
        {l.agent_id && <Link to={`${ap('messages')}?to=${l.agent_id}`} className="tp-btn ov-ghost">Message {l.agent.split(' ')[0]}</Link>}
      </>}>
      {!readOnly && (
        <Block title={l.agent ? `With ${l.agent}` : 'Route it'} sub={lane.key === 'route' ? (l.stage === 'missed' ? 'The transfer rang and nobody picked up. Give it to someone on duty.' : 'No agent yet. Agents licensed in this state are listed first.') : 'Move it to another agent if needed.'}>
          <DField label="Agent"><Dropdown label="Agent" value={to} options={options} onChange={setPick} /></DField>
        </Block>
      )}
      <Block title="What we know">
        <dl className="fx-facts">{[['Phone', l.phone], ['Came in', l.came], ['Type', KIND_WORD[l.kind]], ['From', l.source], ['Looking for', l.product], ['Agent', l.agent || 'No agent yet']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {l.note && <p className="tp-sub">{l.note}</p>}
      </Block>
      {l.log.length > 0 && <Block title="Routing"><ul className="tp-list">{l.log.map(x => <li key={x} className="tp-sub"><Check size={13} aria-hidden="true" /> {x}</li>)}</ul></Block>}
    </RecordDrawer>
  )
}

export default function Leads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { data: leads } = useAdmLeads()
  const { data: agents } = useAdmAgents()
  const { data: viewAs } = useAdmViewAs()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [when, setWhen] = useState('week')
  const agent = sp.get('agent') || 'all'
  const setAgent = v => setSp(v === 'all' ? {} : { agent: v }, { replace: true })
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => (kind === 'all' || l.kind === kind) && (agent === 'all' || l.agent_id === agent) && (when === 'week' || l.day === 5)
    && (!n || `${l.name} ${l.city} ${l.phone} ${l.agent || ''}`.toLowerCase().includes(n)))
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads ad-leads">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city, phone or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: leads.length }, { key: 'appointment', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live').length }]} />
        <Seg label="When" value={when} onChange={setWhen} options={[{ key: 'week', label: 'This week' }, { key: 'today', label: 'Today' }]} />
        <span className="tp-grow" />
        <Dropdown className="ad-dd-sm" label="Agent" value={agent} onChange={setAgent} options={[{ value: 'all', label: 'Every agent' }, ...agents.map(a => ({ value: a.id, label: a.name }))]} />
      </div>
      <div className="fx-board ad-board5" role="region" aria-label="Leads by stage">
        {LEAD_LANES.map((b, li) => {
          const rows = shown.filter(l => b.stages.includes(l.stage)).slice().reverse()
          return (
            <section key={b.key} className={`fx-lane is-${b.tone}`} style={{ '--i': li }} aria-label={`${b.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{b.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} i={card++} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No lead matches that search.' : b.empty} />}
              </div>
            </section>
          )
        })}
      </div>
      {id && <LeadDrawer id={id} readOnly={viewAs === 'partner'} onClose={() => navigate(ap('leads'))} />}
      <p className="tp-sub ad-hint"><PhoneIncoming size={13} aria-hidden="true" /> Live calls ring agents who are active and on duty; the rest are booked onto an agent's calendar.</p>
    </div>
  )
}
