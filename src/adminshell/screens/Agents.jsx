import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Search, MapPin, MessageSquare, PhoneIncoming, BookUser, Radio, ShieldOff, ShieldCheck, Send, X, Mail, Smartphone } from 'lucide-react'
import { useAdmAgents, useAdmLeads, useAdmInvites, useAdmActions, PLANS } from '../data'
import { Avatar, Chip, Drawer, Empty, Seg, Switch, useNote } from '../../template/kit'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField } from '../kit'
import { ap } from '../paths'
import { BILL_WORD, STAGE_WORD, stageTone } from '../words'
import { PilotBlock, CampaignBlock } from './Pilot879'
import { SplitBlock } from './Split889'

// P849 — Agents: every agent, their plan and weekly lead budget, whether they take live transfers, this week's results
// and billing. A row opens the agent in a drawer at its own address (/admin/agents/:id) with every admin control the
// Users page has today (transfers, Servicing, access, role) plus plan, budget and comp. Sample only.
const money = usd()
const BUDGETS = [0, 150, 250, 300, 350, 400, 450, 500, 600, 750, 1000].map(n => ({ value: n, label: n ? `${money(n)} a week` : 'No lead budget' }))
const SORTS = [{ value: 'sold', label: 'Most sold' }, { value: 'in', label: 'Most leads' }, { value: 'name', label: 'Name' }, { value: 'spend', label: 'Biggest budget' }]

function Funnel({ w }) {
  return (
    <ul className="adm-mf" aria-label={`${w.in} in, ${w.booked} booked, ${w.transferred} transferred, ${w.sold} sold`}>
      {[['In', w.in], ['Booked', w.booked], ['Transf.', w.transferred], ['Sold', w.sold]].map(([k, n]) => <li key={k}><b className="tp-num">{n}</b><small>{k}</small></li>)}
    </ul>
  )
}

