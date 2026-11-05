import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useFulThreads, useFulActions } from '../data'
import { Avatar, Empty } from '../../kit'
import { fp } from '../paths'

// P845 — Messages, the agent's page mirrored: the VA and an agent, one thread per client ("Agent Dana Walker · about
// Gloria Santos"). The client never sees these. Same panes: the list and the conversation scroll on their own and the
// box to write in stays at the bottom. Sample only.
export default function Messages() {
  const { data: threads } = useFulThreads()
  const { sendMessage, readThread } = useFulActions()
  const [sel, setSel] = useState(threads[0].id)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const t = threads.find(x => x.id === sel)
  const n = q.trim().toLowerCase()
  const list = threads.filter(x => `${x.name} ${x.agent}`.toLowerCase().includes(n))
  const pick = id => { setSel(id); readThread(id) }
  const send = e => { e.preventDefault(); if (!text.trim()) return; sendMessage(t.id, text.trim()); setText('') }
  const agentFirst = t.agent.split(' ')[0]
  return (
    <section className="ov-card tp-msgs" aria-label="Messages">
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a thread" placeholder="Find a client or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === sel ? ' on' : ''}`} onClick={() => pick(x.id)}>
              <Avatar name={x.agent} /><span className="tp-grow"><b>{x.agent} · about {x.name}</b><small>{x.messages[x.messages.length - 1].text}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
            </button>
          ))}
          {list.length === 0 && <Empty title="No thread" sub="No client or agent by that name." />}
        </div>
      </div>
      <div className="tp-conv">
        <div className="tp-conv-h"><Avatar name={t.agent} /><span className="tp-grow"><b>Agent {t.agent} · about {t.name}</b><small>Between you and the agent. The client doesn't see this.</small></span><Link to={fp('clients', t.client_id)} className="tp-link">Open client<ArrowUpRight size={14} /></Link></div>
        <div className="tp-conv-b">
          {t.messages.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{m.from === 'me' ? 'You' : t.agent} · {m.at}</small></div>)}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label={`Message ${agentFirst} about ${t.name.split(' ')[0]}`} placeholder={`Message ${agentFirst} about ${t.name.split(' ')[0]}…`} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-primary fx-accent" disabled={!text.trim()}>Send</button>
        </form>
      </div>
    </section>
  )
}
