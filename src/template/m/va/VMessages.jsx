import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { useFulActions } from '../../ful/data'
import { isSupport, emptySupport, SUPPORT_THREAD } from '../../support911'
import { useApp, SubPage, Ini, rise } from '../AppKit'
import { useKeyboard } from '../useKeyboard'
import { runsOf } from '../appModel'
import { shortAt } from '../threadStore'
import { firstName } from './vaModel'
import { useVaThreads, teamStore } from './vaStore'

// P975 — Messages: threads straight on the page. Each agent thread is about one client (the agent and the VA; the
// client never sees it). Your team on shift today (sample until the team-chat backend), and Ohvara for the schedule,
// pay and anything else (Support, P911: pinned; on real data its writing waits for the VA support line). A thread
// opens as the agent app's chat: bubbles at most 80 %, tails, send inside the field, drag down to drop the keyboard.
const titleOf = t => (isSupport(t) ? 'Ohvara' : t.team ? t.name : t.agent)
const aboutOf = t => (isSupport(t) ? 'Schedule, pay and anything else' : t.team ? 'Your team today' : `Agent · about ${t.name}`)
const toneOf = t => (isSupport(t) ? 'stone' : t.team ? 'sage' : 'sky')
const whoOf = (t, m) => (m.from === 'me' ? 'You' : t.team ? firstName(m.from) : isSupport(t) ? 'Ohvara' : firstName(t.agent))

export default function VMessages() {
  const app = useApp()
  const threads = useVaThreads()
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Messages</h1><small>Agents and your team</small></span></div>
      <div className="ma-threads ma-rise" style={rise(0)}>
        {threads.map(t => {
          const last = t.messages?.at(-1)
          const unread = t.unread > 0
          return (
            <button key={t.id} type="button" className={`ma-thread va-thread${unread ? ' is-unread' : ''}`} onClick={() => app.openSub('thread', { t: t.id })}>
              <Ini name={titleOf(t)} tone={toneOf(t)} size={48} />
              <span className="ma-grow">
                <span className="ma-thread-top"><b>{titleOf(t)}</b><small>{shortAt(last?.at)}</small></span>
                <small className="va-about">{aboutOf(t)}</small>
                <span className="ma-thread-last"><small>{last ? `${last.from === 'me' ? 'You: ' : ''}${last.text}` : isSupport(t) ? 'Write to Brayden or Jordan' : 'No messages yet'}</small>{unread && <span className="ma-badge is-inline">{t.unread}</span>}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="ma-note">Agents write here about their clients. The client never sees these.</p>
    </div>
  )
}

export function VThread({ id }) {
  const threads = useVaThreads()
  const { sendMessage, readThread } = useFulActions()
  const [text, setText] = useState('')
  const end = useRef(null)
  const root = useRef(null)
  const input = useRef(null)
  const t = threads.find(x => x.id === id) || (id === SUPPORT_THREAD ? { ...emptySupport(), empty: true } : null)
  const offline = !!t?.empty
  useEffect(() => {
    if (!t || !(t.unread > 0)) return
    if (t.team) teamStore.read()
    else readThread(t.id)
  }, [t?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [t?.messages?.length])
  useKeyboard(root, input)
  if (!t) return <SubPage title="Messages"><p className="ma-empty">This chat isn’t here any more.</p></SubPage>
  const to = isSupport(t) ? 'Ohvara' : t.team ? 'the team' : firstName(t.agent)
  const send = e => {
    e.preventDefault()
    const v = text.trim()
    if (!v || offline) return
    const at = `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    if (t.team) teamStore.send(v, at)
    else sendMessage(t.id, v)
    setText('')
  }
  const msgs = t.messages || []
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
      <SubPage title={titleOf(t)} line={isSupport(t) ? 'Brayden and Jordan · schedule, pay, anything' : t.team ? 'Your team on shift today' : `About ${t.name} · the client doesn't see this`} foot={foot} className="is-chat">
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
          {!msgs.length && <p className="ma-empty">{offline ? 'Writing to Ohvara from the app starts once it’s switched on for VAs.' : `Write ${to} anything${t.name && !isSupport(t) && !t.team ? ` about ${firstName(t.name)}` : ''}.`}</p>}
          <span ref={end} />
        </div>
      </SubPage>
    </div>
  )
}
