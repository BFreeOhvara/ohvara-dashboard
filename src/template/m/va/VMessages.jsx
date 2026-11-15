import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, Search, X, Users } from 'lucide-react'
import { useFulActions, useFulClients, useFulSource } from '../../ful/data'
import { useVaNow } from './useVaNow'
import { useOptionalAuth } from '../../../hooks/useAuth'
import { useStandingThreads, useDmMessages, useSendDm, useMarkDmRead } from '../../../hooks/useDirectMessages'
import { whenText } from '../../../lib/fulReal'
import { isSupport, emptySupport, SUPPORT_THREAD, shownName } from '../../support911'
import { useApp, SubPage, Ini, rise } from '../AppKit'
import { useKeyboard } from '../useKeyboard'
import { runsOf } from '../appModel'
import { shortAt, subscribeLocal, getLocal, sendLocal } from '../threadStore'
import { firstName } from './vaModel'
import { useVaThreads, dmStore, VaStandingCtx } from './vaStore'
import { NO_CONV, NO_CONV_SUB } from '../../msgsEmptyText.js'

// P975 — Messages: threads straight on the page. Each agent thread is about one client (the agent and the VA; the
// client never sees it). P977: Ohvara support pinned at the top (Brayden and Jordan, like the agent app's), then a
// direct message with every other VA (no group chat; a new VA shows up for everyone, empty until someone writes),
// then the agent threads. A thread opens as the agent app's chat: bubbles at most 80 %, tails, send inside the field,
// drag down to drop the keyboard. Real: support and VA DMs are standing threads (direct_messages).
// P1018 (Brayden, Nov 15): VAs see Ohvara support, every other VA (from account creation) and the client
// conversations, titled by the client with the agent smaller. Any VA can pick a client conversation up. No agent list.
const titleOf = t => (isSupport(t) ? 'Ohvara support' : t.name)
const aboutOf = t => (isSupport(t) ? 'Ohvara Support · schedule, pay, anything' : t.va ? 'VA' : `Client · agent ${t.agent}`)
const whoOf = (t, m) => (m.from === 'me' ? 'You' : t.va ? firstName(t.name) : isSupport(t) ? 'Ohvara' : m.who ? firstName(m.who) : firstName(t.agent))
const lastOf = t => t.last || t.messages?.at(-1)
const emptyLine = t => (isSupport(t) ? 'Write to Ohvara Support' : t.va ? `Say hi to ${firstName(t.name)}` : 'No messages yet')

export default function VMessages() {
  const app = useApp()
  // P1018: Ohvara support, the other VAs, then the client conversations (P1001's "no VA-to-VA chat" is reversed).
  const all = useVaThreads()
  // P1002: search, as on the desktop ("Find a client or agent"). Ohvara support stays pinned whatever you type.
  const [q, setQ] = useState('')
  const n = q.trim().toLowerCase()
  const threads = all.filter(t => isSupport(t) || !n || `${t.name} ${t.agent}`.toLowerCase().includes(n))
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Messages</h1><small>Ohvara, VAs and clients</small></span></div>
      <label className="ma-search is-small ma-rise"><Search size={18} aria-hidden="true" />
        <input type="search" inputMode="search" aria-label="Find a thread" placeholder="Find a VA, client or agent" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}
      </label>
      <div className="ma-threads ma-rise" style={rise(0)}>
        {threads.map(t => {
          const last = lastOf(t)
          const unread = t.unread > 0
          return (
            <button key={t.id} type="button" className={`ma-thread va-thread${unread ? ' is-unread' : ''}${isSupport(t) ? ' is-pinned' : ''}`} onClick={() => app.openSub('thread', { t: t.id })}>
              <Ini person name={titleOf(t)} size={48} />
              <span className="ma-grow">
                <span className="ma-thread-top"><b>{titleOf(t)}</b><small>{shortAt(last?.at)}</small></span>
                <small className="va-about">{aboutOf(t)}</small>
                <span className="ma-thread-last"><small>{last ? `${last.from === 'me' ? 'You: ' : ''}${last.text}` : emptyLine(t)}</small>{unread && <span className="ma-badge is-inline">{t.unread}</span>}</span>
              </span>
            </button>
          )
        })}
        {!n && !all.some(t => !isSupport(t)) && <p className="ma-empty is-glass" role="status"><b>{NO_CONV}</b><br />{NO_CONV_SUB.va}</p>}
      </div>
      {n && threads.filter(t => !isSupport(t)).length === 0 && <p className="ma-empty is-glass">No thread. No VA, client or agent by that name.</p>}
      <p className="ma-note">Client chats are with that client’s agent; any VA can answer. The client never sees them.</p>
    </div>
  )
}

// Real data only (the sample preview has no query client): the standing threads for the list, read once for the app.
export function VaStandingProvider({ children }) {
  const me = useOptionalAuth()?.profile?.id || null
  const q = useStandingThreads(!!me)
  return <VaStandingCtx.Provider value={q.data || null}>{children}</VaStandingCtx.Provider>
}

