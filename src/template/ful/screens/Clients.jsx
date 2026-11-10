import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, MessageSquare, CalendarClock, MapPin, TriangleAlert, LifeBuoy, PhoneCall, Archive } from 'lucide-react'
import { useFulClients, useFulCalls, useFulTasks, useFulThreads, useFulActions, useFulClock } from '../data'
import { Avatar, Chip, Money, SampleTag, Empty, Switch, useNote } from '../../kit'
import { RecordDrawer, Block } from '../../Record'
import { CLIENT_STATUS, STATUS_ORDER, clientStatusOf, clientStatus, requestTag } from '../../../lib/clientCheck.js'
import { FilterPills } from '../../FilterPills'
import './clients931.css'
import { stagesOf } from '../../../lib/clientStages.js'
import { StageBlock } from '../../Stages911'
import { fp } from '../paths'
import { CALL_WORD, CALL_TONE, KIND, kindTone } from '../words'

// P845 — Clients: the agent's Clients grid and drawer, adapted for a VA: every client across the agents this VA
// serves, each card naming its agent, a filter per agent beside the status filter. The drawer shows the policy, the
// open calls and servicing steps for that client, and the thread with the agent about them (the client never sees it).
// P907: the statuses are P899's (Working · Needs attention · Protected · Closed, lib/clientCheck), and every client
// shows their next booked call: the system books every call, so "next step" is a time, not a to-do.
// P911: a Working client shows the same stage checklist as the agent's (read-only here; VAs move steps from their calls).

