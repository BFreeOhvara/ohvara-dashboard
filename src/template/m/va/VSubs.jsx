import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageCircle, Phone, CheckCheck } from 'lucide-react'
import { useFulFeed, useFulClients, useFulSchedule } from '../../ful/data'
import { whyShort } from '../../ful/callSteps'
import { useApp, SubPage, Ini, rise } from '../AppKit'
import { useNoAutoKeyboard } from '../useKeyboard'
import { NoteRow } from '../ANotes'
import { useVaCall, useVaThreads, FEED_SEEN } from './vaStore'
import { useVaNow, dayOfItem } from './useVaNow'
import { stateOf, STATE_TONE, STATE_TAG, forLine } from './vaModel'
import { dayWords } from '../appModel'

// P975 — the small screens: Notifications (from the left, like the agent app), search (any client by name or
// phone), and a client (their policy, their calls with you, and the chat with their agent).
const KIND = { call: 'live', servicing: 'protected', shift: 'booking', message: 'message' }

export function VNotif() {
  const { data: feed } = useFulFeed()
  const [read, setRead] = useState(() => FEED_SEEN.get())
  useEffect(() => { FEED_SEEN.add(feed.map(f => f.id)) }, [feed])
  const left = feed.filter(f => !read.includes(f.id)).length
  const markAll = <button type="button" className="ma-textbtn ma-press" onClick={() => setRead(feed.map(f => f.id))} disabled={!left}><CheckCheck size={18} aria-hidden="true" />Mark all read</button>
  return (
    <SubPage title="Notifications" line={left ? `${left} new` : 'All caught up'} close="Close notifications" className="is-notif" left={markAll} arrowRight big>
      {feed.map((f, i) => (
        <NoteRow key={f.id} i={i} unread={!read.includes(f.id)} it={{ kind: KIND[f.kind] || 'todo', title: f.who, what: f.text, time: f.at }} onClick={() => setRead(r => [...new Set([...r, f.id])])} />
      ))}
      {!feed.length && <p className="ma-empty is-glass">Nothing new. Bookings, messages and shift news show here.</p>}
    </SubPage>
  )
}

const digits = s => String(s || '').replace(/\D/g, '')
export function VSearch() {
  const app = useApp()
  const { data: clients } = useFulClients()
  const [q, setQ] = useState('')
  const input = useRef(null)
  useNoAutoKeyboard(input) // P982: no focus on open; the keyboard only comes up when they tap the field
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return clients.slice(0, 8)
    const d = digits(t)
    return clients.filter(c => c.name.toLowerCase().includes(t) || (d.length >= 3 && digits(c.client_phone).includes(d))).slice(0, 30)
  }, [clients, q])
  return (
    <SubPage title="Search" line="Any client, by name or phone" big>
      <label className="va-find ma-rise"><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" placeholder="Name or phone" aria-label="Search clients by name or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {hits.map(c => (
          <button key={c.id} type="button" className="ma-row" onClick={() => app.openSub('client', { c: c.id })}>
            <Ini name={c.name} tone="sky" size={40} />
            <span className="ma-grow"><b>{c.name}</b><small>{c.client_phone} · {c.agent}</small></span>
          </button>
        ))}
        {!hits.length && <p className="ma-empty">No client by that name or number.</p>}
      </div>
    </SubPage>
  )
}

export function VClient({ id }) {
  const app = useApp()
  const vc = useVaCall()
  const { data: clients } = useFulClients()
  const { data: all } = useFulSchedule()
  const threads = useVaThreads()
  const { nowMs, tz, todayIso } = useVaNow()
  const c = clients.find(x => x.id === id)
  if (!c) return <SubPage title="Client"><p className="ma-empty">This client isn’t here any more.</p></SubPage>
  const calls = all.filter(i => (i.row?.client_id || i.row?.client?.id) === c.id)
  const thread = threads.find(t => t.client_id === c.id)
  // P986: Call is one of the few places the phone opens (with Start call, the brief and the hold line).
  const foot = (
    <div className="ma-two va-clientfoot">
      {thread && <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => app.openSub('thread', { t: thread.id })}><MessageCircle size={18} aria-hidden="true" />Message {c.agent.split(' ')[0]}</button>}
      <button type="button" className="ma-btn is-solid is-tall ma-press" onClick={() => vc.callClient(c)}><Phone size={18} aria-hidden="true" />Call</button>
    </div>
  )
  return (
    <SubPage title={c.name} line={`${c.agent}’s client`} foot={foot} big>
      <div className="ma-glass ma-pad va-facts is-glass ma-rise">
        <span><small>Phone</small><b>{c.client_phone || 'Not given'}</b></span>
        <span><small>Lives in</small><b>{[c.city, c.state].filter(Boolean).join(', ') || 'Not given'}</b></span>
        <span><small>Carrier</small><b>{c.carrier_name || 'Not given'}</b></span>
        <span><small>Policy</small><b>{c.policy_number || 'Not given'}</b></span>
      </div>
      <p className="ma-cap is-out">Calls with you</p>
      <div className="ma-coming ma-rise" style={rise(1)}>
        {calls.map(i => {
          const st = stateOf(i, nowMs)
          return (
            <button key={i.ref} type="button" className={`ma-up is-${STATE_TONE[st]} ma-press`} onClick={() => (st === 'open' ? vc.needResult(i) : vc.openBrief(i))}>
              <span className="ma-up-when"><b>{dayWords(dayOfItem(i, tz), todayIso).replace(/^\w+, /, '')}</b><small>{i.time}</small></span>
              <span className="ma-grow"><b>{whyShort(i)}</b><small>{forLine(STATE_TAG[st], i.agent)}</small></span>
              <Phone size={16} aria-hidden="true" />
            </button>
          )
        })}
        {!calls.length && <p className="ma-empty is-glass">No calls booked with {c.name.split(' ')[0]}.</p>}
      </div>
    </SubPage>
  )
}
