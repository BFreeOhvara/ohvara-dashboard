import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, Search, X, ArrowUpRight } from 'lucide-react'
import { useSampleThreads, useSampleActions, useDataSource } from '../data'
import { useAuth } from '../../hooks/useAuth'
import { useDmMessages, useSendDm } from '../../hooks/useDirectMessages'
import { isSupport, emptySupport, pinSupport } from '../support911'
import { paths } from '../paths'
import { threadMatches } from './p1002'
import { useApp, SubPage, Ini, rise } from './AppKit'
import { runsOf } from './appModel'
import { subscribeLocal, getLocal, sendLocal, shortAt } from './threadStore'
import { useKeyboard } from './useKeyboard'
import { NO_CONV, NO_CONV_SUB } from '../msgsEmptyText.js'

// P967 — Messages: you and the Ohvara team. Threads sit straight on the page with hairlines between them (no box, no
// pencil). A thread opens as its own screen: the team on the left with who wrote, you on the right in dark, and the
// send button inside the typing pill. Ohvara Support stays pinned at the top (P911): sample, a thread in the sample
// store; real, the agent's standing line with admin (direct_messages, P701).
const SupportCtx = createContext({ thread: null, send: () => {} })
function RealSupport({ children }) {
  const { profile } = useAuth()
  const me = profile?.id || null
  const dm = useDmMessages(me, me ? 'admin' : null)
  const send = useSendDm(me, 'admin', me)
  const thread = useMemo(() => (me ? { ...emptySupport(), messages: (dm.data || []).map(m => ({ id: m.id, from: m.sender_id === me ? 'me' : 'team', text: m.body, at: new Date(m.created_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })) } : null), [dm.data, me])
  const value = useMemo(() => ({ thread, send: text => send.mutate(text) }), [thread, send])
  return <SupportCtx.Provider value={value}>{children}</SupportCtx.Provider>
}
// The real support line is read only in real mode (the sample /template page has no sign-in).
export function SupportProvider({ children }) {
  const source = useDataSource()
  return source === 'sample' ? children : <RealSupport>{children}</RealSupport>
}

export function useThreadList() {
  const { data: rows } = useSampleThreads()
  const real = useContext(SupportCtx)
  const local = useSyncExternalStore(subscribeLocal, getLocal)
  const hasSup = rows.some(isSupport)
  const threads = useMemo(() => {
    const all = real.thread && !hasSup ? [real.thread, ...rows] : rows
    const extra = local.filter(t => t.messages.length && !all.some(x => x.client_id && x.client_id === t.client_id))
    return [...all.filter(isSupport), ...extra, ...all.filter(t => !isSupport(t))]
  }, [rows, real.thread, hasSup, local])
  return { threads, local, realSupportId: !hasSup && real.thread ? real.thread.id : null, sendReal: real.send }
}

const toneOf = t => (isSupport(t) ? 'stone' : t.client_id ? 'sage' : 'sky')
const lastOf = t => t.messages?.[t.messages.length - 1]
const whoOf = (t, m) => (m.from === 'me' ? 'You' : m.who || (isSupport(t) ? 'Ohvara Support' : 'Our team'))

export default function AMessages() {
  const app = useApp()
  const { threads: all } = useThreadList()
  const [q, setQ] = useState('')
  // P1002: search by client (the desktop's "Find a client"); Ohvara Support stays at the top whatever the search says.
  const threads = pinSupport(all, t => threadMatches(t, q))
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Messages</h1><small>You and the Ohvara team</small></span></div>
      <label className="ma-search is-small ma-rise" style={rise(0)}><Search size={18} aria-hidden="true" /><input type="search" aria-label="Find a thread" placeholder="Find a client" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      <div className="ma-threads ma-rise" style={rise(0)}>
        {threads.map(t => {
          const last = lastOf(t)
          const unread = t.unread > 0
          return (
            <button key={t.id} type="button" className={`ma-thread${unread ? ' is-unread' : ''}`} onClick={() => app.openSub('thread', { t: t.id })}>
              <Ini name={t.name} tone={toneOf(t)} size={48} />
              <span className="ma-grow">
                <span className="ma-thread-top"><b>{t.name}</b><small>{shortAt(last?.at)}</small></span>
                <span className="ma-thread-last"><small>{last ? `${whoOf(t, last)}: ${last.text}` : 'No messages yet'}</small>{unread && <span className="ma-badge is-inline">{t.unread}</span>}</span>
              </span>
            </button>
          )
        })}
        {!q.trim() && !all.some(t => !isSupport(t)) && <p className="ma-empty is-glass" role="status"><b>{NO_CONV}</b><br />{NO_CONV_SUB.agent}</p>}
        {q.trim() && !threads.some(t => !isSupport(t)) && <p className="ma-empty"><b>No thread</b><br />No client by that name.</p>}
      </div>
      <p className="ma-note">Each chat is about one person. Our team answers here, usually within minutes.</p>
    </div>
  )
}


export function AThread({ id }) {
  const app = useApp()
  const { threads, local, realSupportId, sendReal } = useThreadList()
  const { sendMessage, readThread } = useSampleActions()
  const [text, setText] = useState('')
  const end = useRef(null)
  const root = useRef(null)
  const input = useRef(null)
  const t = threads.find(x => x.id === id) || local.find(x => x.id === id)
  const real = t && t.id === realSupportId
  useEffect(() => { if (t && !real && !t.local && t.unread > 0) readThread(t.id) }, [t?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [t?.messages?.length])
  useKeyboard(root, input)
  if (!t) return <SubPage title="Messages"><p className="ma-empty">This chat isn’t here any more.</p></SubPage>
  const send = e => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    if (real) sendReal(v)
    else if (t.local) sendLocal(t.id, v, new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
    else sendMessage(t.id, v)
    setText('')
  }
  const msgs = t.messages || []
  const runs = runsOf(msgs, m => whoOf(t, m))
  const foot = (
    <form className="ma-compose" onSubmit={send}>
      <input ref={input} type="text" aria-label="Message the team" placeholder="Message the team" value={text} onChange={e => setText(e.target.value)} enterKeyHint="send"
        onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 260)} />
      <button type="submit" className={`ma-send ma-press${text.trim() ? ' is-ready' : ''}`} aria-label="Send" disabled={!text.trim()}><ArrowUp size={19} aria-hidden="true" /></button>
    </form>
  )
  return (
    <div className="ma-chatwrap" ref={root}>
      <SubPage pin title={t.name} line="with the Ohvara team" foot={foot} className="is-chat"
        right={t.client_id && !isSupport(t) ? <button type="button" className="ma-textbtn ma-press" onClick={() => app.open(paths.client(t.client_id))}>Open client<ArrowUpRight size={16} aria-hidden="true" /></button> : null}>
        <div className="ma-chat">
          {msgs.map((m, i) => {
            const me = m.from === 'me'
            const r = runs[i]
            return (
              <div key={m.id || i} className={`ma-msg${me ? ' is-me' : ''}${r.first ? ' is-first' : ''}${r.last ? ' is-last' : ''}`}>
                {r.first && !me && <small className="ma-msg-who">{whoOf(t, m)}</small>}
                <div className={`ma-bub${r.last ? ' has-tail' : ''}`}>{m.text}</div>
                {r.last && <small className="ma-msg-at">{m.at}</small>}
              </div>
            )
          })}
          {!msgs.length && <p className="ma-empty">Write the team anything about {isSupport(t) ? 'your account' : t.name.split(' ')[0]}.</p>}
          <span ref={end} />
        </div>
      </SubPage>
    </div>
  )
}