function AgentDrawer({ id, onClose }) {
  const { data: agents } = useAdmAgents()
  const { data: leads } = useAdmLeads()
  const { setAgentActive, setAgentSpend, setServicing, setComped, setAccess, setRole } = useAdmActions()
  const note = useNote()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(null)
  const a = agents.find(x => x.id === id)
  if (!a) return <RecordDrawer label="Not found" kicker="Agents" onClose={onClose} hero={<h2>No agent here</h2>}><p className="fx-calm">This agent is not on the list any more.</p></RecordDrawer>
  const [billWord, billTone] = BILL_WORD[a.billing.status]
  const mine = leads.filter(l => l.agent_id === a.id).slice(-6).reverse()
  const tone = a.billing.status === 'past_due' ? 'warn' : a.active ? 'green' : 'blue'
  return (
    <RecordDrawer label={a.name} kicker={`Agent · joined ${a.joined}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Radio size={13} aria-hidden="true" />{a.active ? (a.onDuty ? 'On duty for live transfers' : 'Takes transfers, off duty now') : 'Booking only'}</span><Chip tone={billTone}>{billWord}</Chip></div>
        <h2>{a.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{a.city}, {a.state} · licensed in {a.states.join(', ')}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{a.phone}</b><Avatar name={a.name} tone={tone} /></div>
      </>}
      actions={<>
        <Link to={`${ap('messages')}?to=${a.id}`} className="tp-primary fx-accent"><MessageSquare size={16} />Message</Link>
        <Link to={`${ap('leads')}?agent=${a.id}`} className="tp-btn ov-ghost"><PhoneIncoming size={15} />Their leads</Link>
        <Link to={`${ap('clients')}?agent=${a.id}`} className="tp-btn ov-ghost"><BookUser size={15} />Their clients</Link>
      </>}>
      <Block title="Live transfers" sub="On means live calls can ring this agent while they are on duty.">
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>{a.active ? 'Active for transfers' : 'Booking only'}</b><p className="tp-sub">{a.onDuty ? 'On duty right now' : 'Not on duty right now'}</p></div>
          <Switch on={a.active} label="Active for transfers" onChange={v => { setAgentActive(a.id, v); note(v ? `${a.name} takes live transfers` : `${a.name} is booking only`) }} /></div>
      </Block>
      <Block title="Plan and budget" sub="Sample prices">
        <dl className="fx-facts">{[['Plan', `${a.planInfo.label} · ${a.planInfo.price ? `${money(a.planInfo.price)} a week` : 'no plan fee'}`], ['Next charge', a.billing.next], ['Card', a.billing.method], ['Clients', String(a.clients)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <DField label="Weekly lead budget" hint="Ads spend up to this each week on this agent's leads.">
          <Dropdown label="Weekly lead budget" value={a.spend} options={BUDGETS} onChange={v => { setAgentSpend(a.id, v); note(`Budget set to ${money(v)} a week`) }} />
        </DField>
        {a.billing.failed && <p className="adm-warn">{a.billing.failed.what} {money(a.billing.failed.amount)} failed {a.billing.failed.when}: {a.billing.failed.why}.</p>}
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Comped</b><p className="tp-sub">Comped agents use the portal without a plan charge.</p></div><Switch on={a.comped} label="Comped" onChange={v => { setComped(a.id, v); note(v ? 'Account comped' : 'Comp ended') }} /></div>
      </Block>
      <PilotBlock key={`p-${a.id}`} agent={a} />
      <SplitBlock key={`s-${a.id}`} agent={a} />
      <CampaignBlock agent={a} />
      <Block title="This week"><Funnel w={a.week} /></Block>
      <Block title="Access">
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Servicing</b><p className="tp-sub">{a.servicing ? 'Leads and Servicing' : 'Leads only'}</p></div><Switch on={a.servicing} label="Servicing" onChange={v => { setServicing(a.id, v); note(v ? 'Servicing on' : 'Servicing off: leads only') }} /></div>
        <DField label="Role"><Dropdown label="Role" value="agent" options={[{ value: 'agent', label: 'Agent' }, { value: 'fulfillment', label: 'Fulfillment' }]} onChange={v => v !== 'agent' && setAsk('role')} /></DField>
        <div className="fx-form-row">
          {a.access
            ? <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => setAsk('off')}><ShieldOff size={15} />Turn access off</button>
            : <button type="button" className="tp-btn ov-ghost" onClick={() => { setAccess(a.id, true); note(`${a.name} can sign in again`) }}><ShieldCheck size={15} />Turn access back on</button>}
        </div>
      </Block>
      <Block title="Latest leads" aside={<Link to={`${ap('leads')}?agent=${a.id}`} className="tp-link">All</Link>}>
        <ul className="tp-list">{mine.map(l => (
          <li key={l.id}><Link to={ap('leads', l.id)} className="fx-mrow"><Avatar name={l.name} tone={stageTone(l.stage)} /><span className="tp-grow"><b>{l.name}</b><small>{l.came} · {l.product}</small></span><Chip tone={stageTone(l.stage)}>{STAGE_WORD[l.stage]}</Chip></Link></li>
        ))}{mine.length === 0 && <li className="tp-sub">No leads this week.</li>}</ul>
      </Block>

      <Drawer open={ask === 'off'} center onClose={() => setAsk(null)} title="Turn access off?" sub={a.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setAccess(a.id, false); note(`${a.name} can't sign in now`); setAsk(null) }}>Turn it off</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep access</button></>}>
        <p className="tp-mid">They are signed out and can't sign in. Their {a.clients} clients and their leads stay as they are. You can turn it back on any time.</p>
      </Drawer>
      <Drawer open={ask === 'role'} center onClose={() => setAsk(null)} title="Make them Fulfillment?" sub={a.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setRole(a.id, 'fulfillment'); note(`${a.name} is Fulfillment now`); setAsk(null); navigate(ap('team', a.id)) }}>Change the role</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep as agent</button></>}>
        <p className="tp-mid">{a.clients ? `${a.name} has ${a.clients} open clients. They stay on the books but need a new agent.` : 'They have no open clients.'} Their leads stop.</p>
      </Drawer>
    </RecordDrawer>
  )
}

