import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Search, Plus, MessageSquare, MapPin, Users, UserPlus, Archive, CalendarCheck, Check, ShieldCheck, ShieldAlert, Wrench } from 'lucide-react'
import { useDataSource, useSampleClients, useSampleClient, useSampleThreads, useSampleActions } from '../data'
import { Avatar, Chip, Drawer, Money, Empty, Switch, useNote } from '../kit'
import { RecordDrawer, Block } from '../Record'
import { paths } from '../paths'
import { FirstRun } from '../DataState'
import { AddClients } from '../AddClients891'
import { FilterPills } from '../FilterPills'
import { CallOrCopy } from '../CallOrCopy'
import { agentOpensSaveCall } from '../ful/data'
import { useCheckSettings, todayFor } from '../checkSettings'
import { CLIENT_STATUS, STATUS_ORDER, clientStatusOf, clientStatus, requestTag, workingWhy, dueCheck, nextCheck, checkLists, listQuestion, answerList, shortDate, ordinal } from '../../lib/clientCheck.js'
import { stagesOf, dateWord } from '../../lib/clientStages.js'
import { StageBlock } from '../Stages911'
import '../p899.css'

// P899 — Clients, simplified. Agents don't work clients, the team does: the agent sees whether a policy is safe
// (Working, Needs attention, Protected; Closed behind a switch) and once a month confirms it's still on the books.
// One "Still on the books?" list per draft date sits on top; each card and drawer can answer it too, and any
// client can be marked Lapsed. Rules: lib/clientCheck.js.
const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const where = c => [c.carrier_name, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')

// Yes / No on one client's check. No hands it to the team: Working, and the VA gets a save call.
function useAnswer() {
  const { answerChecks } = useSampleActions()
  const note = useNote()
  return (clients, draft, fellOff = []) => {
    const { yes, no } = answerList({ clients }, fellOff)
    answerChecks?.({ yes, no, draft })
    no.forEach(id => { const c = clients.find(x => x.id === id); agentOpensSaveCall({ who: fullName(c), why: 'off_books', draft, state: c.state, city: c.city }) })
    note(no.length ? `${no.length === 1 ? fullName(clients.find(x => x.id === no[0])) : `${no.length} clients`}: our team is calling to save ${no.length === 1 ? 'it' : 'them'}${yes.length ? `. ${yes.length} still on the books` : ''}` : yes.length === 1 ? `${fullName(clients[0])}: still on the books` : `All ${yes.length} still on the books`)
  }
}

// One list per draft date: "These policies drafted on the 7th. Are they still on the books?" One tap for all, or
// tick only the ones that fell off.
function CheckList({ list, i }) {
  const answer = useAnswer()
  const [off, setOff] = useState([])
  const flip = id => setOff(o => (o.includes(id) ? o.filter(x => x !== id) : [...o, id]))
  const many = list.clients.length > 1
  return (
    <section className="fx-tile ck-list" style={{ '--i': i }} aria-label={`Still on the books? Drafted on the ${ordinal(list.day)}`}>
      <header className="ck-h">
        <span className="ck-ic"><CalendarCheck size={18} aria-hidden="true" /></span>
        <span className="tp-grow"><h2>Still on the books?</h2><p>{listQuestion(list)}</p><small>Drafted {shortDate(list.draft)} · asked {shortDate(list.askOn)}</small></span>
      </header>
      <ul className="ck-rows">
        {list.clients.map(c => {
          const gone = off.includes(c.id)
          return (
            <li key={c.id} className={gone ? 'is-off' : ''}>
              <Avatar name={fullName(c)} tone={gone ? 'mute' : 'warn'} />
              <span className="tp-grow"><Link to={paths.client(c.id)}><b>{fullName(c)}</b></Link><small>{[c.carrier_name, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</small></span>
              <label className="ck-off"><input type="checkbox" checked={gone} onChange={() => flip(c.id)} /><span>{gone ? 'Fell off' : many ? 'Fell off?' : 'No longer on the books'}</span></label>
            </li>
          )
        })}
      </ul>
      <footer className="ck-f">
        {off.length === 0
          ? <button type="button" className="tp-primary fx-accent" onClick={() => answer(list.clients, list.draft)}><Check size={16} aria-hidden="true" />{many ? 'All still on the books' : 'Still on the books'}</button>
          : <button type="button" className="tp-primary fx-accent" onClick={() => { answer(list.clients, list.draft, off); setOff([]) }}><Check size={16} aria-hidden="true" />Save: {off.length} fell off{list.clients.length - off.length ? `, ${list.clients.length - off.length} still on` : ''}</button>}
        <small>{off.length ? 'Our team calls each one that fell off to save it.' : 'Tick only the ones that fell off.'}</small>
      </footer>
    </section>
  )
}

// P911: when the client came on: "Sold Oct 27", or "Added by you Nov 3".
const cameOn = c => (c.added ? `Added by you ${dateWord(c.submitted) || ''}` : `Sold ${dateWord(c.submitted) || ''}`).trim()
// P911: the card's one line for where a client stands.
function standOf(c, st, due) {
  if (st === 'working') {
    const s = stagesOf(c)
    return { kicker: s.current ? `Stage ${s.at} of ${s.of}` : s.label, text: s.current ? s.current.label : workingWhy(c), stages: s }
  }
  if (st === 'needs_attention' && due) return { kicker: 'Monthly check', text: `Still on the books? It drafted ${shortDate(due.draft)}.` }
  if (st === 'closed') return { kicker: 'Closed', text: c.track?.closed || c.note || 'Gone for good.' }
  return { kicker: 'Protected', text: 'Nothing needed' }
}

// P911: every card the same shape: name, carrier · city, state, "Drafts the 12th · Sold Oct 27", one line for where it
// stands, and the buttons pinned at the bottom. No premium (it's optional; the drawer shows it if entered).
function ClientCard({ c, i, today, settings, onLapsed }) {
  const answer = useAnswer()
  const st = clientStatusOf(c, today, settings)
  const { tone, label } = clientStatus(st)
  const name = fullName(c)
  const due = st === 'needs_attention' ? dueCheck(c, today, settings) : null
  const stand = standOf(c, st, due)
  const canLapse = st !== 'closed' && !c.fixing && !c.fromLead && !(c.missed && !c.missed.done)
  return (
    <article className={`fx-card fx-ccard ck-card is-${tone}`} style={{ '--i': i }}>
      <Link to={paths.client(c.id)} className="fx-cover" aria-label={`Open ${name}`} />
      <div className="fx-ccard-top"><Avatar name={name} tone={tone} /><span className="fx-tag">{label}</span></div>
      <h3>{name}</h3>
      <p className="ck-where">{where(c) || 'Details to be added'}</p>
      <p className="ck-dates"><span>{c.draft_day ? <>Drafts the <b>{ordinal(Number(c.draft_day))}</b></> : 'No draft date yet'}</span><span>{cameOn(c)}</span></p>
      <div className={`ck-stand is-${st}`}>
        <small>{stand.kicker}</small>
        <span>{stand.text}</span>
        {stand.stages && <span className="sl-bar" aria-hidden="true">{stand.stages.steps.map(s => <i key={s.key} className={`is-${s.state}`} />)}</span>}
      </div>
      <div className="fx-ccard-bot ck-bot">
        {due && <>
          <button type="button" className="tp-primary sm fx-accent fx-over" onClick={() => answer([c], due.draft)}>Yes</button>
          <button type="button" className="tp-btn ov-ghost sm fx-over" onClick={() => answer([c], due.draft, [c.id])}>No</button>
        </>}
        {!due && canLapse && <button type="button" className="tp-btn ov-ghost sm fx-over ck-lapse" onClick={() => onLapsed(c)}>Lapsed</button>}
        <span className="tp-grow" />
        <Link to={paths.messages()} className="fx-mini fx-over" aria-label={`Message the team about ${name}`}><MessageSquare size={14} /></Link>
      </div>
    </article>
  )
}

function ClientDrawer({ id, onClose, today, settings, onLapsed }) {
  const { data: c } = useSampleClient(id)
  const { data: threads } = useSampleThreads()
  const { sendMessage } = useSampleActions()
  const answer = useAnswer()
  const note = useNote()
  const [msg, setMsg] = useState('')
  const name = fullName(c)
  const st = clientStatusOf(c, today, settings)
  const { tone, label, sub } = clientStatus(st)
  const tag = requestTag(c)
  const due = st === 'needs_attention' ? dueCheck(c, today, settings) : null
  const next = st === 'protected' ? nextCheck(c, today, settings) : null
  const thread = threads.find(t => t.client_id === c.id)
  const send = () => { if (thread) sendMessage(thread.id, msg.trim()); setMsg(''); note('Message sent to the team') }
  // P911: premium is optional; it shows only when it was entered.
  const facts = [['Name', name], ['Phone', c.client_phone], ['City', c.city || 'Not given'], ['State', c.state || 'Not given'], ['Carrier', c.carrier_name || 'Not given'],
    ['Draft date', c.draft_day ? `The ${ordinal(Number(c.draft_day))} of each month` : 'Not given'], [c.added ? 'Added by you' : 'Sold', dateWord(c.submitted) || 'Not given'],
    ...(Number(c.monthly_premium) > 0 ? [['Monthly premium', <Money key="p" v={c.monthly_premium} />]] : []), ['Notes', c.notes || 'None']]
  const onTrack = st === 'working' || (st === 'closed' && c.track?.closed)
  return (
    <RecordDrawer label={name} kicker={`Client · since ${c.submitted}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when">{st === 'protected' ? <ShieldCheck size={13} aria-hidden="true" /> : <ShieldAlert size={13} aria-hidden="true" />}{sub}</span><Chip tone={tone}>{label}</Chip></div>
        <h2>{name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{where(c) || 'No details yet'}</p>
        {tag && <p className="ck-req-hero"><Wrench size={13} aria-hidden="true" />{tag}</p>}
      </>}
      actions={<>
        <CallOrCopy phone={c.client_phone} closed={st === 'closed'} />
        <span className="tp-grow" />
        {st !== 'closed' && !c.fixing && !due && <button type="button" className="tp-btn ov-ghost" onClick={() => onLapsed(c)}>Lapsed</button>}
      </>}>
      {due && (
        <section className="fx-blk fx-attn ck-ask">
          <header><h3><CalendarCheck size={16} aria-hidden="true" />Still on the books?</h3></header>
          <p className="tp-mid">{c.client_first_name}{'’'}s policy drafted on {shortDate(due.draft)}. Is it still on the books?</p>
          <div className="tp-row tp-wrap">
            <button type="button" className="tp-primary sm fx-accent" onClick={() => answer([c], due.draft)}>Yes, still on the books</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => answer([c], due.draft, [c.id])}>No</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => onLapsed(c)}>Lapsed</button>
          </div>
        </section>
      )}
      {/* P911: every Working client shows the steps we take, so nothing is forgotten (read-only; the team moves them). */}
      {onTrack && <StageBlock c={c} />}
      {st === 'closed' && !c.track?.closed && <Block title="Closed"><p className="tp-mid">{c.note || 'Gone for good. Nothing more from the team.'}</p></Block>}
      <Block title="Details" aside={next ? <span className="ck-next">Next check {shortDate(next.askOn)}</span> : null}>
        <dl className="fx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
      <Block title="Messages" sub="You and the team on this client">
        {thread?.messages?.length
          ? <ol className="tp-tl fx-tl ck-tl">{thread.messages.map(m => <li key={m.id} className="done"><i /><div><b>{m.from === 'me' ? 'You' : 'Our team'}</b><span>{m.text}</span><small>{m.at}</small></div></li>)}</ol>
          : <p className="tp-sub">No messages yet.</p>}
        <textarea className="tp-input fx-ta" aria-label="Message the team" placeholder="Write a message" value={msg} onChange={e => setMsg(e.target.value)} />
        {msg.trim() && <button type="button" className="tp-primary sm fx-accent fx-self" onClick={send}>Send</button>}
      </Block>
    </RecordDrawer>
  )
}

export default function Clients() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: clients } = useSampleClients()
  const { markLapsed } = useSampleActions()
  const source = useDataSource()
  const settings = useCheckSettings()
  const today = todayFor(source)
  const note = useNote()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [lapsing, setLapsing] = useState(null)
  const showClosed = params.get('closed') === '1'
  const stage = params.get('stage') || 'all'
  const statusOf = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, today, settings)])), [clients, today, settings])
  const counts = useMemo(() => Object.fromEntries(Object.keys(CLIENT_STATUS).map(s => [s, clients.filter(c => statusOf.get(c.id) === s).length])), [clients, statusOf])
  const lists = useMemo(() => checkLists(clients, today, settings), [clients, today, settings])
  const open = clients.filter(c => showClosed || statusOf.get(c.id) !== 'closed')
  const rows = open.filter(c => (stage === 'all' || statusOf.get(c.id) === stage) && `${fullName(c)} ${c.client_phone} ${c.carrier_name || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  const keys = showClosed ? [...STATUS_ORDER, 'closed'] : STATUS_ORDER
  const options = [{ key: 'all', label: 'All', count: open.length }, ...keys.map(k => ({ key: k, label: CLIENT_STATUS[k].label, count: counts[k], tone: CLIENT_STATUS[k].tone, title: CLIENT_STATUS[k].sub }))]
  const keep = extra => ({ ...(showClosed ? { closed: '1' } : {}), ...extra })
  const setStage = k => setParams(keep(k === 'all' ? {} : { stage: k }), { replace: true })
  const setClosed = on => setParams(on ? { closed: '1', stage: 'closed' } : {}, { replace: true })
  const lapse = () => {
    const c = lapsing
    markLapsed?.(c.id, today)
    agentOpensSaveCall({ who: fullName(c), why: 'lapsed', state: c.state, city: c.city })
    note(`${fullName(c)} marked lapsed. Our team is calling to get it back on`)
    setLapsing(null)
  }
  const showLists = lists.length > 0 && (stage === 'all' || stage === 'needs_attention') && !q.trim()
  return (
    <div className="tp-page fx-page">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a client" placeholder="Find a client, phone or carrier" value={q} onChange={e => setQ(e.target.value)} /></label>
        <FilterPills label="Status" value={stage} onChange={setStage} items={options} />
        <label className="lc-closedsw"><Archive size={15} aria-hidden="true" /><span>Show closed</span><Switch on={showClosed} label="Show closed clients" onChange={setClosed} /></label>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setAdding(true)}><UserPlus size={16} />Add clients</button>
        <Link to={paths.submit()} className="tp-primary fx-accent"><Plus size={16} />Submit a policy</Link>
      </div>

      {showLists && <div className="ck-lists" aria-label="Monthly check">{lists.map((l, i) => <CheckList key={l.draft} list={l} i={i} />)}</div>}

      <div className="fx-cgrid ck-grid" aria-label="Clients">
        {rows.map((c, i) => <ClientCard key={c.id} c={c} i={i} today={today} settings={settings} onLapsed={setLapsing} />)}
        {rows.length === 0 && clients.length > 0 && <section className="fx-tile"><Empty title={stage === 'needs_attention' ? 'Nothing to check' : 'No clients match'} sub={stage === 'needs_attention' ? 'Every policy is confirmed on the books. The next check comes 3 days after each draft.' : 'Check the spelling, or show every status.'} /></section>}
        {clients.length === 0 && <FirstRun icon={Users} title="Your clients show here" sub="Submit a sale and our team takes it from there. You just see whether each policy is safe, and once a month confirm it’s still on the books."><Link to={paths.submit()} className="tp-primary fx-accent"><Plus size={16} />Submit your first policy</Link><button type="button" className="tp-btn ov-ghost" onClick={() => setAdding(true)}><UserPlus size={16} />Add clients you already have</button></FirstRun>}
      </div>

      <AddClients open={adding} onClose={() => setAdding(false)} />
      <Drawer open={!!lapsing} center onClose={() => setLapsing(null)} title="Mark lapsed?" sub={lapsing ? fullName(lapsing) : ''}
        footer={<button type="button" className="tp-primary fx-accent" onClick={lapse}>Yes, it lapsed</button>}>
        <p className="tp-mid">It moves to Working and our team calls {lapsing?.client_first_name} to get it back on. Nothing else for you to do.</p>
      </Drawer>
      {id && (source === 'sample' || clients.some(c => c.id === id)) && <ClientDrawer id={id} today={today} settings={settings} onLapsed={setLapsing} onClose={() => navigate(paths.clients(stage === 'all' ? undefined : stage))} />}
    </div>
  )
}
