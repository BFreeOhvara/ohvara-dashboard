import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Search, CalendarCheck, Check, MapPin, Wrench, Send, Share2, Copy, MessageSquareText, ShieldCheck, ShieldAlert, X } from 'lucide-react'
import { useDataSource, useSampleClients, useSampleClient, useSampleThreads, useSampleActions } from '../data'
import { Chip, Money, useNote } from '../kit'
import { agentOpensSaveCall } from '../ful/data'
import { useCheckSettings, todayFor } from '../checkSettings'
import { CLIENT_STATUS, STATUS_ORDER, clientStatusOf, clientStatus, requestTag, workingWhy, dueCheck, nextCheck, checkLists, answerList, shortDate, ordinal } from '../../lib/clientCheck.js'
import { stagesOf, dateWord } from '../../lib/clientStages.js'
import { StageBlock } from '../Stages911'
import { Sheet, ActionSheet, ActRow } from './Sheet'
import { CallBtn, PersonRow, Sec } from './bits'
import { mp } from './mpaths'
import '../p899.css'

// P908 — Clients on a phone: one list with status chips on top (All · Working · Needs attention · Protected · Closed).
// The monthly "Still on the books?" sits first as one-tap rows: Yes or No on each, or "All still on the books".
// A client opens as a full-screen sheet with Call and Send app link pinned at the bottom.
const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const where = c => [c.carrier_name, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
const standOf = (c, st) => (st === 'working' ? (stagesOf(c).current?.label || workingWhy(c)) : st === 'needs_attention' ? 'Still on the books?' : st === 'closed' ? (c.track?.closed || 'Closed') : 'Nothing needed')

function useAnswer() {
  const { answerChecks } = useSampleActions()
  const note = useNote()
  return (clients, draft, fellOff = []) => {
    const { yes, no } = answerList({ clients }, fellOff)
    answerChecks?.({ yes, no, draft })
    no.forEach(id => { const c = clients.find(x => x.id === id); agentOpensSaveCall({ who: fullName(c), why: 'off_books', draft, state: c.state, city: c.city }) })
    note(no.length ? `${fullName(clients.find(x => x.id === no[0]))}: our team is calling to save it` : yes.length === 1 ? `${fullName(clients[0])}: still on the books` : `All ${yes.length} still on the books`)
  }
}

// One draft date's check: a row per client with Yes / No (44 px), and one button for all of them.
function CheckCard({ list }) {
  const answer = useAnswer()
  return (
    <section className="mx-card mx-check">
      <header className="mx-check-h"><span className="mx-row-ic is-warn"><CalendarCheck size={18} aria-hidden="true" /></span><span className="tp-grow"><b>Still on the books?</b><small>Drafted {shortDate(list.draft)} · {list.clients.length} {list.clients.length === 1 ? 'policy' : 'policies'}</small></span></header>
      <ul className="mx-check-rows">
        {list.clients.map(c => (
          <li key={c.id}>
            <span className="tp-grow"><b>{fullName(c)}</b><small>{c.carrier_name || 'Carrier not given'}</small></span>
            <button type="button" className="mx-yn is-yes" aria-label={`${fullName(c)}: still on the books`} onClick={() => answer([c], list.draft)}><Check size={18} aria-hidden="true" />Yes</button>
            <button type="button" className="mx-yn" aria-label={`${fullName(c)}: fell off`} onClick={() => answer([c], list.draft, [c.id])}>No</button>
          </li>
        ))}
      </ul>
      {list.clients.length > 1 && <button type="button" className="mx-btn is-primary is-wide" onClick={() => answer(list.clients, list.draft)}><Check size={18} aria-hidden="true" />All {list.clients.length} still on the books</button>}
      <p className="mx-sub">A No sends our team to save it. Nothing else for you to do.</p>
    </section>
  )
}

// Send app link: their own Deedstone page. Texted for you once texting is live; today, share it from your phone.
function AppLinkSheet({ c, open, onClose }) {
  const note = useNote()
  const link = `${window.location.origin}/template/d/client?c=${c.id}`
  const share = async () => {
    onClose()
    try { if (navigator.share) { await navigator.share({ title: 'Your Deedstone page', text: `Hi ${c.client_first_name}, here’s your policy page:`, url: link }); return } } catch { return }
    try { await navigator.clipboard.writeText(link); note('Link copied') } catch { note('Couldn’t copy the link') }
  }
  const copy = async () => { onClose(); try { await navigator.clipboard.writeText(link); note('Link copied') } catch { note('Couldn’t copy the link') } }
  return (
    <ActionSheet open={open} onClose={onClose} title="Send app link" sub={`${c.client_first_name}’s own page: their policy, and changes that go straight to our team`}>
      <ActRow icon={Send} label={`Text it to ${c.client_first_name}`} sub="Starts when texting is live" disabled />
      <ActRow icon={Share2} label="Share from my phone" sub="Opens Messages with the link" onClick={share} />
      <ActRow icon={Copy} label="Copy link" onClick={copy} />
    </ActionSheet>
  )
}

function ClientSheet({ id, onClose, today, settings, onLapsed }) {
  const { data: c } = useSampleClient(id)
  const { data: threads } = useSampleThreads()
  const { sendMessage } = useSampleActions()
  const answer = useAnswer()
  const note = useNote()
  const [msg, setMsg] = useState('')
  const [appLink, setAppLink] = useState(false)
  const name = fullName(c)
  const st = clientStatusOf(c, today, settings)
  const { tone, label, sub } = clientStatus(st)
  const tag = requestTag(c)
  const due = st === 'needs_attention' ? dueCheck(c, today, settings) : null
  const next = st === 'protected' ? nextCheck(c, today, settings) : null
  const thread = threads.find(t => t.client_id === c.id)
  const facts = [['Phone', c.client_phone], ['Carrier', c.carrier_name || 'Not given'], ['Draft date', c.draft_day ? `The ${ordinal(Number(c.draft_day))}` : 'Not given'],
    [c.added ? 'Added by you' : 'Sold', dateWord(c.submitted) || 'Not given'], ...(Number(c.monthly_premium) > 0 ? [['Premium', <Money key="p" v={c.monthly_premium} />]] : []), ...(next ? [['Next check', shortDate(next.askOn)]] : [])]
  const closed = st === 'closed'
  return (
    <Sheet open onClose={onClose} title={name} kicker={`Client · since ${c.submitted}`} tone={tone}
      footer={closed ? null : <><CallBtn big phone={c.client_phone} /><button type="button" className="mx-btn is-wide" onClick={() => setAppLink(true)}><Send size={18} aria-hidden="true" />Send app link</button></>}>
      <div className={`mx-hero fx-card is-${tone}`}>
        <div className="mx-hero-top"><span>{st === 'protected' ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}{sub}</span><Chip tone={tone}>{label}</Chip></div>
        <p><MapPin size={14} aria-hidden="true" />{where(c) || 'No details yet'}</p>
        {tag && <p><Wrench size={14} aria-hidden="true" />{tag}</p>}
      </div>
      {due && (
        <section className="mx-card mx-ask">
          <h3><CalendarCheck size={18} aria-hidden="true" />Still on the books?</h3>
          <p className="mx-sub">It drafted {shortDate(due.draft)}.</p>
          <div className="mx-two"><button type="button" className="mx-btn is-primary" onClick={() => answer([c], due.draft)}>Yes, still on</button><button type="button" className="mx-btn" onClick={() => answer([c], due.draft, [c.id])}>No</button></div>
        </section>
      )}
      {(st === 'working' || (closed && c.track?.closed)) && <div className="mx-stages"><StageBlock c={c} /></div>}
      <section className="mx-card">
        <h3>Details</h3>
        <dl className="mx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>
      <section className="mx-card">
        <h3>Messages</h3>
        <p className="mx-sub">You and our team on {c.client_first_name}</p>
        {thread?.messages?.length
          ? <ol className="mx-tl">{thread.messages.map(m => <li key={m.id}><i aria-hidden="true" /><span><b>{m.from === 'me' ? 'You' : 'Our team'}</b><q>{m.text}</q><small>{m.at}</small></span></li>)}</ol>
          : <p className="mx-sub">No messages yet.</p>}
        <textarea className="mx-input mx-ta" aria-label="Message the team" placeholder="Write a message" value={msg} onChange={e => setMsg(e.target.value)} />
        {msg.trim() && <button type="button" className="mx-btn is-primary is-wide" onClick={() => { if (thread) sendMessage(thread.id, msg.trim()); setMsg(''); note('Message sent to the team') }}><MessageSquareText size={18} aria-hidden="true" />Send</button>}
      </section>
      {!closed && !c.fixing && !due && <button type="button" className="mx-btn is-ghost is-wide" onClick={() => onLapsed(c)}>Mark lapsed</button>}
      <AppLinkSheet c={c} open={appLink} onClose={() => setAppLink(false)} />
    </Sheet>
  )
}

export default function MClients() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: clients } = useSampleClients()
  const { markLapsed } = useSampleActions()
  const source = useDataSource()
  const settings = useCheckSettings()
  const today = todayFor(source)
  const note = useNote()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('all')
  const [lapsing, setLapsing] = useState(null)
  const statusOf = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, today, settings)])), [clients, today, settings])
  const lists = useMemo(() => checkLists(clients, today, settings), [clients, today, settings])
  const keys = [...STATUS_ORDER, 'closed']
  const count = k => (k === 'all' ? clients.filter(c => statusOf.get(c.id) !== 'closed').length : clients.filter(c => statusOf.get(c.id) === k).length)
  const n = q.trim().toLowerCase()
  const rows = clients.filter(c => (stage === 'all' ? statusOf.get(c.id) !== 'closed' : statusOf.get(c.id) === stage) && (!n || `${fullName(c)} ${c.client_phone} ${c.carrier_name || ''}`.toLowerCase().includes(n)))
  const showLists = lists.length > 0 && (stage === 'all' || stage === 'needs_attention') && !n
  const lapse = () => {
    const c = lapsing
    markLapsed?.(c.id, today)
    agentOpensSaveCall({ who: fullName(c), why: 'lapsed', state: c.state, city: c.city })
    note(`${fullName(c)} marked lapsed. Our team is calling to get it back on`)
    setLapsing(null)
  }
  return (
    <div className="mx-page">
      <label className="mx-find is-page"><Search size={18} aria-hidden="true" /><input aria-label="Find a client" placeholder="Name, phone or carrier" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="mx-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      <div className="mx-stabs is-chips" role="tablist" aria-label="Status">
        {['all', ...keys].map(k => {
          const s = k === 'all' ? { label: 'All', tone: 'mute' } : CLIENT_STATUS[k]
          return <button key={k} type="button" role="tab" aria-selected={stage === k} className={`mx-stab is-${s.tone}`} onClick={() => setStage(k)}>{k !== 'all' && <i aria-hidden="true" />}{s.label}<span>{count(k)}</span></button>
        })}
      </div>

      {showLists && lists.map(l => <CheckCard key={l.draft} list={l} />)}

      <Sec title={stage === 'all' ? 'Your book' : CLIENT_STATUS[stage].label}>
        {rows.length
          ? <ul className="mx-people">{rows.map(c => {
            const st = statusOf.get(c.id)
            const { tone, label } = clientStatus(st)
            return <PersonRow key={c.id} to={mp.client(c.id)} name={fullName(c)} tone={tone} sub={where(c) || 'Details to be added'} right={<span className={`tp-chip is-${tone}`}><i />{label}</span>}><em className="mx-stand">{c.draft_day ? `Drafts the ${ordinal(Number(c.draft_day))} · ` : ''}{standOf(c, st)}</em></PersonRow>
          })}</ul>
          : <p className="mx-empty">{stage === 'needs_attention' ? 'Nothing to check. Every policy is confirmed on the books.' : 'No clients match.'}</p>}
      </Sec>

      {id && (source === 'sample' || clients.some(c => c.id === id)) && <ClientSheet key={id} id={id} today={today} settings={settings} onLapsed={setLapsing} onClose={() => (window.history.state?.idx > 0 ? navigate(-1) : navigate(mp.clients()))} />}
      <ActionSheet open={!!lapsing} onClose={() => setLapsing(null)} title="Mark lapsed?" sub={lapsing ? `${fullName(lapsing)} moves to Working and our team calls to get it back on.` : ''}>
        <ActRow icon={ShieldAlert} tone="warn" label="Yes, it lapsed" onClick={lapse} />
        <ActRow icon={X} label="Cancel" onClick={() => setLapsing(null)} />
      </ActionSheet>
    </div>
  )
}
