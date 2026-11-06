import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, ArrowUpRight } from 'lucide-react'
import { useAdmThreads, useAdmActions, useAdmViewAs, PARTNER } from '../data'
import { Avatar, Chip, Empty, Seg } from '../../template/kit'
import { ap } from '../paths'

// P849 — Messages: the admin line with every agent, every VA and Jordan, one thread per person (today's shared inbox
// for admin). ?to=<person id> opens that person's line (Agents, Fulfillment, Leads and Billing link here). Jordan's
// login sees only the thread with the admin. Same panes as the agent and VA pages. Sample only: nothing is sent.
const PERSON = { Agent: 'agents', Fulfillment: 'team' }

export default function Messages() {
  const { data: all } = useAdmThreads()
  const { data: viewAs } = useAdmViewAs()
  const { sendMessage, readThread } = useAdmActions()
  const [sp] = useSearchParams()
  const partner = viewAs === 'partner'
  const threads = partner ? all.filter(t => t.who === PARTNER.id) : all
  const want = threads.find(t => t.who === sp.get('to'))?.id
  const [sel, setSel] = useState(want || threads[0]?.id)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [who, setWho] = useState('all')
  const t = threads.find(x => x.id === sel) || threads[0]
  const n = q.trim().toLowerCase()
  const list = threads.filter(x => (who === 'all' || x.role === who) && x.name.toLowerCase().includes(n))
  const pick = id => { setSel(id); readThread(id) }
  const send = e => { e.preventDefault(); if (!text.trim() || !t) return; sendMessage(t.id, text.trim(), partner ? 'them' : 'me'); setText('') }
  if (!t) return <Empty title="No messages" sub="Nobody has written yet." />
  const first = t.name.split(' ')[0]
  const otherSide = partner ? 'the Ohvara team' : first
  return (
    <section className="ov-card tp-msgs ad-msgs" aria-label="Messages">
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a person" placeholder="Find someone" value={q} onChange={e => setQ(e.target.value)} /></label>
        {!partner && <Seg label="Who" className="ad-who-seg" value={who} onChange={setWho} options={[{ key: 'all', label: 'All' }, { key: 'Agent', label: 'Agents' }, { key: 'Fulfillment', label: 'VAs' }, { key: 'Partner', label: 'Partner' }]} />}
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === t.id ? ' on' : ''}`} onClick={() => pick(x.id)}>
              <Avatar name={x.name} /><span className="tp-grow"><b>{x.name}</b><small>{x.role} · {x.messages[x.messages.length - 1].text}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
            </button>
          ))}
          {list.length === 0 && <Empty title="No thread" sub="Nobody by that name." />}
        </div>
      </div>
      <div className="tp-conv">
        <div className="tp-conv-h">
          <Avatar name={partner ? 'Ohvara Team' : t.name} />
          <span className="tp-grow"><b>{partner ? 'Ohvara team' : t.name}</b><small>{partner ? 'Your line with the admins' : `${t.role} · the admin line. Only admins and ${first} see this.`}</small></span>
          {!partner && <Chip tone={t.role === 'Agent' ? 'blue' : t.role === 'Partner' ? 'teal' : 'green'}>{t.role}</Chip>}
          {!partner && PERSON[t.role] && <Link to={ap(PERSON[t.role], t.who)} className="tp-link">Open<ArrowUpRight size={14} /></Link>}
        </div>
        <div className="tp-conv-b">
          {t.messages.map(m => {
            const mine = partner ? m.from === 'them' : m.from === 'me'
            return <div key={m.id} className={`tp-bub${mine ? ' me' : ''}`}>{m.text}<small>{mine ? 'You' : partner ? 'Ohvara team' : t.name} · {m.at}</small></div>
          })}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label={`Message ${otherSide}`} placeholder={`Message ${otherSide}…`} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-primary fx-accent" disabled={!text.trim()}>Send</button>
        </form>
      </div>
    </section>
  )
}
