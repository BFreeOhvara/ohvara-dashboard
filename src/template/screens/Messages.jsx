import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSampleThreads, useSampleActions } from '../data'
import { Avatar } from '../kit'

export default function Messages() {
  const { data: threads } = useSampleThreads()
  const { sendMessage, readThread } = useSampleActions()
  const [sel, setSel] = useState(threads[0].id)
  const [text, setText] = useState('')
  const t = threads.find(x => x.id === sel)
  const pick = id => { setSel(id); readThread(id) }
  const send = e => { e.preventDefault(); if (!text.trim()) return; sendMessage(t.id, text.trim()); setText('') }
  return (
    <section className="ov-card tp-msgs" aria-label="Messages">
      <div className="tp-threads">
        {threads.map(x => (
          <button key={x.id} type="button" className={`tp-thread${x.id === sel ? ' on' : ''}`} onClick={() => pick(x.id)}>
            <Avatar name={x.name} tone="blue" /><span className="tp-grow"><b>{x.name}</b><small>{x.messages[x.messages.length - 1].text}</small></span>
            {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
          </button>
        ))}
      </div>
      <div className="tp-conv">
        <div className="tp-row tp-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--ov-line)' }}><b>{t.name}</b><Link to={`/clients/${t.client_id}`} className="tp-link">Open client</Link></div>
        <div className="tp-conv-b">
          {t.messages.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{m.from === 'me' ? 'You' : 'Fulfillment'} · {m.at}</small></div>)}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label="Write a message" placeholder="Write a message" value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="ov-hero tp-primary" disabled={!text.trim()}>Send</button>
        </form>
      </div>
    </section>
  )
}
