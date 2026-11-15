import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpRight, Pin } from 'lucide-react'
import { useFulActions, useFulSource } from '../data'
import { Avatar, Empty } from '../../kit'
import { fp } from '../paths'
import { SUPPORT_NAME, isSupport, shownName } from '../../support911'
import { ListEmpty, PickConversation } from '../../msgsEmpty'
import { useVaThreads, dmStore } from '../../m/va/vaStore'
import { VaStandingProvider } from '../../m/va/VMessages'
import { useOptionalAuth } from '../../../hooks/useAuth'
import { useDmMessages, useSendDm, useMarkDmRead } from '../../../hooks/useDirectMessages'

// P845 — Messages, the agent's page mirrored. P847: a client conversation is titled by the client ("Gloria Santos";
// "Agent: Dana Walker" under it). The client never sees these. Same panes: the list and the conversation scroll on
// their own and the box to write in stays at the bottom.
// P911: Ohvara Support (the admin team) is pinned at the top and can't be hidden.
// P1018 (Brayden, Nov 15): a VA sees Ohvara Support, every other VA (from account creation; a direct chat, as on the
// phone) and every client conversation (any VA can pick one up). No list of agents. Real: Support and the VA chats are
// the standing lines (direct_messages), the same list the phone reads (useVaThreads).
export default function Messages() {
  const real = useFulSource() === 'real'
  return real ? <VaStandingProvider><Inbox /></VaStandingProvider> : <Inbox />
}

const kindOf = x => (isSupport(x) ? 'support' : x.va ? 'va' : 'client')
const subOf = x => (isSupport(x) ? 'The Ohvara admin team' : x.va ? 'VA' : `Agent: ${x.agent}`)
const lastText = x => (x.last || x.messages?.at(-1))?.text || ''

function Inbox() {
  const threads = useVaThreads()
  const [sel, setSel] = useState(() => threads.find(x => !isSupport(x) && x.unread > 0)?.id || threads.find(x => !isSupport(x) && !x.va)?.id)
  const [q, setQ] = useState('')
  // P1013: with only Ohvara Support (no conversations yet) nothing opens by itself: "Pick a conversation".
  const t = threads.find(x => x.id === sel) || null
  const n = q.trim().toLowerCase()
  const list = threads.filter(x => isSupport(x) || `${x.name} ${x.agent || ''}`.toLowerCase().includes(n))
  return (
    <section className="ov-card tp-msgs" aria-label="Messages">
      <div className="tp-threads">
        <label className="tp-find tp-threads-find"><Search size={15} aria-hidden="true" /><input aria-label="Find a thread" placeholder="Find a VA, client or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="tp-threads-b">
          {list.map(x => (
            <button key={x.id} type="button" className={`tp-thread${x.id === t?.id ? ' on' : ''}${isSupport(x) ? ' is-support' : ''}`} onClick={() => setSel(x.id)} aria-label={isSupport(x) ? `${SUPPORT_NAME}, pinned` : undefined}>
              <Avatar name={isSupport(x) ? SUPPORT_NAME : x.name} /><span className="tp-grow"><b>{isSupport(x) ? SUPPORT_NAME : x.name}</b><small className="ful-thread-agent">{subOf(x)}</small><small>{lastText(x)}</small></span>
              {x.unread > 0 && <span className="tp-tb is-msg">{x.unread}</span>}
              {isSupport(x) && !(x.unread > 0) && <Pin size={13} className="sl-pin" aria-hidden="true" />}
            </button>
          ))}
          {list.filter(x => !isSupport(x)).length === 0 && (n ? <Empty title="No thread" sub="No VA, client or agent by that name." /> : <ListEmpty who="va" />)}
        </div>
      </div>
      <div className="tp-conv">
        {!t ? <PickConversation /> : t.dm ? <DmPane key={t.id} t={t} /> : <LocalPane key={t.id} t={t} />}
      </div>
    </section>
  )
}

