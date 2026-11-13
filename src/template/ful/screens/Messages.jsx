import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight, MessageSquare, Pin } from 'lucide-react'
import { FirstRun } from '../../DataState'
import { useFulThreads, useFulActions } from '../data'
import { Avatar, Empty } from '../../kit'
import { fp } from '../paths'
import { SUPPORT_NAME, isSupport, pinSupport, emptySupport } from '../../support911'

// P845 — Messages, the agent's page mirrored: the VA and an agent, one thread per client. P847: the client comes first
// (the thread is titled "Gloria Santos"; "Agent: Dana Walker" sits under it). The client never sees these. Same panes: the list and the conversation scroll on their own and the
// box to write in stays at the bottom. Sample only.
// P911: Ohvara Support (the admin team) is pinned at the top and can't be hidden. Real VA data has no admin line yet
// (direct_messages is agent-keyed): it shows pinned and empty, and writing to it waits for that backend.
export default function Messages() {
  const { data: rows } = useFulThreads()
  const hasSup = rows.some(isSupport)
  const threads = useMemo(() => (hasSup ? rows : [emptySupport(), ...rows]), [rows, hasSup])
  const { sendMessage, readThread } = useFulActions()
  const [sel, setSel] = useState(() => threads.find(x => !isSupport(x))?.id || threads[0]?.id)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const t = threads.find(x => x.id === sel) || threads[0]
  const n = q.trim().toLowerCase()
  const list = pinSupport(threads, x => `${x.name} ${x.agent}`.toLowerCase().includes(n))
  const sup = isSupport(t)
  const offline = sup && !hasSup
  const pick = id => { setSel(id); if (!(isSupport({ id }) && !hasSup)) readThread(id) }
  const send = e => { e.preventDefault(); if (!text.trim() || offline) return; sendMessage(t.id, text.trim()); setText('') }
  // P852: a VA with no threads yet (real data) sees how one starts, not an empty pane.
  if (!t) return <div className="tp-page fx-page"><FirstRun icon={MessageSquare} title="No messages yet" sub="When an agent writes to you about one of their clients, or you write from a client or a servicing step, the thread shows here. The client never sees it." /></div>
  const agentFirst = sup ? SUPPORT_NAME : t.agent.split(' ')[0]
  return (
    <section className="ov-card tp-msgs" aria-label="Messages">
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a thread" placeholder="Find a client or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === t.id ? ' on' : ''}${isSupport(x) ? ' is-support' : ''}`} onClick={() => pick(x.id)} aria-label={isSupport(x) ? `${SUPPORT_NAME}, pinned` : undefined}>
              <Avatar name={x.name} /><span className="tp-grow"><b>{x.name}</b>{isSupport(x) ? <small className="ful-thread-agent">The Ohvara admin team</small> : <small className="ful-thread-agent">Agent: {x.agent}</small>}<small>{x.messages.at(-1)?.text || ''}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
              {isSupport(x) && !(x.unread > 0) && <Pin size={13} className="sl-pin" aria-hidden="true" />}
            </button>
          ))}
          {list.filter(x => !isSupport(x)).length === 0 && n && <Empty title="No thread" sub="No client or agent by that name." />}
        </div>
      </div>
      <div className="tp-conv">
        {sup
          ? <div className="tp-conv-h"><Avatar name={SUPPORT_NAME} /><span className="tp-grow"><b>{SUPPORT_NAME}</b><small>The Ohvara admin team. Shifts, pay, the app, anything.</small></span></div>
          : <div className="tp-conv-h"><Avatar name={t.name} /><span className="tp-grow"><b>{t.name}</b><small className="ful-thread-agent">Agent: {t.agent}</small><small>Between you and the agent. The client doesn't see this.</small></span><Link to={fp('clients', t.client_id)} className="tp-link">Open client<ArrowUpRight size={14} /></Link></div>}
        <div className="tp-conv-b">
          {t.messages.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{m.from === 'me' ? 'You' : sup ? SUPPORT_NAME : t.agent} · {m.at}</small></div>)}
          {sup && t.messages.length === 0 && <p className="tp-sub">{offline ? 'Writing to Ohvara Support from here starts once it’s switched on for VAs.' : 'Write to Ohvara Support. We answer, usually the same day.'}</p>}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label={sup ? `Message ${SUPPORT_NAME}` : `Message ${agentFirst} about ${t.name.split(' ')[0]}`} placeholder={sup ? `Message ${SUPPORT_NAME}…` : `Message ${agentFirst} about ${t.name.split(' ')[0]}…`} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-primary fx-accent" disabled={!text.trim() || offline}>Send</button>
        </form>
      </div>
    </section>
  )
}
