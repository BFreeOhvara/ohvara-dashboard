import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, Phone, MessageSquare, CalendarClock, MapPin, TriangleAlert, LifeBuoy, PhoneCall } from 'lucide-react'
import { useFulClients, useFulCalls, useFulTasks, useFulThreads, useFulAgents, useFulActions } from '../data'
import { Avatar, Chip, Money, SampleTag, Empty, PillTabs, useNote } from '../../kit'
import { RecordDrawer, Block } from '../../Record'
import { stageLabel } from '../../stages'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE, KIND, kindTone } from '../words'

// P845 — Clients: the agent's Clients grid and drawer, adapted for a VA: every client across the agents this VA
// serves, each card naming its agent, a filter per agent beside the status filter. The drawer shows the policy, the
// open calls and servicing steps for that client, and the thread with the agent about them (the client never sees it).
function ClientCard({ c, i, open }) {
  const note = useNote()
  const [tone, label] = stageLabel[c.stage]
  return (
    <article className={`fx-card fx-ccard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('clients', c.id)} className="fx-cover" aria-label={`Open ${c.name}`} />
      <div className="fx-ccard-top"><Avatar name={c.name} tone={tone} /><span className="fx-tag">{label}</span></div>
      <h3>{c.name}</h3>
      <p>{c.carrier_name} · {c.city}, {c.state}</p>
      <div className="fx-ccard-mid">
        <span><small>Agent</small><b>{c.agent}</b></span>
        <span><small>Next step</small><b>{c.next_step || 'Nothing open'}</b></span>
      </div>
      <div className="fx-ccard-bot">
        <span>{open ? `${open} open for you` : 'Nothing open for you'}</span>
        <span className="tp-grow" />
        <button type="button" className="fx-mini fx-over" aria-label={`Call ${c.name}`} onClick={() => note(`Dial ${c.client_phone} from your phone`)}><Phone size={14} /></button>
        <Link to={fp('messages')} className="fx-mini fx-over" aria-label={`Message ${c.agent} about ${c.name}`}><MessageSquare size={14} /></Link>
      </div>
    </article>
  )
}

function ClientDrawer({ id, onClose }) {
  const { data: clients } = useFulClients()
  const { data: calls } = useFulCalls()
  const { data: tasks } = useFulTasks()
  const { data: threads } = useFulThreads()
  const { sendMessage } = useFulActions()
  const note = useNote()
  const [msg, setMsg] = useState('')
  const c = clients.find(x => x.id === id) || clients[0]
  const [tone, label] = stageLabel[c.stage]
  const myCalls = calls.filter(k => k.client_id === c.id)
  const myTasks = tasks.filter(t => t.client_id === c.id)
  const thread = threads.find(t => t.client_id === c.id)
  const send = () => { sendMessage(thread.id, msg.trim()); setMsg(''); note(`Sent to ${c.agent}`) }
  return (
    <RecordDrawer label={c.name} kicker={`${c.agent}'s client · since ${c.submitted}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{c.next_step || 'Nothing open'}</span><Chip tone={tone}>{label}</Chip></div>
        <h2>{c.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{c.carrier_name} · {c.city}, {c.state}</p>
        <div className="fx-hero-bot"><span><Money v={c.monthly_premium} size="fx-hero-big" /><small> / month · sample</small></span><Avatar name={c.name} tone={tone} /></div>
      </>}
      actions={<>
        <button type="button" className="tp-primary fx-accent" onClick={() => note(`Dial ${c.client_phone} from your phone`)}><Phone size={16} />Call</button>
        <span className="tp-grow" />
        <Link to={fp('messages')} className="tp-btn ov-ghost"><MessageSquare size={14} />Messages</Link>
      </>}>
      {c.attention && (
        <section className="fx-blk fx-attn">
          <header><h3><TriangleAlert size={16} aria-hidden="true" />{c.attention}</h3></header>
          <p className="tp-mid">{c.agent} asked for help. It is on Servicing as {c.next_step.toLowerCase()}.</p>
        </section>
      )}
      <Block title="Policy">
        <dl className="fx-facts">{[['Carrier', c.carrier_name], ['Product', c.product_name], ['Policy', c.policy_number], ['Phone', c.client_phone], ['Agent', c.agent]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {c.note && <p className="tp-sub">{c.note}</p>}
      </Block>
      <Block title="Your work on this client" aside={<span className="fx-count">{myCalls.length + myTasks.length}</span>}>
        <ul className="tp-list">
          {myCalls.map(k => <li key={k.id}><Link to={fp('calls', k.id)} className="fx-mrow"><PhoneCall size={16} aria-hidden="true" /><span className="tp-grow"><b>Cancellation call</b><small>Nov {k.day}, {k.time}</small></span><Chip tone={CALL_TONE[k.status]}>{CALL_WORD[k.status]}</Chip></Link></li>)}
          {myTasks.map(t => <li key={t.id}><Link to={fp('servicing', t.id)} className="fx-mrow"><LifeBuoy size={16} aria-hidden="true" /><span className="tp-grow"><b>{KIND[t.kind]}</b><small>{t.due_text}</small></span><Chip tone={kindTone(t.kind)}>{t.status === 'done' ? 'Done' : 'Open'}</Chip></Link></li>)}
        </ul>
        {myCalls.length + myTasks.length === 0 && <p className="fx-calm">Nothing for you on this client.</p>}
      </Block>
      <Block title={`Message ${c.agent}`} sub={`About ${c.client_first_name}. The client doesn't see this.`}>
        {thread && <ul className="tp-list">{thread.messages.slice(-2).map(m => <li key={m.id} className="tp-li fx-msg"><span className="tp-grow"><b>{m.from === 'me' ? 'You' : c.agent}</b><small>{m.text}</small></span></li>)}</ul>}
        <textarea className="tp-input fx-ta" aria-label={`Message ${c.agent}`} placeholder={`Write to ${c.agent.split(' ')[0]} about ${c.client_first_name}`} value={msg} onChange={e => setMsg(e.target.value)} />
        {msg.trim() && thread && <button type="button" className="tp-primary sm fx-accent fx-self" onClick={send}>Send</button>}
        {msg.trim() && !thread && <button type="button" className="tp-primary sm fx-accent fx-self" onClick={() => { setMsg(''); note(`Sent to ${c.agent}`) }}>Send</button>}
      </Block>
    </RecordDrawer>
  )
}

export default function Clients() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: clients } = useFulClients()
  const { data: agents } = useFulAgents()
  const { data: calls } = useFulCalls()
  const { data: tasks } = useFulTasks()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const stage = params.get('stage') || 'all'
  const agent = params.get('agent') || 'all'
  const setP = (k, v) => { const p = Object.fromEntries(params); if (v === 'all') delete p[k]; else p[k] = v; setParams(p) }
  const openFor = useMemo(() => {
    const m = {}
    calls.filter(k => k.status === 'booked' || k.status === 'no_answer').forEach(k => { m[k.client_id] = (m[k.client_id] || 0) + 1 })
    tasks.filter(t => t.due !== 'done').forEach(t => { m[t.client_id] = (m[t.client_id] || 0) + 1 })
    return m
  }, [calls, tasks])
  const inAgent = clients.filter(c => agent === 'all' || c.agent_id === agent)
  const rows = inAgent.filter(c => (stage === 'all' || c.stage === stage) && `${c.name} ${c.policy_number} ${c.client_phone} ${c.agent}`.toLowerCase().includes(q.trim().toLowerCase()))
  const count = s => inAgent.filter(c => c.stage === s).length
  const options = [{ key: 'all', label: 'All', count: inAgent.length }, { key: 'needs_attention', label: 'Needs attention', count: count('needs_attention') }, { key: 'setting_up', label: 'Setting up', count: count('setting_up') }, { key: 'requests', label: 'Requests', count: count('requests') }, { key: 'protected', label: 'Protected', count: count('protected') }]
  const toneOf = key => (stageLabel[key] ? `is-tone is-${stageLabel[key][0]}` : '')
  const back = () => navigate({ pathname: fp('clients'), search: params.toString() ? `?${params}` : '' })
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find a client, phone, policy or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <PillTabs label="Agent" className="fx-filters" itemClass="fx-filter" value={agent} onChange={k => setP('agent', k)}
          items={[{ key: 'all', label: 'Every agent' }, ...agents.map(a => ({ key: a.id, label: a.name.split(' ')[0], count: a.clients }))]} />
      </div>
      <div className="fx-tools">
        <PillTabs label="Status" className="fx-filters" itemClass="fx-filter" value={stage} onChange={k => setP('stage', k)} items={options.map(o => ({ ...o, className: toneOf(o.key) }))} />
        <SampleTag>Sample clients</SampleTag>
      </div>

      <div className="fx-cgrid" aria-label="Clients">
        {rows.map((c, i) => <ClientCard key={c.id} c={c} i={i} open={openFor[c.id] || 0} />)}
        {rows.length === 0 && <section className="fx-tile"><Empty title="No clients match" sub="Check the spelling, or show every status and agent." /></section>}
      </div>

      {id && <ClientDrawer id={id} onClose={back} />}
    </div>
  )
}
