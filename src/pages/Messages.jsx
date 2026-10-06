import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Send } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  useMessageThreads, useThreadMessages, useThreadPolicy, useSendMessage, useMarkThreadRead,
} from '../hooks/usePolicyMessages'
import {
  useStandingThreads, useDmMessages, useSendDm, useMarkDmRead, dmId, parseDmId,
} from '../hooks/useDirectMessages'
import { eyebrow, primaryBtn, MONO, DISPLAY } from '../lib/exportStyles'
import { fullName } from '../lib/policyFormat'
import { EmptyNote } from '../components/agent/AgentUI'
import { Avatar } from '../components/ui/Avatar'

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
//
// Prompt 701: alongside the per-client threads, every account has standing
// threads with no client attached (migration 123) — an agent gets one with
// each Fulfillment rep plus Admin, a rep gets one per agent, admin gets the
// Admin line per agent. They're listed even when empty and open via
// ?dm=<agent id>.<rep id | 'admin'>. The layout is full-bleed (no card) to
// match Restorix; DashboardLayout drops its page padding for /messages.

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

function counterpart(t, me) {
  if (me?.role === 'agent') return t.fulfillment_name ? `Fulfillment · ${t.fulfillment_name}` : 'Fulfillment · no rep yet'
  return `Agent · ${t.agent_name || 'Unknown'}`
}

// Both kinds of thread, normalised to one row shape for the list.
function buildItems(policyThreads, standing, me) {
  const items = []
  for (const t of policyThreads) {
    items.push({
      key: t.policy_id, param: 'thread',
      title: fullName(t), sub: counterpart(t, me),
      ...(me?.role === 'agent'
        ? { avatarName: t.fulfillment_name || 'Fulfillment', avatarUrl: t.fulfillment_avatar_url, avatarColor: t.fulfillment_avatar_color }
        : { avatarName: t.agent_name, avatarUrl: t.agent_avatar_url, avatarColor: t.agent_avatar_color }),
      last_body: t.last_body, last_sender_id: t.last_sender_id, last_at: t.last_at, unread_count: t.unread_count,
    })
  }
  for (const t of standing) {
    const title = me?.role === 'agent'
      ? (t.peer_id ? t.peer_name || 'Fulfillment' : 'Admin')
      : t.agent_name || 'Unknown'
    const sub = me?.role === 'agent'
      ? (t.peer_id ? 'Fulfillment' : 'Admin team')
      : me?.role === 'admin' ? 'Agent · Admin line' : 'Agent'
    items.push({
      key: dmId(t.agent_id, t.peer_key), param: 'dm',
      title, sub,
      // Admin has no profile row, so the Admin line falls back to an "A" circle.
      ...(me?.role === 'agent'
        ? { avatarName: title, avatarUrl: t.peer_avatar_url, avatarColor: t.peer_avatar_color }
        : { avatarName: t.agent_name, avatarUrl: t.agent_avatar_url, avatarColor: t.agent_avatar_color }),
      last_body: t.last_body, last_sender_id: t.last_sender_id, last_at: t.last_at, unread_count: t.unread_count,
    })
  }
  return items.sort((a, b) => {
    if (a.last_at && b.last_at) return new Date(b.last_at) - new Date(a.last_at)
    if (a.last_at) return -1
    if (b.last_at) return 1
    return a.title.localeCompare(b.title)
  })
}

export default function Messages() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const policyId = params.get('thread')
  const dm = parseDmId(params.get('dm'))
  const activeKey = policyId || (dm ? dmId(dm.agentId, dm.peerKey) : null)

  const { data: threads = [], isLoading: loadingPolicy } = useMessageThreads()
  const { data: standing = [], isLoading: loadingStanding } = useStandingThreads()
  const isLoading = loadingPolicy || loadingStanding
  const items = useMemo(() => buildItems(threads, standing, profile), [threads, standing, profile])

  const open = (param, id) => {
    const next = new URLSearchParams(params)
    next.delete('thread'); next.delete('dm')
    if (id) next.set(param, id)
    setParams(next, { replace: true })
  }

  return (
    <div className="messages-fill flex md:grid md:grid-cols-[340px_minmax(0,1fr)]">
      <div
        className={activeKey ? 'hidden md:flex' : 'flex'}
        style={{ flex: 1, minWidth: 0, flexDirection: 'column', minHeight: 0, borderRight: 'var(--border-w) solid var(--border)' }}
      >
        <div style={{ padding: '16px 18px', borderBottom: 'var(--border-w) solid var(--border)' }}>
          <p style={eyebrow}>Conversations</p>
        </div>
        {/* Flex column only while showing a placeholder, so it centers in the pane (Prompt 707). */}
        <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto', ...(isLoading || items.length === 0 ? { display: 'flex', flexDirection: 'column' } : null) }}>
          {isLoading ? (
            <EmptyNote>Loading…</EmptyNote>
          ) : items.length === 0 ? (
            <EmptyNote>No conversations yet.</EmptyNote>
          ) : items.map(t => (
            <ThreadRow key={`${t.param}:${t.key}`} t={t} me={profile} active={t.key === activeKey} onClick={() => open(t.param, t.key)} />
          ))}
        </div>
      </div>

      <div className={activeKey ? 'flex' : 'hidden md:flex'} style={{ flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        {policyId ? (
          <PolicyConversation key={policyId} policyId={policyId} me={profile} onBack={() => open('thread', null)} />
        ) : dm ? (
          <DmConversation
            key={activeKey} agentId={dm.agentId} peerKey={dm.peerKey}
            item={items.find(i => i.key === activeKey)} listReady={!isLoading}
            me={profile} onBack={() => open('dm', null)}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--text-muted)' }}>
            <MessageSquare size={26} />
            <p style={{ margin: 0, fontSize: 14 }}>Pick a conversation</p>
          </div>
        )}
      </div>
    </div>
  )
}

