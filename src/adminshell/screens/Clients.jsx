import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, MessageSquare, Phone, FileText, Hand, Eye, Check } from 'lucide-react'
import { useAdmClients, useAdmSteps, useAdmAgents, useAdmVas, useAdmActions } from '../data'
import { Avatar, Chip, Empty, PillTabs, Seg, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField } from '../kit'
import { ap } from '../paths'
import { CLIENT_STAGE } from '../words'
import { WelcomeLoad } from './WelcomeLoad891'
import { BookCheck } from './BookCheck899'

// P849 — Clients and Servicing: everyone's clients (view only, as Pipeline is today: the database refuses admin stage
// changes) with search, an agent filter and stage tabs, a client drawer at /admin/pipeline/:id with Message agent;
// and every open servicing step across the Fulfillment team, where an admin can give a step to someone else.
const money = usd(true)
const STAGE_ORDER = ['needs_attention', 'setting_up', 'requests', 'protected']

function ClientDrawer({ id, onClose }) {
  const { data: clients } = useAdmClients()
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
      <Block title="Policy">
        <dl className="fx-facts">{[['Phone', c.phone], ['State', c.state], ['Carrier', c.carrier], ['Policy', c.policy], ['Agent', c.agent], ['Servicing by', c.va]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      <Block title="Servicing steps open" sub={c.steps.length ? undefined : 'None'}>
        <ul className="tp-list">{c.steps.map(s => <li key={s.id} className="fx-mrow"><Hand size={15} aria-hidden="true" /><span className="tp-grow"><b>{s.kind}</b><small>{s.due}</small></span><Chip tone={s.late ? 'warn' : 'blue'}>{s.late ? 'Late' : s.status === 'scheduled' ? 'Scheduled' : 'Asked'}</Chip></li>)}</ul>
      </Block>
      <p className="tp-sub">Stages are changed by the agent and the team, not from admin.</p>
    </RecordDrawer>
  )
}

function Servicing() {
  const { data: steps } = useAdmSteps()
  const { data: vas } = useAdmVas()
  const { giveStep } = useAdmActions()
  const note = useNote()
  const [by, setBy] = useState('all')
  const list = steps.filter(s => by === 'all' || (by === 'late' ? s.late : s.va_id === by))
  return (
    <section className="fx-tile adm-steps" style={{ '--i': 0 }} aria-label="Servicing steps">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Servicing steps open</h2><p>{steps.length} across the team · {steps.filter(s => s.late).length} late</p></span>
        <Dropdown className="adm-dd-sm" label="Show" value={by} onChange={setBy} options={[{ value: 'all', label: 'Everyone' }, { value: 'late', label: 'Late only' }, ...vas.map(v => ({ value: v.id, label: v.name }))]} />
      </header>
      <ul className="tp-list adm-rows">{list.map(s => (
        <li key={s.id} className="adm-step">
          <Avatar name={s.client} tone={s.late ? 'warn' : 'blue'} />
          <span className="tp-grow"><b>{s.kind} · {s.client}</b><small>{s.agent}'s client · {s.due}</small></span>
          {s.late && <Chip tone="warn">Late</Chip>}
          <DField label="With"><Dropdown label={`${s.kind} for ${s.client} is with`} value={s.va_id} options={vas.map(v => ({ value: v.id, label: v.name, sub: v.onShift ? 'On shift today' : 'Off today' }))}
            onChange={v => { giveStep(s.id, v); note(`Given to ${vas.find(x => x.id === v).name}`) }} /></DField>
        </li>
      ))}{list.length === 0 && <li className="fx-calm"><Check size={16} aria-hidden="true" />Nothing here.</li>}</ul>
    </section>
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
  const tab = sp.get('tab') === 'servicing' ? 'servicing' : 'clients'
  const agent = sp.get('agent') || 'all'
  const put = (k, v) => { const next = new URLSearchParams(sp); if (!v || v === 'all' || (k === 'tab' && v === 'clients')) next.delete(k); else next.set(k, v); setSp(next, { replace: true }) }
  const n = q.trim().toLowerCase()
  const shown = clients.filter(c => (agent === 'all' || c.agent_id === agent) && (stage === 'all' || c.stage === stage) && (!n || `${c.name} ${c.phone} ${c.agent} ${c.carrier} ${c.policy}`.toLowerCase().includes(n)))
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
  const total = shown.reduce((t, c) => t + c.premium, 0)
  return (
    <div className="tp-page fx-page adm-clients">
      <PillTabs label="Clients and servicing" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={v => put('tab', v)}
        items={[{ key: 'clients', label: 'Clients', count: clients.length }, { key: 'servicing', label: 'Servicing' }]} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'servicing' ? <><BookCheck /><WelcomeLoad /><Servicing /></> : <>
          <div className="fx-tools">
            <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find by name, phone, agent, carrier or policy" value={q} onChange={e => setQ(e.target.value)} /></label>
            <Seg label="Stage" value={stage} onChange={setStage} options={[{ key: 'all', label: 'All', count: clients.length }, ...STAGE_ORDER.map(k => ({ key: k, label: CLIENT_STAGE[k][1], count: clients.filter(c => c.stage === k).length }))]} />
            <span className="tp-grow" />
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
                  <div className="fx-ccard-bot"><span className="tp-money">{money(c.premium)}/mo</span><span className="adm-came"><Phone size={12} aria-hidden="true" />{c.phone}</span></div>
                </article>
              )
            })}
            {shown.length === 0 && <Empty title="No client" sub="No client matches that." />}
          </div>
          <p className="tp-sub adm-hint">{shown.length} clients · {money(total)} a month in premium · view only</p>
        </>}
      </div>
      {id && <ClientDrawer id={id} onClose={() => navigate(ap('clients'))} />}
    </div>
  )
}
