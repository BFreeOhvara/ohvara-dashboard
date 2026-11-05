import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useSampleThreads, useSampleActions } from '../data'
import { Avatar, Empty } from '../kit'
import { paths } from '../paths'

// Messages between the agent and Ohvara fulfillment, one thread per client (the client never sees them). On a desktop the page holds still: the thread list and the
// conversation each scroll inside their own pane, and the box to write in stays put at the bottom.
export default function Messages() {
  const { data: threads } = useSampleThreads()
  const { sendMessage, readThread } = useSampleActions()
  const [sel, setSel] = useState(threads[0].id)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const t = threads.find(x => x.id === sel)
  const list = threads.filter(x => x.name.toLowerCase().includes(q.trim().toLowerCase()))
  const pick = id => { setSel(id); readThread(id) }
  const send = e => { e.preventDefault(); if (!text.trim()) return; sendMessage(t.id, text.trim()); setText('') }
  return (
    <section className="ov-card tp-msgs" aria-label="Messages">
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a thread" placeholder="Find a client" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === sel ? ' on' : ''}`} onClick={() => pick(x.id)}>
              <Avatar name={x.name} /><span className="tp-grow"><b>About {x.name}</b><small>{x.messages[x.messages.length - 1].text}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
            </button>
          ))}
          {list.length === 0 && <Empty title="No thread" sub="No client by that name." />}
        </div>
      </div>
      <div className="tp-conv">
        <div className="tp-conv-h"><Avatar name={t.name} /><span className="tp-grow"><b>Ohvara fulfillment · about {t.name}</b><small>Your Ohvara team. The client doesn't see this.</small></span><Link to={paths.client(t.client_id)} className="tp-link">Open client<ArrowUpRight size={14} /></Link></div>
        <div className="tp-conv-b">
          {t.messages.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{m.from === 'me' ? 'You' : 'Fulfillment'} · {m.at}</small></div>)}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label={`Message fulfillment about ${t.name.split(' ')[0]}`} placeholder={`Message fulfillment about ${t.name.split(' ')[0]}…`} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-primary fx-accent" disabled={!text.trim()}>Send</button>
        </form>
      </div>
    </section>
  )
}
