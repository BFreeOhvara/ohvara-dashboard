import { useEffect, useRef, useState } from 'react'
import { MessageSquareText, Phone, PhoneIncoming, PhoneOutgoing, Users, History, Mic, Info } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useClientContactLog, useClientEvents } from '../../hooks/useClientContactLog'
import { useThreadMessages, useSendMessage } from '../../hooks/usePolicyMessages'
import { LoadError, DayDivider, ChatBubbleGroup, Composer } from './AgentUI'
import {
  CONTACT_FILTERS, filterContactRows, contactCounts, dualTime, policyChoice, groupThread,
} from '../../lib/clientPageLog'
import './clientPageLog.css'

// The client page's three cards (client-page.contact-log-card, .team-thread, .client-activity). The
// page mounts them; nothing here navigates. Read only, except the team thread's send, which goes
// through the existing useSendMessage. Surface is .ov-card; layout is .cpl-* (clientPageLog.css).
// Times show in the agent's zone with the client's beside them. Rules and words: lib/clientPageLog.js.

const PAGE = 25
const ROLE = { fulfillment: 'Fulfillment', admin: 'Admin', agent: 'Agent' }
const MAX_LEN = 2000
const firstWord = s => (s || '').trim().split(/\s+/)[0] || ''

function CardHead({ icon: Icon, tone, title, sub }) {
  return (
    <div className="cpl-head">
      <span className={`cpl-tile${tone ? ` ${tone}` : ''}`} aria-hidden="true"><Icon size={20} strokeWidth={2} /></span>
      <div className="cpl-grow"><h3 className="cpl-h3">{title}</h3><p className="cpl-sub">{sub}</p></div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="cpl-skel" aria-hidden="true">
      {[70, 45, 60].map(w => <span key={w} className="ov-skel" style={{ width: `${w}%`, height: 14 }} />)}
    </div>
  )
}

// Your time with the client's beside it: "Nov 1 · 2:00 PM your time / 1:00 PM client".
function When({ iso, tz, clientTz }) {
  const t = dualTime(iso, tz, clientTz)
  return (
    <p className="cpl-when" style={{ margin: 0 }}>
      <span><span className="cpl-date">{t.date} ·</span> {t.mine} <em>your time</em></span>
      {t.client && <><span className="cpl-sep" aria-hidden="true">/</span><span>{t.client} <em>client</em></span></>}
    </p>
  )
}

function ContactRow({ r, tz, clientTz }) {
  const Icon = r.channel === 'text' ? MessageSquareText : r.direction === 'in' ? PhoneIncoming : PhoneOutgoing
  return (
    <li className="cpl-row">
      <span className={`cpl-ic${r.channel === 'call' ? ' call' : ''}`} aria-hidden="true"><Icon size={17} strokeWidth={2} /></span>
      <div className="cpl-main">
        <div className="cpl-top">
          <span className="cpl-title">{r.label}</span>
          <span className="cpl-dir">{r.direction_text}</span>
        </div>
        <When iso={r.at} tz={tz} clientTz={clientTz} />
        {r.body && <p className="cpl-words">{r.body}</p>}
        <div className="cpl-meta">
          {r.who && <span>{r.who}</span>}
          {r.result && <span className="cpl-chip">{r.result}</span>}
          {r.attempts > 1 && <span className="cpl-chip">Attempt {r.attempts}</span>}
          {r.hasRecording && <span className="cpl-chip a"><Mic size={13} strokeWidth={2.2} aria-hidden="true" />Call recorded</span>}
        </div>
      </div>
    </li>
  )
}

// Every text and call to this client or lead. Pass policyIds for a client, leadId for a lead (both for a
// sold lead). Until the contact_log function is on the database it shows one quiet line, not an error.
export function ContactLogCard({ policyIds, leadId, clientKey, tz, clientTz }) {
  const log = useClientContactLog({ policyIds, leadId, clientKey })
  const [filter, setFilter] = useState('all')
  const [shown, setShown] = useState(PAGE)
  const counts = contactCounts(log.rows)
  const rows = filterContactRows(log.rows, filter)
  const head = <CardHead icon={Phone} tone="b" title="Texts and calls" sub="Every text and call, with the full words" />

  let body
  if (log.isLoading) body = <Skeleton />
  else if (log.notReady) {
    body = <p className="cpl-note" role="status"><Info size={16} strokeWidth={2} aria-hidden="true" />The contact log isn’t switched on yet.</p>
  } else if (log.isError) body = <LoadError what="the contact log" onRetry={log.refetch} tall />
  else if (!log.rows.length) body = <p className="cpl-empty">No texts or calls yet</p>
  else {
    body = (
      <>
        <div className="ov-range cpl-range" role="group" aria-label="Show">
          {CONTACT_FILTERS.map(f => (
            <button key={f.key} type="button" className={filter === f.key ? 'is-on' : ''} aria-pressed={filter === f.key}
              onClick={() => { setFilter(f.key); setShown(PAGE) }}>
              {f.label}<b>{counts[f.key]}</b>
            </button>
          ))}
        </div>
        {rows.length ? (
          <ul className="cpl-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {rows.slice(0, shown).map(r => <ContactRow key={r.id} r={r} tz={tz} clientTz={clientTz} />)}
          </ul>
        ) : <p className="cpl-empty">{filter === 'text' ? 'No texts yet' : 'No calls yet'}</p>}
        {rows.length > shown && (
          <button type="button" className="ov-ghost cpl-more" onClick={() => setShown(n => n + PAGE)}>Show more</button>
        )}
      </>
    )
  }
  return <section className="ov-card cpl-card" aria-label="Texts and calls">{head}{body}</section>
}

