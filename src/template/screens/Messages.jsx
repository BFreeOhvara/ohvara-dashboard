import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight, MessageSquare, Pin } from 'lucide-react'
import { useSampleThreads, useSampleActions, useDataSource } from '../data'
import { Avatar, Empty } from '../kit'
import { paths } from '../paths'
import { FirstRun } from '../DataState'
import { useAuth } from '../../hooks/useAuth'
import { useDmMessages, useSendDm } from '../../hooks/useDirectMessages'
import { SUPPORT_NAME, isSupport, pinSupport, emptySupport } from '../support911'

// Messages between the agent and Ohvara fulfillment, one thread per client (the client never sees them). On a desktop the page holds still: the thread list and the
// conversation each scroll inside their own pane, and the box to write in stays put at the bottom.
// P911: Ohvara Support (the admin team) is pinned at the top. Sample: a thread in the sample store. Real: the agent's
// standing line with admin (direct_messages, peer 'admin', P701), which admins read in admin Messages.
// The real line is read only in real mode (the sample /template page has no sign-in): this wrapper holds those hooks.
function RealSupport({ children }) {
  const { profile } = useAuth()
  const me = profile?.id || null
  const dm = useDmMessages(me, me ? 'admin' : null)
  const send = useSendDm(me, 'admin', me)
  const thread = useMemo(() => ({ ...emptySupport(), messages: (dm.data || []).map(m => ({ id: m.id, from: m.sender_id === me ? 'me' : 'team', text: m.body, at: new Date(m.created_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) })) }), [dm.data, me])
  return children(thread, text => send.mutate(text))
}

export default function Messages() {
  const source = useDataSource()
  if (source === 'sample') return <Inbox />
  return <RealSupport>{(thread, sendReal) => <Inbox realSupport={thread} sendReal={sendReal} />}</RealSupport>
}

function Inbox({ realSupport = null, sendReal = null }) {
  const { data: rows } = useSampleThreads()
  const { sendMessage, readThread } = useSampleActions()
  const hasSup = rows.some(isSupport)
  const support = { thread: hasSup ? null : realSupport, sendReal: hasSup ? null : sendReal }
  const threads = useMemo(() => (realSupport && !hasSup ? [realSupport, ...rows] : rows), [rows, realSupport, hasSup])
  const [sel, setSel] = useState(() => threads.find(t => !isSupport(t) && t.unread > 0)?.id || threads.find(t => !isSupport(t))?.id || threads[0]?.id)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const t = threads.find(x => x.id === sel) || threads[0]
  const n = q.trim().toLowerCase()
  // Ohvara Support stays at the top whatever the search says (it can't be hidden).
  const list = pinSupport(threads, x => x.name.toLowerCase().includes(n))
  // The real support line isn't a client thread: no policy read mark for it.
  const pick = id => { setSel(id); if (!(id === support.thread?.id && support.sendReal)) readThread(id) }
  const sup = isSupport(t)
  const send = e => {
    e.preventDefault()
    if (!text.trim()) return
    if (sup && support.sendReal) support.sendReal(text.trim()); else sendMessage(t.id, text.trim())
    setText('')
  }
  // P848: nothing yet (a new agent): what shows here and how the first thread starts.
  if (!t) return <div className="tp-page fx-page"><FirstRun icon={MessageSquare} title="Messages with the team show here" sub="One thread per client. When the team needs you on a client, they write here, and you can write to them from any client's page."><Link to={paths.clients()} className="tp-primary fx-accent">Go to your clients</Link></FirstRun></div>
  const first = t.name.split(' ')[0]
  return (
    // P867: on a phone the card is sized to the window too (data-fold-fit), so the page holds still there as well
    <section className="ov-card tp-msgs" aria-label="Messages" data-fold data-fold-fit="440" data-fold-phone>
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a thread" placeholder="Find a client" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === t.id ? ' on' : ''}${isSupport(x) ? ' is-support' : ''}`} onClick={() => pick(x.id)} aria-label={isSupport(x) ? `${SUPPORT_NAME}, pinned` : undefined}>
              <Avatar name={x.name} /><span className="tp-grow"><b>{isSupport(x) ? SUPPORT_NAME : `About ${x.name}`}</b><small>{x.messages[x.messages.length - 1]?.text || (isSupport(x) ? 'Write to the Ohvara team' : 'No messages yet')}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
              {isSupport(x) && !(x.unread > 0) && <Pin size={13} className="sl-pin" aria-hidden="true" />}
            </button>
          ))}
          {list.filter(x => !isSupport(x)).length === 0 && n && <Empty title="No thread" sub="No client by that name." />}
        </div>
      </div>
      <div className="tp-conv">
        {sup
          ? <div className="tp-conv-h"><Avatar name={SUPPORT_NAME} /><span className="tp-grow"><b>{SUPPORT_NAME}</b><small>The Ohvara admin team. Account, billing, leads, anything.</small></span></div>
          : <div className="tp-conv-h"><Avatar name={t.name} /><span className="tp-grow"><b>Ohvara fulfillment · about {t.name}</b><small>Your Ohvara team. The client doesn't see this.</small></span><Link to={paths.client(t.client_id)} className="tp-link">Open client<ArrowUpRight size={14} /></Link></div>}
        <div className="tp-conv-b">
          {t.messages.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{m.from === 'me' ? 'You' : sup ? SUPPORT_NAME : 'Fulfillment'} · {m.at}</small></div>)}
          {sup && t.messages.length === 0 && <p className="tp-sub">Write to the Ohvara admin team. Brayden or Jordan answers, usually the same day.</p>}
        </div>
        <form className="tp-conv-f" onSubmit={send}>
          <input className="tp-input" aria-label={sup ? `Message ${SUPPORT_NAME}` : `Message fulfillment about ${first}`} placeholder={sup ? `Message ${SUPPORT_NAME}…` : `Message fulfillment about ${first}…`} value={text} onChange={e => setText(e.target.value)} />
          <button type="submit" className="tp-primary fx-accent" disabled={!text.trim()}>Send</button>
        </form>
      </div>
    </section>
  )
}
