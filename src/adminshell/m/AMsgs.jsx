import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useAdmThreads, useAdmActions } from '../data'
import { useApp, SubPage, Ini, rise } from '../../template/m/AppKit'
import { useKeyboard } from '../../template/m/useKeyboard'
import { runsOf } from '../../template/m/appModel'
import { shortAt } from '../../template/m/threadStore'
import { firstName } from '../../template/m/va/vaModel'
import { useAdmChats, admChats, isLocalChat, JORDAN_THREAD } from './admStore'

// P986 — Messages, the same as the agent and VA apps: threads straight on the page, a chat opens from the right with
// bubbles, tails and the send button inside the field. Jordan (the other admin) is pinned at the top, then the team
// group, then every agent and VA line (what they see as "Ohvara Support": you answer as Ohvara Support).
const ROLE_WORD = { Agent: 'Agent · support line', Fulfillment: 'VA · support line' }
const toneOfRole = r => (r === 'Fulfillment' ? 'sage' : 'sky')

function useAllThreads() {
  const { data: threads } = useAdmThreads()
  const local = useAdmChats()
  const lines = threads.map(t => ({ ...t, about: ROLE_WORD[t.role] || t.role, tone: toneOfRole(t.role) }))
  const pinned = local.filter(t => !t.fresh || t.messages.length)
  return [...pinned.filter(t => t.id === JORDAN_THREAD), ...pinned.filter(t => t.id !== JORDAN_THREAD), ...lines]
}

export default function AMsgs() {
  const app = useApp()
  const threads = useAllThreads()
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Messages</h1><small>Jordan, the team, agents and VAs</small></span></div>
      <div className="ma-threads ma-rise" style={rise(0)}>
        {threads.map(t => {
          const last = t.messages?.at(-1)
          const unread = t.unread > 0
          return (
            <button key={t.id} type="button" className={`ma-thread va-thread${unread ? ' is-unread' : ''}${t.id === JORDAN_THREAD ? ' is-pinned' : ''}`} onClick={() => app.openSub('thread', { t: t.id })}>
              <Ini name={t.name} tone={t.tone} size={48} />
              <span className="ma-grow">
                <span className="ma-thread-top"><b>{t.name}</b><small>{shortAt(last?.at)}</small></span>
                <small className="va-about">{t.about}</small>
                <span className="ma-thread-last"><small>{last ? `${last.from === 'me' ? 'You: ' : t.group ? `${firstName(last.from)}: ` : ''}${last.text}` : 'No messages yet'}</small>{unread && <span className="ma-badge is-inline">{t.unread}</span>}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="ma-note">Agents and VAs see your replies as Ohvara Support.</p>
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

const whoOf = (t, m) => (m.from === 'me' ? 'You' : t.group ? firstName(m.who || m.from) : firstName(t.name))
function ChatView({ t, onSend }) {
  const [text, setText] = useState('')
  const end = useRef(null)
  const root = useRef(null)
  const input = useRef(null)
  const msgs = t.messages || []
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  useKeyboard(root, input)
  const to = t.group ? 'the team' : firstName(t.name)
  const send = e => {
    e.preventDefault()
    const v = text.trim()
    if (!v) return
    onSend(v)
    setText('')
  }
  const runs = runsOf(msgs, m => whoOf(t, m))
  const foot = (
    <form className="ma-compose" onSubmit={send}>
      <input ref={input} type="text" aria-label={`Message ${to}`} placeholder={`Message ${to}`} value={text} onChange={e => setText(e.target.value)} enterKeyHint="send"
        onFocus={() => setTimeout(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 260)} />
      <button type="submit" className={`ma-send ma-press${text.trim() ? ' is-ready' : ''}`} aria-label="Send" disabled={!text.trim()}><ArrowUp size={19} aria-hidden="true" /></button>
    </form>
  )
  return (
    <div className="ma-chatwrap" ref={root}>
      <SubPage title={t.name} line={t.about} pin foot={foot} className="is-chat">
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
          {!msgs.length && <p className="ma-empty">Write {to} anything.</p>}
          <span ref={end} />
        </div>
      </SubPage>
    </div>
  )
}