function Thread({ policyId, tz }) {
  const { profile } = useAuth()
  const msgs = useThreadMessages(policyId)
  const send = useSendMessage(policyId, profile?.id)
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const list = msgs.data || []

  useEffect(() => {
    const el = endRef.current
    if (el?.parentElement) el.parentElement.scrollTop = el.parentElement.scrollHeight
  }, [list.length, policyId])

  const submit = () => {
    const body = draft.trim()
    if (!body || send.isPending) return
    send.mutate(body, { onSuccess: () => setDraft('') })
  }
  const clock = iso => dualTime(iso, tz, null).mine

  return (
    <>
      {msgs.isError ? (
        <LoadError what="these messages" onRetry={() => msgs.refetch()} tall />
      ) : msgs.isLoading ? (
        <Skeleton />
      ) : !list.length ? (
        <p className="cpl-empty">No messages with the team yet</p>
      ) : (
        <div className="cpl-thread">
          {groupThread(list, tz).map(g => {
            if (g.type === 'day') return <DayDivider key={g.key} label={g.label} />
            const mine = g.senderId === profile?.id
            const head = g.msgs[0]
            const tail = g.msgs[g.msgs.length - 1]
            return (
              <ChatBubbleGroup
                key={g.key} mine={mine} messages={g.msgs} time={mine ? clock(tail.created_at) : null}
                caption={mine ? null : `${firstWord(head.sender_name) || 'Someone'}${ROLE[head.sender_role] ? ` · ${ROLE[head.sender_role]}` : ''} · ${clock(head.created_at)}`}
              />
            )
          })}
          <div ref={endRef} />
        </div>
      )}
      <div className="cpl-compose">
        <Composer
          value={draft} onChange={setDraft} onSubmit={submit} max={MAX_LEN} placeholder="Message the team…" busy={send.isPending}
          error={send.isError ? send.error?.message || 'Couldn’t send that.' : null}
        />
      </div>
    </>
  )
}

// The agent's thread with Fulfillment for this client. `policies` is the client's policies, newest first;
// the thread is the newest one's, with a switcher when there are several.
export function TeamThreadCard({ policies, tz }) {
  const list = (policies || []).filter(p => p?.id)
  const [pick, setPick] = useState(null)
  const active = list.find(p => p.id === pick) || list[0]
  const head = <CardHead icon={Users} title="Team thread" sub="Talk to Fulfillment about this client" />
  return (
    <section className="ov-card cpl-card" aria-label="Team thread">
      {head}
      {!active ? (
        <p className="cpl-empty">No messages with the team yet</p>
      ) : (
        <>
          {list.length > 1 && (
            <div className="cpl-pick" role="group" aria-label="Policy">
              {list.map((p, i) => (
                <button key={p.id} type="button" className={p.id === active.id ? 'is-on' : ''} aria-pressed={p.id === active.id} onClick={() => setPick(p.id)}>
                  {policyChoice(p, i)}
                </button>
              ))}
            </div>
          )}
          <Thread key={active.id} policyId={active.id} tz={tz} />
        </>
      )}
    </section>
  )
}

// What happened on this client's policies (calls booked, tried, finished), newest first, 50 at most.
export function ClientActivityCard({ policyIds, tz, clientTz }) {
  const ev = useClientEvents(policyIds)
  const [shown, setShown] = useState(10)
  const head = <CardHead icon={History} title="Activity" sub="What has happened on this client" />
  let body
  if (ev.isLoading) body = <Skeleton />
  else if (ev.isError) body = <LoadError what="the activity" onRetry={ev.refetch} tall />
  else if (!ev.events.length) body = <p className="cpl-empty">No activity yet</p>
  else {
    body = (
      <>
        <ul className="cpl-events">
          {ev.events.slice(0, shown).map(e => (
            <li key={e.id} className="cpl-event">
              <span className="cpl-dot" aria-hidden="true" />
              <div className="cpl-main">
                <span className="cpl-title">{e.title}</span>
                {e.sub && <span className="cpl-dir">{e.sub}</span>}
                <When iso={e.at} tz={tz} clientTz={clientTz} />
              </div>
            </li>
          ))}
        </ul>
        {ev.events.length > shown && (
          <button type="button" className="ov-ghost cpl-more" onClick={() => setShown(n => n + 10)}>Show more</button>
        )}
      </>
    )
  }
  return <section className="ov-card cpl-card" aria-label="Activity">{head}{body}</section>
}