function ThreadRow({ t, me, active, onClick }) {
  const unread = t.unread_count > 0
  const mine = t.last_sender_id === me?.id
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '14px 18px',
        border: 'none', borderBottom: 'var(--border-w) solid var(--border)',
        background: active ? 'var(--bg-elevated)' : 'transparent', cursor: 'pointer',
        boxShadow: active ? 'inset 3px 0 0 var(--accent)' : 'none',
      }}
    >
      <Avatar name={t.avatarName} avatarUrl={t.avatarUrl} avatarColor={t.avatarColor} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: unread ? 700 : 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.title}
        </span>
        {t.last_at && <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{fmtShort(t.last_at)}</span>}
      </div>
      <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t.sub}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: unread ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {t.last_body ? `${mine ? 'You: ' : ''}${t.last_body}` : 'No messages yet'}
        </span>
        {unread && (
          <span style={{
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, flexShrink: 0,
            background: 'var(--accent)', color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{t.unread_count}</span>
        )}
      </div>
      </div>
    </button>
  )
}

function PolicyConversation({ policyId, me, onBack }) {
  const { data: pol, isLoading: polLoading } = useThreadPolicy(policyId)
  const { data: messages = [], isLoading } = useThreadMessages(policyId)
  const send = useSendMessage(policyId, me?.id)
  const markRead = useMarkThreadRead(me?.id)

  const lastId = messages[messages.length - 1]?.id

  // Opening the thread, or a new message arriving while it's open, marks it
  // read. Admin is an observer (their unread count is always 0), so skip them.
  const { mutate: mark } = markRead
  useEffect(() => {
    if (me?.id && lastId && me.role !== 'admin') mark(policyId)
  }, [policyId, lastId, me?.id, me?.role, mark])

  const blocked = !polLoading && (!pol || !pol.fulfillment_assigned)

  const withWho = !pol ? '' : me?.role === 'agent'
    ? (pol.assigned?.full_name ? `With Fulfillment · ${pol.assigned.full_name}` : 'With Fulfillment · no rep yet')
    : `Booked by ${pol.agent?.full_name || 'unknown agent'}`

  return (
    <ChatPane
      title={pol ? fullName(pol) : 'Conversation'} subtitle={withWho}
      messages={messages} isLoading={isLoading} blocked={blocked}
      me={me} onBack={onBack} send={send}
    />
  )
}

// A standing thread (Prompt 701). `item` is undefined when the URL points at a
// pair the caller isn't part of (stale link, deactivated account) — shown as
// unavailable once the list has loaded rather than letting them type into it.
function DmConversation({ agentId, peerKey, item, listReady, me, onBack }) {
  const { data: messages = [], isLoading } = useDmMessages(agentId, peerKey)
  const send = useSendDm(agentId, peerKey, me?.id)
  const { mutate: mark } = useMarkDmRead(me?.id)

  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (me?.id && lastId) mark({ agentId, peerKey })
  }, [agentId, peerKey, lastId, me?.id, mark])

  return (
    <ChatPane
      title={item?.title || 'Conversation'} subtitle={item?.sub || ''}
      messages={messages} isLoading={isLoading} blocked={listReady && !item}
      me={me} onBack={onBack} send={send}
    />
  )
}

function ChatPane({ title, subtitle, messages, isLoading, blocked, me, onBack, send }) {
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const lastId = messages[messages.length - 1]?.id

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])

  const trimmed = draft.trim()

  function submit() {
    if (!trimmed || send.isPending) return
    send.mutate(trimmed, { onSuccess: () => setDraft('') })
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: 'var(--border-w) solid var(--border)' }}>
        <button onClick={onBack} className="icon-btn md:hidden" title="Back" style={{ width: 32, height: 32 }}><ArrowLeft size={16} /></button>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 17, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {title}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{subtitle}</p>
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