export default function Agents() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: agents } = useAdmAgents()
  const { data: invites } = useAdmInvites()
  const { setAgentActive, resendInvite, cancelInvite } = useAdmActions()
  const note = useNote()
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [sort, setSort] = useState('sold')
  const n = q.trim().toLowerCase()
  const keep = a => (show === 'all' || (show === 'duty' && a.active) || (show === 'booking' && !a.active) || (show === 'due' && a.billing.status === 'past_due'))
  const list = agents.filter(a => keep(a) && (!n || `${a.name} ${a.email} ${a.phone} ${a.city}`.toLowerCase().includes(n)))
    .sort((x, y) => (sort === 'name' ? x.name.localeCompare(y.name) : sort === 'spend' ? y.spend - x.spend : (y.week[sort] - x.week[sort]) || x.name.localeCompare(y.name)))
  const out = invites.filter(i => i.role === 'agent')
  return (
    <div className="tp-page fx-page adm-agents-page">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find an agent" placeholder="Find by name, email, phone or city" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Show" value={show} onChange={setShow} options={[
          { key: 'all', label: 'All', count: agents.length }, { key: 'duty', label: 'Take transfers', count: agents.filter(a => a.active).length },
          { key: 'booking', label: 'Booking only', count: agents.filter(a => !a.active).length }, { key: 'due', label: 'Past due', count: agents.filter(a => a.billing.status === 'past_due').length },
        ]} />
        <span className="tp-grow" />
        <Dropdown className="adm-dd-sm" label="Sort" value={sort} options={SORTS} onChange={setSort} />
      </div>

      <section className="fx-tile adm-table" style={{ '--i': 0 }} aria-label="Agents" data-fold>
        <div className="adm-tr adm-th" aria-hidden="true"><span>Agent</span><span>Plan and budget</span><span>Transfers</span><span>This week</span><span>Billing</span></div>
        {list.map((a, i) => {
          const [word, tone] = BILL_WORD[a.billing.status]
          return (
            <div key={a.id} className="adm-tr" style={{ '--i': i }}>
              <Link to={ap('agents', a.id)} className="adm-who"><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.city}, {a.state} · {a.access ? `on ${a.lastOn}` : 'access off'}</small></span></Link>
              <span className="adm-cell"><b>{PLANS[a.plan].label}</b><small>{money(a.spend)} a week on leads</small></span>
              <span className="adm-cell adm-sw"><Switch on={a.active} label={`${a.name} takes live transfers`} onChange={v => { setAgentActive(a.id, v); note(v ? `${a.name} takes live transfers` : `${a.name} is booking only`) }} /><small>{a.active ? (a.onDuty ? 'On duty' : 'Off duty') : 'Booking only'}</small></span>
              <span className="adm-cell"><Funnel w={a.week} /></span>
              <span className="adm-cell"><Chip tone={tone}>{word}</Chip><small>{a.billing.next}</small></span>
            </div>
          )
        })}
        {list.length === 0 && <Empty title="No agent" sub="No agent matches that." />}
      </section>

      {out.length > 0 && (
        <section className="fx-tile adm-invites" style={{ '--i': 1 }} aria-label="Invites out">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Invites out</h2><p>Not signed up yet</p></span></header>
          <ul className="tp-list">{out.map(v => (
            <li key={v.id} className="fx-mrow">{v.via === 'text' ? <Smartphone size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
              <span className="tp-grow"><b>{v.name}</b><small>{v.to} · sent {v.sent}</small></span>
              <button type="button" className="fx-pillbtn" onClick={() => { resendInvite(v.id); note(`Invite sent again to ${v.name} (sample)`) }}><Send size={13} />Resend</button>
              <button type="button" className="fx-x" aria-label={`Cancel ${v.name}'s invite`} onClick={() => { cancelInvite(v.id); note('Invite cancelled') }}><X size={15} /></button>
            </li>
          ))}</ul>
        </section>
      )}

      {id && <AgentDrawer id={id} onClose={() => navigate(ap('agents'))} />}
    </div>
  )
}