// The next open booking per client, across the team: a cancel-the-old-policy call or a booked servicing call.
// P918: its text is one line on the VA's clock with the client's beside it ("Today 2:30 PM · client 1:30 PM MT").
function useNextBooked() {
  const { data: calls } = useFulCalls()
  const { data: tasks } = useFulTasks()
  const { today, dayName, nowIso } = useFulClock()
  return useMemo(() => {
    const m = {}
    // Only what is still ahead: a past call that wasn't answered is rebooked, not "next".
    const put = (cid, iso, text, word, to) => { if (cid && iso && (!nowIso || iso >= nowIso) && (!m[cid] || iso < m[cid].iso)) m[cid] = { iso, text, word, to } }
    const at = x => `${x.day === today ? 'Today' : dayName(x.day)} ${x.when || x.time}`
    calls.filter(k => k.iso && (k.status === 'booked' || k.status === 'no_answer')).forEach(k => put(k.client_id, k.iso, at(k), 'Cancel the old policy', fp('calendar', k.id)))
    tasks.filter(t => t.iso && t.status !== 'done').forEach(t => put(t.client_id, t.iso, t.when ? at(t) : t.due_text, KIND[t.kind] || 'Call', fp('calendar', t.id)))
    return m
  }, [calls, tasks, today, dayName, nowIso])
}
const statusOf = (c, day) => clientStatus(clientStatusOf(c, day))
// P931: the agent's client card (P911 standard): name and status up top, carrier · city, then inner panels for the
// details (drafts and agent; where it stands; the next booked call), every card the same height, the buttons pinned at
// the bottom. Nothing reads like loose text.
const ord = n => { const v = Number(n); if (!v) return null; const t = ['th', 'st', 'nd', 'rd'][(v % 100 > 10 && v % 100 < 14) ? 0 : v % 10] || 'th'; return `${v}${t}` }
function ClientCard({ c, i, open, next, day }) {
  const { tone, label, sub } = statusOf(c, day)
  const st = clientStatusOf(c, day)
  const req = requestTag(c)
  const stage = st === 'working' ? stagesOf(c) : null
  const stand = stage ? { kicker: stage.current ? `Stage ${stage.at} of ${stage.of}` : 'Working', text: stage.current ? stage.current.label : stage.label } : { kicker: label, text: req || sub }
  return (
    <article className={`fx-card fx-ccard ck-card fs-ccard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('clients', c.id)} className="fx-cover" aria-label={`Open ${c.name}`} />
      <div className="fx-ccard-top"><Avatar name={c.name} tone={tone} /><span className="fx-tag">{label}</span></div>
      <h3 title={c.name}>{c.name}</h3>
      <p className="ck-where" title={`${c.carrier_name} · ${c.city}, ${c.state}`}>{c.carrier_name} · {c.city}, {c.state}</p>
      <div className="fs-cc-pair">
        <span><small>Drafts</small><b>{ord(c.draft_day) ? `The ${ord(c.draft_day)}` : 'Not given'}</b></span>
        <span><small>Agent</small><b title={c.agent}>{c.agent}</b></span>
      </div>
      <div className={`ck-stand is-${st}`}>
        <small>{stand.kicker}</small>
        <span>{stand.text}</span>
        {stage && <span className="sl-bar" aria-hidden="true">{stage.steps.map(s => <i key={s.key} className={`is-${s.state}`} />)}</span>}
      </div>
      <div className={`fs-cc-next${next ? '' : ' is-none'}`}>
        <CalendarClock size={14} aria-hidden="true" />
        <span><small>{next ? next.word : 'Next call'}</small><b>{next ? next.text : 'Nothing booked'}</b></span>
      </div>
      <div className="fx-ccard-bot ck-bot">
        {open > 0 && <span className="fs-cc-open">{open} open for you</span>}
        <span className="tp-grow" />
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
  const { dateText, today, isoOf } = useFulClock()
  const nextBooked = useNextBooked()
  const c = clients.find(x => x.id === id) || clients[0]
  if (!c) return <RecordDrawer label="Not found" kicker="Clients" onClose={onClose} hero={<h2>Not one of your clients</h2>}><p className="fx-calm">This client isn't on your list.</p></RecordDrawer>
  const { tone, label, sub } = statusOf(c, isoOf(today))
  const next = nextBooked[c.id]
  const myCalls = calls.filter(k => k.client_id === c.id)
  const myTasks = tasks.filter(t => t.client_id === c.id)
  const thread = threads.find(t => t.client_id === c.id)
  const send = () => { sendMessage(thread.id, msg.trim()); setMsg(''); note(`Sent to ${c.agent}`) }
  return (
    <RecordDrawer label={c.name} kicker={`${c.agent}'s client · since ${c.submitted}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when" title={sub}><CalendarClock size={13} aria-hidden="true" />{next ? `Next call ${next.text} · ${next.word}` : 'No call booked'}</span><Chip tone={tone}>{label}</Chip></div>
        <h2>{c.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{c.carrier_name} · {c.city}, {c.state}</p>
        <div className="fx-hero-bot"><span><Money v={c.monthly_premium} size="fx-hero-big" /><small> / month · sample</small></span><Avatar name={c.name} tone={tone} /></div>
      </>}
      actions={<>
        {/* P946: no Call button for VAs. They call only from the phone on the rail when a call is due (Start call, or a call that comes in). */}
        <span className="tp-grow" />
        <Link to={fp('messages')} className="tp-btn ov-ghost"><MessageSquare size={14} />Messages</Link>
      </>}>
      {c.attention && (
        <section className="fx-blk fx-attn">
          <header><h3><TriangleAlert size={16} aria-hidden="true" />{c.attention}</h3></header>
          <p className="tp-mid">{c.agent} asked for help. It is booked as {c.next_step.toLowerCase()}.</p>
        </section>
      )}
      {(statusOf(c, isoOf(today)).key === 'working' || c.track?.closed) && <StageBlock c={c} who="va" />}
      <Block title="Policy">
        <dl className="fx-facts">{[['Carrier', c.carrier_name], ['Product', c.product_name], ['Policy', c.policy_number], ['Phone', c.client_phone], ['Agent', c.agent]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {c.note && <p className="tp-sub">{c.note}</p>}
      </Block>
      <Block title="Your work on this client" aside={<span className="fx-count">{myCalls.length + myTasks.length}</span>}>
        <ul className="tp-list">
          {myCalls.map(k => <li key={k.id}><Link to={fp('calendar', k.id)} className="fx-mrow"><PhoneCall size={16} aria-hidden="true" /><span className="tp-grow"><b>Cancel the old policy</b><small>{dateText(k.day)}, {k.time}</small></span><Chip tone={CALL_TONE[k.status]}>{CALL_WORD[k.status]}</Chip></Link></li>)}
          {myTasks.map(t => <li key={t.id}><Link to={fp('calendar', t.id)} className="fx-mrow"><LifeBuoy size={16} aria-hidden="true" /><span className="tp-grow"><b>{KIND[t.kind]}</b><small>{t.due_text}</small></span><Chip tone={kindTone(t.kind)}>{t.status === 'done' ? 'Done' : t.iso ? 'Booked' : 'Open'}</Chip></Link></li>)}
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
  const { data: calls } = useFulCalls()
  const { data: tasks } = useFulTasks()
  const { today, isoOf } = useFulClock()
  const day = isoOf(today)
  const nextBooked = useNextBooked()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const showClosed = params.get('closed') === '1'
  const stage = params.get('stage') || 'all'
  const openFor = useMemo(() => {
    const m = {}
    calls.filter(k => k.status === 'booked' || k.status === 'no_answer').forEach(k => { m[k.client_id] = (m[k.client_id] || 0) + 1 })
    tasks.filter(t => t.due !== 'done').forEach(t => { m[t.client_id] = (m[t.client_id] || 0) + 1 })
    return m
  }, [calls, tasks])
  // P931: no filter by agent (each card names its agent). Status pills as on the agent side; Closed is a switch.
  const st = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, day)])), [clients, day])
  const shown = clients.filter(c => showClosed || st.get(c.id) !== 'closed')
  const rows = shown.filter(c => (stage === 'all' || st.get(c.id) === stage) && `${c.name} ${c.policy_number} ${c.client_phone} ${c.agent}`.toLowerCase().includes(q.trim().toLowerCase()))
  const count = s => clients.filter(c => st.get(c.id) === s).length
  const keys = showClosed ? [...STATUS_ORDER, 'closed'] : STATUS_ORDER
  const options = [{ key: 'all', label: 'All', count: shown.length }, ...keys.map(k => ({ key: k, label: CLIENT_STATUS[k].label, count: count(k), tone: CLIENT_STATUS[k].tone, title: CLIENT_STATUS[k].sub }))]
  const keep = extra => ({ ...(showClosed ? { closed: '1' } : {}), ...extra })
  const setStage = k => setParams(keep(k === 'all' ? {} : { stage: k }), { replace: true })
  const setClosed = on => setParams(on ? { closed: '1', stage: 'closed' } : {}, { replace: true })
  const back = () => navigate({ pathname: fp('clients'), search: params.toString() ? `?${params}` : '' })
  return (
    <div className="tp-page fx-page fs-clients">
      <div className="fx-tools fs-cl-tools">
        <label className="fx-find fs-cl-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find a client, phone, policy…" value={q} onChange={e => setQ(e.target.value)} /></label>
        <FilterPills label="Status" value={stage} onChange={setStage} items={options} />
        <span className="tp-grow" />
        <span className="fs-cl-tag is-top"><SampleTag>Sample clients</SampleTag></span>
        <label className="lc-closedsw fs-closedsw"><Archive size={15} aria-hidden="true" /><span>Show closed</span><Switch on={showClosed} label="Show closed clients" onChange={setClosed} /></label>
      </div>

      <div className="fx-cgrid ck-grid" aria-label="Clients">
        {rows.map((c, i) => <ClientCard key={c.id} c={c} i={i} open={openFor[c.id] || 0} next={nextBooked[c.id]} day={day} />)}
        {rows.length === 0 && <section className="fx-tile"><Empty title="No clients match" sub="Check the spelling, or show every status." /></section>}
      </div>
      <span className="fs-cl-tag is-end"><SampleTag>Sample clients</SampleTag></span>

      {id && <ClientDrawer id={id} onClose={back} />}
    </div>
  )
}
