import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Send } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  useMessageThreads, useThreadMessages, useThreadPolicy, useSendMessage, useMarkThreadRead,
} from '../hooks/usePolicyMessages'
import { card, eyebrow, primaryBtn, MONO, DISPLAY } from '../lib/exportStyles'
import { fullName } from '../lib/policyFormat'
import { EmptyNote } from '../components/agent/AgentUI'

// Messages (Prompt 679) — agents and the Fulfillment team talking about a
// booked client, in either direction.
//
// Shape: one thread per client (policy), not a free-form inbox. That matches
// how the rest of the portal is organised (per-submission, not per-person),
// and it means "who is this about" never needs asking. An agent sees only
// their own clients' threads; a Fulfillment rep sees the whole booked pool;
// admin sees everything — all enforced by RLS in migration 114, so nothing
// here filters by role. Threads start from a client row (Clients ->
// "Message Fulfillment", Fulfillment work view -> "Message agent") and open
// here via ?thread=<policy id>.

const MAX_LEN = 2000

function fmtTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

function fmtShort(iso) {
  const d = new Date(iso)
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Messages() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const activeId = params.get('thread')

  const { data: threads = [], isLoading } = useMessageThreads()

  const open = id => {
    const next = new URLSearchParams(params)
    if (id) next.set('thread', id); else next.delete('thread')
    setParams(next, { replace: true })
  }

  return (
    <div
      className="flex md:grid md:grid-cols-[340px_minmax(0,1fr)]"
      style={{
        ...card, padding: 0, overflow: 'hidden',
        height: 'calc(100vh - 160px)', minHeight: 460,
      }}
    >
      <div
        className={activeId ? 'hidden md:flex' : 'flex'}
        style={{ flex: 1, minWidth: 0, flexDirection: 'column', minHeight: 0, borderRight: 'var(--border-w) solid var(--border)' }}
      >
        <div style={{ padding: '16px 18px', borderBottom: 'var(--border-w) solid var(--border)' }}>
          <p style={eyebrow}>Conversations</p>
        </div>
        <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {isLoading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : threads.length === 0 ? (
            <EmptyNote>
              {profile?.role === 'agent'
                ? 'No messages yet. Open a client in My Pipeline and tap “Message Fulfillment” to start one.'
                : 'No messages yet. Open a client in the queue and tap “Message agent” to start one.'}
            </EmptyNote>
          ) : threads.map(t => (
            <ThreadRow key={t.policy_id} t={t} me={profile} active={t.policy_id === activeId} onClick={() => open(t.policy_id)} />
          ))}
        </div>
      </div>

      <div className={activeId ? 'flex' : 'hidden md:flex'} style={{ flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {activeId
          ? <Conversation key={activeId} policyId={activeId} me={profile} onBack={() => open(null)} />
          : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
              <MessageSquare size={26} />
              <p style={{ margin: 0, fontSize: 14 }}>Pick a conversation</p>
            </div>
          )}
      </div>
    </div>
  )
}

function counterpart(t, me) {
  if (me?.role === 'agent') return t.fulfillment_name ? `Fulfillment · ${t.fulfillment_name}` : 'Fulfillment · no rep yet'
  return `Agent · ${t.agent_name || 'Unknown'}`
}

function ThreadRow({ t, me, active, onClick }) {
  const unread = t.unread_count > 0
  const mine = t.last_sender_id === me?.id
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '14px 18px',
        border: 'none', borderBottom: 'var(--border-w) solid var(--border)',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: unread ? 700 : 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {fullName(t)}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtShort(t.last_at)}</span>
      </div>
      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{counterpart(t, me)}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: unread ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {mine ? 'You: ' : ''}{t.last_body}
        </span>
        {unread && (
          <span style={{
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, flexShrink: 0,
            background: 'var(--accent)', color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{t.unread_count}</span>
        )}
      </div>
    </button>
  )
}

function Conversation({ policyId, me, onBack }) {
  const { data: pol, isLoading: polLoading } = useThreadPolicy(policyId)
  const { data: messages = [], isLoading } = useThreadMessages(policyId)
  const send = useSendMessage(policyId, me?.id)
  const markRead = useMarkThreadRead(me?.id)
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)

  const lastId = messages[messages.length - 1]?.id

  // Opening the thread, or a new message arriving while it's open, marks it
  // read. Admin is an observer (their unread count is always 0), so skip them.
  const { mutate: mark } = markRead
  useEffect(() => {
    if (me?.id && lastId && me.role !== 'admin') mark(policyId)
  }, [policyId, lastId, me?.id, me?.role, mark])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])

  const blocked = useMemo(() => !polLoading && (!pol || !pol.fulfillment_assigned), [pol, polLoading])
  const trimmed = draft.trim()

  function submit() {
    if (!trimmed || send.isPending) return
    send.mutate(trimmed, { onSuccess: () => setDraft('') })
  }

  const withWho = !pol ? '' : me?.role === 'agent'
    ? (pol.assigned?.full_name ? `With Fulfillment · ${pol.assigned.full_name}` : 'With Fulfillment · no rep yet')
    : `Booked by ${pol.agent?.full_name || 'unknown agent'}`

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: 'var(--border-w) solid var(--border)' }}>
        <button onClick={onBack} className="icon-btn md:hidden" title="Back" style={{ width: 32, height: 32 }}><ArrowLeft size={16} /></button>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 17, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {pol ? fullName(pol) : 'Conversation'}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{withWho}</p>
        </div>
      </div>

      <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {blocked ? (
          <EmptyNote>This conversation isn’t available.</EmptyNote>
        ) : isLoading ? (
          <EmptyNote>Loading…</EmptyNote>
        ) : messages.length === 0 ? (
          <EmptyNote>No messages yet — say hello below.</EmptyNote>
        ) : messages.map(m => {
          const mine = m.sender_id === me?.id
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: 'min(520px, 85%)' }}>
              {!mine && (
                <p style={{ margin: '0 0 3px 2px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {m.sender_name}{m.sender_role === 'fulfillment' ? ' · Fulfillment' : m.sender_role === 'admin' ? ' · Admin' : ''}
                </p>
              )}
              <div style={{
                padding: '9px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.45,
                whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                background: mine ? 'var(--accent)' : 'var(--bg-elevated)',
                color: mine ? '#fff' : 'var(--text-primary)',
                border: mine ? 'none' : 'var(--border-w) solid var(--border)',
              }}>
                {m.body}
              </div>
              <p style={{ margin: '3px 2px 0', fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted)', textAlign: mine ? 'right' : 'left' }}>
                {fmtTime(m.created_at)}
              </p>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {!blocked && (
        <div style={{ padding: '12px 18px 16px', borderTop: 'var(--border-w) solid var(--border)' }}>
          {send.isError && <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--danger)' }}>{send.error?.message || 'Couldn’t send that.'}</p>}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="Write a message…"
              rows={2}
              style={{
                flex: 1, minWidth: 0, resize: 'none', padding: '9px 12px', fontSize: 14, lineHeight: 1.4,
                background: 'var(--bg-base)', border: 'var(--border-w) solid var(--border)',
                borderRadius: 10, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={submit}
              disabled={!trimmed || send.isPending}
              style={{ ...primaryBtn, opacity: !trimmed || send.isPending ? 0.5 : 1 }}
            >
              <Send size={15} /> {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
