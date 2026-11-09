import { useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { Search, PhoneIncoming, CalendarCheck, PhoneForwarded, PhoneOff, MapPin, Clock, Shuffle, Check, Lock } from 'lucide-react'
import { useAdmLeads, useAdmAgents, useAdmActions } from '../data'
import { Avatar, Chip, Empty, Seg, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { Dropdown, DField } from '../kit'
import { ap } from '../paths'
import { LEAD_LANES, STAGE_WORD, KIND_WORD, FOLLOW_OWNER, MATCH_WORD, stageTone, followOwner, isUnassigned, awaitsResult } from '../words'
import { ConsentProof, UnassignedBlock } from './Compliance879'
import { AiCallsView } from './AiCalls892'

// P849 — Leads (the inbounds page, on screen as Leads): every lead across every agent this week. P906: the board is
// the admin statuses. P913: Booked · No show · Follow up · Sold · Not interested (No answer is gone: those are Follow ups
// tagged Our team; the agent's own callbacks are tagged Agent). A live call isn't a status: as on the agent side it
// waits on Booked tagged "Live call · Mark result". A lead that matched no agent is not on this page: it raises the
// admin alert (Unmatched913.jsx) with Assign. A card opens the lead at /admin/inbounds/:id, where an admin moves it to
// another agent. P914: admins see the status but never change it (the agent, the AI caller and the workflows move it);
// the history stays. Sample only: nothing is routed or dialled for real.
const KIND_ICON = { appointment: CalendarCheck, live: PhoneForwarded, none: PhoneOff }

function LeadCard({ l, i }) {
  const tone = stageTone(l.stage)
  const Icon = KIND_ICON[l.kind] || CalendarCheck
  const owner = followOwner(l)
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }}>
      <Link to={ap('leads', l.id)} className="fx-cover" aria-label={`Open ${l.name}`} />
      <div className="fx-lcard-top"><span className="fx-kind"><Icon size={13} aria-hidden="true" />{KIND_WORD[l.kind]}</span>{awaitsResult(l) && <span className="fx-tag">Mark result</span>}{owner && <span className={`fx-tag adm-owner is-${owner}`}>{FOLLOW_OWNER[owner]}</span>}</div>
      <h3>{l.name}</h3>
      <p>{l.product} · {l.city}, {l.state}</p>
      <div className="fx-lcard-bot"><span className="fx-big">{l.agent ? l.agent.split(' ')[0] : 'No agent'}</span><small className="adm-came">{l.came.replace('Today, ', '')}</small></div>
    </article>
  )
}

