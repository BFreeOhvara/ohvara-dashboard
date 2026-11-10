import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, MessageSquare, Phone, FileText, Hand, Eye, Tag } from 'lucide-react'
import { useAdmClients, useAdmAgents, useAdmVas, useAdmActions } from '../data'
import { Avatar, Chip, Empty, Switch, useNote } from '../../template/kit'
import { FilterPills } from '../../template/FilterPills'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField } from '../kit'
import { ap } from '../paths'
import { CLIENT_STAGE, CLIENT_ORDER } from '../words'

// P934: one Clients list (the Servicing switch is gone: every client is serviced, and the status pills show where each
// stands). A client's open steps and who has them are on the card and in the drawer, where a step can be given to
// someone else. The two Servicing settings (Still on the books?, welcome calls a day) moved to Settings › Servicing.
// P849 — Clients and Servicing: everyone's clients (view only, as Pipeline is today: the database refuses admin stage
// changes) with search, an agent filter and stage tabs, a client drawer at /admin/pipeline/:id with Message agent;
// and every open servicing step across the Fulfillment team, where an admin can give a step to someone else.
// P906: the P899 client statuses, Working · Needs attention · Protected, with Closed behind "Show closed". A request
// (an address change...) is a tag on the card, not a status.
const money = usd(true)
const STAGE_ORDER = CLIENT_ORDER

