import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Search, X } from 'lucide-react'
import { useAdmThreads, useAdmActions } from '../data'
import { useApp, SubPage, Ini, rise } from '../../template/m/AppKit'
import { useKeyboard, useNoAutoKeyboard } from '../../template/m/useKeyboard'
import { runsOf } from '../../template/m/appModel'
import { shortAt } from '../../template/m/threadStore'
import { firstName } from '../../template/m/va/vaModel'
import { useAdmChats, admChats, isLocalChat, JORDAN_THREAD } from './admStore'
import { NO_CONV, NO_CONV_SUB } from '../../template/msgsEmptyText.js'

// P986 — Messages, the same as the agent and VA apps: threads straight on the page, a chat opens from the right with
// bubbles, tails and the send button inside the field. Jordan (the other admin) is pinned at the top, then the team
// group, then every agent and VA line (what they see as "Ohvara Support": you answer as Ohvara Support).
// P1001: Jordan and the team group are gone (desktop has neither); a chat started with someone new still pins first.
// P1002: Find someone (by name), the All / Agents / VAs filter and Open (a chat's person) as on the desktop's Messages.
// P1018 (Brayden, Nov 15): admins see everyone and every conversation, with real names: the other admin (pinned
// first, you write as yourself), every Support line, every client conversation (titled by the client, the agent
// smaller) and every VA-to-VA conversation (read only).
const ROLE_WORD = { Agent: 'Agent · support line', Fulfillment: 'VA · support line', Admin: 'Admin · just the two of you', VAs: 'Between two VAs · read only' }
const aboutOf = t => (t.role === 'Client' ? `Client · agent ${t.agent}` : ROLE_WORD[t.role] || t.role)
const toneOfRole = r => (r === 'Fulfillment' ? 'sage' : 'sky')

function useAllThreads() {
  const { data: threads } = useAdmThreads()
  const local = useAdmChats()
  const lines = threads.map(t => ({ ...t, about: aboutOf(t), tone: toneOfRole(t.role) }))
  const pinned = local.filter(t => !t.fresh || t.messages.length)
  return [...lines.filter(t => t.role === 'Admin'), ...pinned.filter(t => t.id === JORDAN_THREAD), ...pinned.filter(t => t.id !== JORDAN_THREAD), ...lines.filter(t => t.role !== 'Admin')]
}

export default function AMsgs() {
  const app = useApp()
  const all = useAllThreads()
  const [q, setQ] = useState('')
  const input = useRef(null)
  useNoAutoKeyboard(input)
  const n = q.trim().toLowerCase()
  const threads = all.filter(t => `${t.name || ''} ${t.agent || ''}`.toLowerCase().includes(n))
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Messages</h1><small>Everyone, and every conversation</small></span></div>
      <label className="va-find ma-rise" style={rise(0)}><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" enterKeyHint="search" placeholder="Find someone" aria-label="Find a person or client" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      <div className="ma-threads ma-rise" style={rise(0)}>
        {!threads.length && (all.length ? <p className="ma-empty is-glass">Nobody by that name.</p> : <p className="ma-empty is-glass" role="status"><b>{NO_CONV}</b><br />{NO_CONV_SUB.admin}</p>)}
        {threads.map(t => {
          const last = t.messages?.at(-1)
          const unread = t.unread > 0
          return (
            <button key={t.id} type="button" className={`ma-thread va-thread${unread ? ' is-unread' : ''}${t.id === JORDAN_THREAD || t.role === 'Admin' ? ' is-pinned' : ''}`} onClick={() => app.openSub('thread', { t: t.id })}>
              <Ini person name={t.name} size={48} />
              <span className="ma-grow">
                <span className="ma-thread-top"><b>{t.name}</b><small>{shortAt(last?.at)}</small></span>
                <small className="va-about">{t.about}</small>
                <span className="ma-thread-last"><small>{last ? `${last.from === 'me' ? 'You: ' : t.group ? `${firstName(last.from)}: ` : last.who && (t.role === 'Client' || t.role === 'VAs' || last.from === 'team') ? `${firstName(last.who)}: ` : ''}${last.text}` : 'No messages yet'}</small>{unread && <span className="ma-badge is-inline">{t.unread}</span>}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="ma-note">Agents and VAs see your Support replies as Ohvara Support. Admins see who wrote.</p>
    </div>
  )
}

export function AThreadAdm({ id }) {
  const threads = useAllThreads()
  const local = useAdmChats()
  const { sendMessage, readThread } = useAdmActions()
  const t = threads.find(x => x.id === id) || local.find(x => x.id === id)
  const isLocal = isLocalChat(id)
  useEffect(() => {
    if (!t?.unread) return
    if (isLocal) admChats.read(id)
    else readThread(id)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <SubPage title="Messages"><p className="ma-empty">This chat isn’t here any more.</p></SubPage>
  const send = v => (isLocal ? admChats.send(id, v) : sendMessage(id, v))
  return <ChatView t={t} onSend={send} />
}

const whoOf = (t, m) => (m.from === 'me' ? 'You' : t.group ? firstName(m.who || m.from) : m.who ? firstName(m.who) : firstName(t.name))
// Open: the person's own screen (an agent or a VA), from their chat, as the desktop's Messages has it.
const OPEN_SUB = { Agent: 'agent', Fulfillment: 'va' }
function ChatView({ t, onSend }) {
  const app = useApp()
  const [text, setText] = useState('')
  const end = useRef(null)
  const root = useRef(null)
  const input = useRef(null)
  const msgs = t.messages || []
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  useKeyboard(root, input)
  const to = t.group ? 'the team' : t.role === 'Client' ? `the team about ${firstName(t.name)}` : firstName(t.name)
  const send = e => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    onSend(v)
    setText('')
  }
  const runs = runsOf(msgs, m => whoOf(t, m))
  const foot = t.readOnly ? <p className="ma-note">Read only: this is between two VAs.</p> : (
    <form className="ma-compose" onSubmit={send}>
      <input ref={input} type="text" aria-label={`Message ${to}`} placeholder={`Message ${to}`} value={text} onChange={e => setText(e.target.value)} enterKeyHint="send"
        onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 260)} />
      <button type="submit" className={`ma-send ma-press${text.trim() ? ' is-ready' : ''}`} aria-label="Send" disabled={!text.trim()}><ArrowUp size={19} aria-hidden="true" /></button>
    </form>
  )
  return (
    <div className="ma-chatwrap" ref={root}>
      <SubPage title={t.name} line={t.about} pin foot={foot} className="is-chat"
        right={OPEN_SUB[t.role] && t.who ? <button type="button" className="ma-textbtn ma-press" onClick={() => app.openSub(OPEN_SUB[t.role], { t: t.who })}>Open</button> : null}>
        <div className="ma-chat">
          {msgs.map((m, i) => {
            const mine = m.from === 'me' || m.from === 'team'
            const r = runs[i]
            return (
              <div key={m.id || i} className={`ma-msg${mine ? ' is-me' : ''}${r.first ? ' is-first' : ''}${r.last ? ' is-last' : ''}`}>
                {r.first && m.from !== 'me' && <small className="ma-msg-who">{whoOf(t, m)}</small>}
                <div className={`ma-bub${r.last ? ' has-tail' : ''}`}>{m.text}</div>
                {r.last && <small className="ma-msg-at">{m.at}</small>}
              </div>
            )
          })}
          {!msgs.length && <p className="ma-empty">Write {to} anything.</p>}
          <span ref={end} />
        </div>
      </SubPage>
    </div>
  )
}