export function VThread({ id }) {
  const threads = useVaThreads()
  const { data: clients } = useFulClients()
  const fresh = useSyncExternalStore(subscribeLocal, getLocal) // P1002: a chat started from a client who had none yet
  const startedId = String(id || '').startsWith('new-') ? String(id).slice(4) : null
  // Once the first message lands, the real thread (the client's own id) shows up in the list and takes over.
  const t = threads.find(x => x.id === id) || (startedId && threads.find(x => !x.va && x.client_id === startedId))
    || (id === SUPPORT_THREAD ? { ...emptySupport(), empty: true } : null)
    || (startedId ? fresh.find(x => x.id === id) : null)
  if (!t) return <SubPage title="Messages"><p className="ma-empty">This chat isn’t here any more.</p></SubPage>
  if (t.local) return <NewThread key={t.id} t={t} client={clients.find(x => x.id === t.client_id)} />
  return t.dm ? <DmThread key={t.id} t={t} /> : <LocalThread key={t.id} t={t} />
}

// A client with no chat yet (the desktop's Message button always works, Clients.jsx): writing starts it. Real data keys a
// chat by the client's policy, so the first send creates it; the sample keeps it on this phone.
function NewThread({ t, client }) {
  const { sendMessage } = useFulActions()
  const real = useFulSource() === 'real'
  const send = (v, at) => { if (real) sendMessage(t.client_id, v); sendLocal(t.id, v, at) }
  return <ChatView t={{ ...t, agent: client?.agent || t.agent || 'Agent' }} msgs={t.messages || []} onSend={send} />
}

// Sample threads, VA DMs on sample data and the agent threads (per client).
function LocalThread({ t }) {
  const { sendMessage, readThread } = useFulActions()
  useEffect(() => {
    if (!(t.unread > 0)) return
    if (t.va) dmStore.read(t.key)
    else readThread(t.id)
  }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = (v, at) => (t.va ? dmStore.send(t.key, v, at) : sendMessage(t.id, v))
  return <ChatView t={t} msgs={t.messages || []} onSend={send} offline={!!t.empty} />
}

// Real standing threads (Ohvara support, a VA DM): direct_messages.
function DmThread({ t }) {
  const me = useOptionalAuth()?.profile?.id || null
  const { nowMs, tz } = useVaNow()
  const q = useDmMessages(t.dm.agentId, t.dm.peerKey)
  const sendDm = useSendDm(t.dm.agentId, t.dm.peerKey, me)
  const markDm = useMarkDmRead(me)
  useEffect(() => { if (t.unread > 0) markDm.mutate(t.dm) }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const msgs = useMemo(() => (q.data || []).map(m => ({ id: m.id, from: m.sender_id === me ? 'me' : shownName(m.sender_name, m.sender_role) || 'Ohvara', text: m.body, at: whenText(m.created_at, nowMs, tz) })), [q.data, me, nowMs, tz])
  return <ChatView t={t} msgs={msgs} onSend={v => sendDm.mutate(v)} />
}

function ChatView({ t, msgs, onSend, offline = false }) {
  const app = useApp()
  const [text, setText] = useState('')
  const end = useRef(null)
  const root = useRef(null)
  const input = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  useKeyboard(root, input)
  const to = isSupport(t) ? 'Ohvara' : t.va ? firstName(t.name) : `${firstName(t.agent)} about ${firstName(t.name)}`
  const send = e => {
    e.preventDefault()
    const v = text.trim()
    if (!v || offline) return
    onSend(v, `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`)
    setText('')
  }
  const runs = runsOf(msgs, m => whoOf(t, m))
  const foot = (
    <form className="ma-compose" onSubmit={send}>
      <input ref={input} type="text" aria-label={`Message ${to}`} placeholder={offline ? 'Opens soon for VAs' : `Message ${to}`} value={text} disabled={offline} onChange={e => setText(e.target.value)} enterKeyHint="send"
        onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 260)} />
      <button type="submit" className={`ma-send ma-press${text.trim() ? ' is-ready' : ''}`} aria-label="Send" disabled={!text.trim() || offline}><ArrowUp size={19} aria-hidden="true" /></button>
    </form>
  )
  return (
    <div className="ma-chatwrap" ref={root}>
      <SubPage title={titleOf(t)} line={isSupport(t) ? 'Ohvara Support · schedule, pay, anything' : t.va ? 'Just the two of you' : `Agent ${t.agent} · the client doesn't see this`} pin foot={foot} className="is-chat"
        right={!isSupport(t) && !t.va && t.client_id ? <button type="button" className="ma-textbtn va-openclient ma-press" onClick={() => app.openSub('client', { c: t.client_id })}><Users size={16} aria-hidden="true" />Open client</button> : null}>
        <div className="ma-chat">
          {msgs.map((m, i) => {
            const mine = m.from === 'me'
            const r = runs[i]
            return (
              <div key={m.id || i} className={`ma-msg${mine ? ' is-me' : ''}${r.first ? ' is-first' : ''}${r.last ? ' is-last' : ''}`}>
                {r.first && !mine && <small className="ma-msg-who">{whoOf(t, m)}</small>}
                <div className={`ma-bub${r.last ? ' has-tail' : ''}`}>{m.text}</div>
                {r.last && <small className="ma-msg-at">{m.at}</small>}
              </div>
            )
          })}
          {!msgs.length && <p className="ma-empty">{offline ? 'Writing to Ohvara from the app starts once it’s switched on for VAs.' : `Write ${to} anything.`}</p>}
          <span ref={end} />
        </div>
      </SubPage>
    </div>
  )
}