function LeadDrawer({ id, onClose }) {
  const { data: leads } = useAdmLeads()
  const { data: agents } = useAdmAgents()
  const { assignLead } = useAdmActions()
  const note = useNote()
  const l = leads.find(x => x.id === id)
  const [pick, setPick] = useState(null)
  if (!l) return <RecordDrawer label="Not found" kicker="Leads" onClose={onClose} hero={<h2>No lead here</h2>}><p className="fx-calm">This lead is not in this week's list.</p></RecordDrawer>
  const tone = stageTone(l.stage)
  const none = isUnassigned(l)
  const fits = agents.filter(a => a.access && a.states.includes(l.state))
  const options = (fits.length ? fits : agents).map(a => ({ value: a.id, label: a.name, sub: `${a.active ? (a.onDuty ? 'On duty' : 'Off duty') : 'Appointments only'} · licensed in ${a.states.join(', ')}` }))
  const to = pick || l.agent_id || options[0]?.value
  const move = () => { assignLead(l.id, to); note(`${l.name} moved to ${agents.find(a => a.id === to).name}`) }
  const when = l.kind === 'live' ? 'Live call' : l.kind === 'none' ? 'Never reached' : `Appointment ${l.appt}`
  return (
    <RecordDrawer label={l.name} kicker={`Lead · came in ${l.came}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Clock size={13} aria-hidden="true" />{when}</span><Chip tone={tone}>{none ? 'Not matched' : STAGE_WORD[l.stage]}</Chip>{followOwner(l) && <Chip tone="mute">{FOLLOW_OWNER[followOwner(l)]}</Chip>}{awaitsResult(l) && <Chip tone="blue">Live call · Mark result</Chip>}</div>
        <h2>{l.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{l.city}, {l.state} · {l.product}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{l.phone}</b><Avatar name={l.name} tone={tone} /></div>
      </>}
      actions={none ? null : <>
        <button type="button" className="tp-primary fx-accent" onClick={move} disabled={!to || to === l.agent_id}><Shuffle size={16} />Move to this agent</button>
        <Link to={`${ap('messages')}?to=${l.agent_id}`} className="tp-btn ov-ghost">Message {l.agent.split(' ')[0]}</Link>
      </>}>
      {/* P879: Unassigned (no agent ID) gets its own block: the source ad, and only agents who can take it. */}
      {none && <UnassignedBlock lead={l} agents={agents} onAssign={a => { assignLead(l.id, a.id); note(`${l.name} assigned to ${a.name}. Logged.`) }} />}
      {!none && <p className="adm-lstatus"><Lock size={13} aria-hidden="true" />Status: <b>{STAGE_WORD[l.stage]}</b>. The agent, the AI caller and the workflows move it; admins can see it, not change it.</p>}
      {!none && <Block title={`With ${l.agent}`} sub={awaitsResult(l) ? `${l.agent.split(' ')[0]} took the live call and hasn't marked how it went yet.` : 'Move it to another agent if needed.'}>
        <DField label="Agent"><Dropdown label="Agent" value={to} options={options} onChange={setPick} /></DField>
      </Block>}
      <Block title="What we know">
        <dl className="fx-facts">{[['Phone', l.phone], ['Came in', l.came], ['Type', KIND_WORD[l.kind]], ['From', l.source], ['Looking for', l.product], ['Agent', l.agent || 'Not matched'], ['Matched by', MATCH_WORD[l.matchedBy] || 'Nothing matched'], ['Agent ID in link', l.agentRef || 'None'], ['Meta campaign ID', l.campaignId || l.campaign || 'None']].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {l.note && <p className="tp-sub">{l.note}</p>}
      </Block>
      <ConsentProof lead={l} />
      {l.log.length > 0 && <Block title="History"><ul className="tp-list">{l.log.map(x => <li key={x} className="tp-sub"><Check size={13} aria-hidden="true" /> {x}</li>)}</ul></Block>}
    </RecordDrawer>
  )
}

export default function Leads() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { data: leads } = useAdmLeads()
  const { data: agents } = useAdmAgents()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const [when, setWhen] = useState('week')
  const [status, setStatus] = useState('all')
  const agent = sp.get('agent') || 'all'
  const setAgent = v => setSp(v === 'all' ? {} : { agent: v }, { replace: true })
  // P892: Board (every lead by status) or AI calls (the AI caller's numbers and calls), kept in the address.
  const view = sp.get('view') === 'ai' ? 'ai' : 'board'
  const setView = v => setSp(v === 'ai' ? { view: 'ai' } : {}, { replace: true })
  const viewSeg = <Seg label="View" value={view} onChange={setView} options={[{ key: 'board', label: 'Board' }, { key: 'ai', label: 'AI calls' }]} />
  if (view === 'ai') {
    return (
      <div className="tp-page fx-page fx-leads adm-leads">
        <div className="fx-tools">{viewSeg}</div>
        <AiCallsView />
      </div>
    )
  }
  const n = q.trim().toLowerCase()
  const match = l => (when === 'week' || l.day === 5) && (!n || `${l.name} ${l.city} ${l.phone} ${l.agent || ''}`.toLowerCase().includes(n))
  const assigned = leads.filter(l => !isUnassigned(l))
  const shown = assigned.filter(l => match(l) && (kind === 'all' || l.kind === kind) && (agent === 'all' || l.agent_id === agent))
  const lanes = LEAD_LANES.filter(b => status === 'all' || b.key === status)
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads adm-leads">
      <div className="fx-tools">
        {viewSeg}
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find by name, city, phone or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: assigned.length }, { key: 'appointment', label: 'Appointments', count: assigned.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: assigned.filter(l => l.kind === 'live').length }]} />
        <Seg label="When" value={when} onChange={setWhen} options={[{ key: 'week', label: 'This week' }, { key: 'today', label: 'Today' }]} />
        <span className="tp-grow" />
        <Dropdown className="adm-dd-sm" label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Every status' }, ...LEAD_LANES.map(b => ({ value: b.key, label: b.label, sub: `${assigned.filter(l => b.stages.includes(l.stage)).length} this week` }))]} />
        <Dropdown className="adm-dd-sm" label="Agent" value={agent} onChange={setAgent} options={[{ value: 'all', label: 'Every agent' }, ...agents.map(a => ({ value: a.id, label: a.name }))]} />
      </div>
      <div className={`fx-board adm-board5${lanes.length === 1 ? ' is-one' : ''}`} role="region" aria-label="Leads by status">
        {lanes.map((b, li) => {
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
      {id && <LeadDrawer id={id} onClose={() => navigate(ap('leads'))} />}
      <p className="tp-sub adm-hint"><PhoneIncoming size={13} aria-hidden="true" /> Every lead finds its agent by the agent ID in the ad link or its Meta campaign ID. The AI calls it right away: a live transfer to the agent if they're free, else a booked appointment. Follow up tagged Our team means the AI or the no-answer texts are still trying.</p>
    </div>
  )
}