// Sample threads, sample VA chats and every client conversation.
function LocalPane({ t }) {
  const { sendMessage, readThread } = useFulActions()
  const sample = useFulSource() === 'sample'
  useEffect(() => {
    if (!(t.unread > 0)) return
    if (t.va) dmStore.read(t.key)
    else readThread(t.id)
  }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const offline = isSupport(t) && !!t.empty && !sample
  const send = v => (t.va ? dmStore.send(t.key, v, `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`) : sendMessage(t.id, v))
  return <Pane t={t} msgs={t.messages || []} onSend={send} offline={offline} />
}

// Real standing lines: Ohvara Support and a VA chat (direct_messages).
function DmPane({ t }) {
  const me = useOptionalAuth()?.profile?.id || null
  const q = useDmMessages(t.dm.agentId, t.dm.peerKey)
  const sendDm = useSendDm(t.dm.agentId, t.dm.peerKey, me)
  const markDm = useMarkDmRead(me)
  useEffect(() => { if (t.unread > 0) markDm.mutate(t.dm) }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const msgs = useMemo(() => (q.data || []).map(m => ({ id: m.id, from: m.sender_id === me ? 'me' : 'them', who: shownName(m.sender_name, m.sender_role) || '', text: m.body, at: new Date(m.created_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) })), [q.data, me])
  return <Pane t={t} msgs={msgs} onSend={v => sendDm.mutate(v)} />
}

function Pane({ t, msgs, onSend, offline = false }) {
  const [text, setText] = useState('')
  const kind = kindOf(t)
  const first = String(t.name || '').split(' ')[0]
  const agentFirst = String(t.agent || '').split(' ')[0]
  const send = e => { e.preventDefault(); if (!text.trim() || offline) return; onSend(text.trim()); setText('') }
  const who = m => (m.from === 'me' ? 'You' : kind === 'support' ? SUPPORT_NAME : kind === 'va' ? t.name : m.who || (m.from === 'team' ? 'A VA' : t.agent))
  const place = kind === 'support' ? `Message ${SUPPORT_NAME}…` : kind === 'va' ? `Message ${first}…` : `Message ${agentFirst} about ${first}…`
  return <>
    {kind === 'support'
      ? <div className="tp-conv-h"><Avatar name={SUPPORT_NAME} /><span className="tp-grow"><b>{SUPPORT_NAME}</b><small>The Ohvara admin team. Shifts, pay, the app, anything.</small></span></div>
      : kind === 'va'
        ? <div className="tp-conv-h"><Avatar name={t.name} /><span className="tp-grow"><b>{t.name}</b><small>VA · just the two of you</small></span></div>
        : <div className="tp-conv-h"><Avatar name={t.name} /><span className="tp-grow"><b>{t.name}</b><small className="ful-thread-agent">Agent: {t.agent}</small><small>Between the agent and the VA team. Any VA can answer; the client doesn't see this.</small></span><Link to={fp('clients', t.client_id)} className="tp-link">Open client<ArrowUpRight size={14} /></Link></div>}
    <div className="tp-conv-b">
      {msgs.map(m => <div key={m.id} className={`tp-bub${m.from === 'me' ? ' me' : ''}`}>{m.text}<small>{who(m)} · {m.at}</small></div>)}
      {msgs.length === 0 && <p className="tp-sub">{offline ? 'Writing to Ohvara Support from here starts once it’s switched on for VAs.' : kind === 'support' ? 'Write to Ohvara Support. We answer, usually the same day.' : `Say hi to ${kind === 'va' ? first : agentFirst}.`}</p>}
    </div>
    <form className="tp-conv-f" onSubmit={send}>
      <input className="tp-input" aria-label={place.replace('…', '')} placeholder={place} value={text} onChange={e => setText(e.target.value)} />
      <button type="submit" className="tp-primary fx-accent" disabled={!text.trim() || offline}>Send</button>
    </form>
  </>
}