function ClientDrawer({ id, onClose }) {
  const { data: clients } = useAdmClients()
  const { data: vas } = useAdmVas()
  const { giveStep } = useAdmActions()
  const note = useNote()
  const c = clients.find(x => x.id === id)
  if (!c) return <RecordDrawer label="Not found" kicker="Clients" onClose={onClose} hero={<h2>No client here</h2>}><p className="fx-calm">This client is not on any book.</p></RecordDrawer>
  const [tone, word] = CLIENT_STAGE[c.stage]
  return (
    <RecordDrawer label={c.name} kicker={`${c.agent}'s client · sold ${c.sold}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Eye size={13} aria-hidden="true" />View only</span><Chip tone={tone}>{word}</Chip></div>
        <h2>{c.name}</h2>
        <p><FileText size={13} aria-hidden="true" />{c.carrier} · {c.product} · {c.policy}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-money">{money(c.premium)}<small> a month</small></b><Avatar name={c.name} tone={tone} /></div>
      </>}
      actions={<>
        <Link to={`${ap('messages')}?to=${c.agent_id}`} className="tp-primary fx-accent"><MessageSquare size={16} />Message {c.agent.split(' ')[0]}</Link>
        <Link to={ap('agents', c.agent_id)} className="tp-btn ov-ghost">Open the agent</Link>
      </>}>
      {c.attention && <p className="adm-warn">{c.attention}</p>}
      {c.tag && <p className="tp-sub"><Tag size={13} aria-hidden="true" /> {c.tag}</p>}
      <Block title="Policy">
        <dl className="fx-facts">{[['Phone', c.phone], ['State', c.state], ['Carrier', c.carrier], ['Policy', c.policy], ['Agent', c.agent], ['Servicing by', c.va]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      {/* P934: the old Clients › Servicing view's step list lives here now: each open step, who has it, and Give it to
          someone else (the same giveStep the view used). */}
      <Block title="Servicing steps open" sub={c.steps.length ? `${c.steps.length} open${c.steps.some(s => s.late) ? ` · ${c.steps.filter(s => s.late).length} late` : ''}` : 'None'}>
        <ul className="tp-list">{c.steps.map(s => (
          <li key={s.id} className="fx-mrow adm-cstep"><Hand size={15} aria-hidden="true" /><span className="tp-grow"><b>{s.kind}</b><small>{s.due}</small></span>
            <Chip tone={s.late ? 'warn' : 'blue'}>{s.late ? 'Late' : s.status === 'scheduled' ? 'Scheduled' : 'Asked'}</Chip>
            <DField label="With"><Dropdown className="adm-dd-sm" label={`${s.kind} for ${c.name} is with`} value={s.va_id} options={vas.map(v => ({ value: v.id, label: v.name, sub: v.onShift ? 'On shift today' : 'Off today' }))}
              onChange={v => { giveStep(s.id, v); note(`${s.kind} given to ${vas.find(x => x.id === v).name}`) }} /></DField>
          </li>
        ))}</ul>
      </Block>
      <p className="tp-sub">Statuses are changed by the agent and the team, not from admin.</p>
    </RecordDrawer>
  )
}

export default function Clients() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { data: clients } = useAdmClients()
  const { data: agents } = useAdmAgents()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('all')
  const [closed, setClosed] = useState(false)
  const agent = sp.get('agent') || 'all'
  const put = (k, v) => { const next = new URLSearchParams(sp); if (!v || v === 'all') next.delete(k); else next.set(k, v); setSp(next, { replace: true }) }
  const n = q.trim().toLowerCase()
  const open = clients.filter(c => c.stage !== 'closed')
  const pool = closed ? clients : open
  const shown = pool.filter(c => (agent === 'all' || c.agent_id === agent) && (stage === 'all' || c.stage === stage) && (!n || `${c.name} ${c.phone} ${c.agent} ${c.carrier} ${c.policy}`.toLowerCase().includes(n)))
    .sort((a, b) => [...STAGE_ORDER, 'closed'].indexOf(a.stage) - [...STAGE_ORDER, 'closed'].indexOf(b.stage))
  const total = shown.reduce((t, c) => t + c.premium, 0)
  return (
    <div className="tp-page fx-page adm-clients">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find by name, phone, agent, carrier or policy" value={q} onChange={e => setQ(e.target.value)} /></label>
        {/* P934: the agent side's status pills (colour-coded, the picked one a darker shade, no sliding fill). */}
        <FilterPills label="Status" value={stage} onChange={setStage} items={[{ key: 'all', label: 'All', count: pool.length }, ...[...STAGE_ORDER, ...(closed ? ['closed'] : [])].map(k => ({ key: k, label: CLIENT_STAGE[k][1], tone: CLIENT_STAGE[k][0], count: clients.filter(c => c.stage === k).length }))]} />
        <span className="tp-grow" />
        <label className="tp-row adm-showclosed"><Switch on={closed} label="Show closed" onChange={v => { setClosed(v); if (!v && stage === 'closed') setStage('all') }} /><span className="tp-sub">Show closed</span></label>
        <Dropdown className="adm-dd-sm" label="Agent" value={agent} onChange={v => put('agent', v)} options={[{ value: 'all', label: 'Every agent' }, ...agents.map(a => ({ value: a.id, label: a.name }))]} />
      </div>
      <div className="fx-cgrid adm-cgrid">
        {shown.map((c, i) => {
          const [tone, word] = CLIENT_STAGE[c.stage]
          return (
            <article key={c.id} className={`fx-card fx-ccard is-${tone}`} style={{ '--i': i }}>
              <Link to={ap('clients', c.id)} className="fx-cover" aria-label={`Open ${c.name}`} />
              <div className="fx-lcard-top"><span className="fx-kind">{word}</span><span className="fx-tag">{c.agent.split(' ')[0]}</span></div>
              <h3>{c.name}</h3>
              <p>{c.carrier} · {c.policy}</p>
              {c.tag && <small className="adm-ctag"><Tag size={11} aria-hidden="true" /> {c.tag}</small>}
              {c.steps.length > 0 && <small className={`adm-ctag adm-csteps${c.steps.some(x => x.late) ? ' is-late' : ''}`}><Hand size={11} aria-hidden="true" /> {c.steps[0].kind}{c.steps.length > 1 ? ` +${c.steps.length - 1}` : ''} · {c.va.split(' ')[0]}{c.steps.some(x => x.late) ? ' · late' : ''}</small>}
              <div className="fx-ccard-bot"><span className="tp-money">{money(c.premium)}/mo</span><span className="adm-came"><Phone size={12} aria-hidden="true" />{c.phone}</span></div>
            </article>
          )
        })}
        {shown.length === 0 && <Empty title="No client" sub="No client matches that." />}
      </div>
      <p className="tp-sub adm-hint">{shown.length} clients · {money(total)} a month in premium · view only</p>
      {id && <ClientDrawer id={id} onClose={() => navigate(ap('clients'))} />}
    </div>
  )
}
