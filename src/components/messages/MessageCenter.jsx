import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, MessageSquare } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import {
  MESSAGE_CATEGORIES,
  useSendMessage, useMyMessages, useInbox, useReplyMessage, useMarkMessageRead,
} from '../../hooks/useMessages'

const HEADER = {
  rep:    { title: 'Messages', subtitle: 'Dashboard questions go to Brayden · sales questions go to Nate' },
  closer: { title: 'Messages', subtitle: 'Sales questions from reps' },
  admin:  { title: 'Messages', subtitle: 'Dashboard questions from reps' },
}

function timeAgo(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Closer-only context stat — how active this rep has been lately.
function useRepRecentBookings(repId, enabled) {
  return useQuery({
    queryKey: ['rep-recent-bookings', repId],
    queryFn: async () => {
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const { count, error } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('rep_id', repId)
        .gte('created_at', weekAgo.toISOString())
      if (error) throw error
      return count ?? 0
    },
    enabled: !!repId && !!enabled,
  })
}

const AVATAR_PALETTE = [
  { bg: 'var(--accent-dim)', fg: 'var(--accent)', border: 'var(--accent-border)' },
  { bg: 'var(--success-dim)', fg: 'var(--success)', border: 'rgba(34,197,94,0.20)' },
  { bg: 'rgba(56,189,248,0.12)', fg: 'var(--info)', border: 'rgba(56,189,248,0.20)' },
  { bg: 'var(--warning-dim)', fg: 'var(--warning)', border: 'rgba(245,158,11,0.20)' },
  { bg: 'var(--danger-dim)', fg: 'var(--danger)', border: 'rgba(239,68,68,0.20)' },
]

function avatarStyle(name) {
  const idx = (name || '?').charCodeAt(0) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

function Avatar({ name, size = 32 }) {
  const { bg, fg, border } = avatarStyle(name)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: bg, color: fg, border: `0.5px solid ${border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 600,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase() || '?'}
    </div>
  )
}

function ConversationRow({ conv, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      <Avatar name={conv.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conv.name}
          </span>
          {conv.unread > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conv.lastMessage}
        </p>
      </div>
      {conv.lastTimestamp && (
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {timeAgo(conv.lastTimestamp)}
        </span>
      )}
    </button>
  )
}

function Bubble({ side, name, text, timestamp }) {
  const isRight = side === 'right'
  return (
    <div style={{ display: 'flex', gap: 8, flexDirection: isRight ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
      <Avatar name={name} size={26} />
      <div style={{ maxWidth: '70%' }}>
        <div style={{
          padding: '9px 13px', borderRadius: 12,
          borderBottomLeftRadius: isRight ? 12 : 4,
          borderBottomRightRadius: isRight ? 4 : 12,
          background: isRight ? 'var(--accent)' : 'var(--bg-elevated)',
          border: isRight ? 'none' : '0.5px solid var(--border)',
          color: isRight ? '#fff' : 'var(--text-primary)',
        }}>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{text}</p>
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '4px 4px 0', textAlign: isRight ? 'right' : 'left' }}>
          {timeAgo(timestamp)}
        </p>
      </div>
    </div>
  )
}

function ContactPanel({ role, selected }) {
  const { data: recentBookings } = useRepRecentBookings(selected?.key, role === 'closer')
  if (!selected) return null

  return (
    <div
      className="hidden lg:flex"
      style={{ width: 240, flexShrink: 0, borderLeft: '0.5px solid var(--border)', flexDirection: 'column', alignItems: 'center', padding: '28px 18px', textAlign: 'center' }}
    >
      <Avatar name={selected.name} size={56} />
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: '12px 0 2px' }}>{selected.name}</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{selected.role}</p>

      {role === 'closer' && (
        <div style={{ marginTop: 24, width: '100%', padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
          <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            {recentBookings ?? '—'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Bookings, last 7 days</p>
        </div>
      )}
      {role === 'admin' && (
        <div style={{ marginTop: 24, width: '100%', padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
          <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            {selected.messages.length}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Messages exchanged</p>
        </div>
      )}
    </div>
  )
}

// Shared 3-panel chat layout for all three message surfaces (Prompt 12 fix 4).
// The underlying data model is unchanged — one row per rep-initiated message,
// with at most one reply on it. "Conversations" are a client-side grouping:
// by sender for the recipient (closer/admin) views, or the two fixed
// contacts (Brayden/Nate) for the rep view. RLS already scopes the raw rows.
export function MessageCenter({ role }) {
  const { profile } = useAuth()
  const isRep = role === 'rep'
  const recipientKey = role === 'closer' ? 'nate' : role === 'admin' ? 'brayden' : null

  const { data: repMessages, isLoading: repLoading } = useMyMessages(isRep ? profile?.id : undefined)
  const { data: inboxMessages, isLoading: inboxLoading } = useInbox(!isRep ? recipientKey : undefined)
  const send = useSendMessage()
  const reply = useReplyMessage()
  const markRead = useMarkMessageRead()

  const [selectedKey, setSelectedKey] = useState(null)
  const [draft, setDraft] = useState('')

  const isLoading = isRep ? repLoading : inboxLoading

  const conversations = useMemo(() => {
    if (isRep) {
      return MESSAGE_CATEGORIES.map(c => {
        const msgs = (repMessages || [])
          .filter(m => m.recipient === c.value)
          .slice()
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const last = msgs[msgs.length - 1]
        return {
          key: c.value, name: c.to, role: c.label, messages: msgs, unread: 0,
          lastMessage: last ? (last.reply_body || last.body) : 'No messages yet',
          lastTimestamp: last ? (last.replied_at || last.created_at) : null,
        }
      })
    }
    const bySender = {}
    for (const m of inboxMessages || []) {
      if (!bySender[m.sender_id]) bySender[m.sender_id] = { key: m.sender_id, name: m.sender_name, role: 'Rep', messages: [] }
      bySender[m.sender_id].messages.push(m)
    }
    return Object.values(bySender)
      .map(c => {
        const sorted = c.messages.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const last = sorted[sorted.length - 1]
        return {
          ...c, messages: sorted,
          lastMessage: last.reply_body || last.body,
          lastTimestamp: last.replied_at || last.created_at,
          unread: c.messages.filter(m => !m.read).length,
        }
      })
      .sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp))
  }, [isRep, repMessages, inboxMessages])

  // Rep view always has exactly 2 fixed contacts — default to the first.
  useEffect(() => {
    if (isRep && !selectedKey && conversations.length) setSelectedKey(conversations[0].key)
  }, [isRep, selectedKey, conversations])

  const selected = conversations.find(c => c.key === selectedKey) || null

  function openConversation(conv) {
    setSelectedKey(conv.key)
    setDraft('')
    if (!isRep) conv.messages.filter(m => !m.read).forEach(m => markRead.mutate(m.id))
  }

  async function handleSend() {
    if (!draft.trim() || !selected) return
    if (isRep) {
      if (send.isPending) return
      await send.mutateAsync({ sender_id: profile.id, sender_name: profile.full_name, recipient: selected.key, body: draft.trim() })
    } else {
      const target = selected.messages[selected.messages.length - 1]
      if (!target || reply.isPending) return
      await reply.mutateAsync({ id: target.id, reply_body: draft.trim() })
    }
    setDraft('')
  }

  const senderName = isRep ? (profile?.full_name || 'You') : selected?.name
  const replierName = isRep ? selected?.name : (role === 'closer' ? 'Nate' : 'Brayden')
  const { title, subtitle } = HEADER[role]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px 12px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>
      </div>

      <div className="glass" style={{ display: 'flex', flex: 1, minHeight: 0, borderRadius: 0, overflow: 'hidden' }}>

        {/* Left — conversation list */}
        <div style={{ width: 280, flexShrink: 0, borderRight: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>
              {isRep ? 'Contacts' : 'Conversations'}
            </p>
          </div>
          <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? null : !conversations.length ? (
              <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                <MessageSquare size={20} style={{ opacity: 0.5 }} />
                <p style={{ fontSize: 12, margin: '8px 0 0' }}>No messages yet.</p>
              </div>
            ) : (
              conversations.map(conv => (
                <ConversationRow key={conv.key} conv={conv} active={conv.key === selectedKey} onClick={() => openConversation(conv)} />
              ))
            )}
          </div>
        </div>

        {/* Middle — thread */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <MessageSquare size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>Select a conversation</p>
            </div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <Avatar name={selected.name} size={28} />
                <div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{selected.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{selected.role}</p>
                </div>
              </div>

              <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {!selected.messages.length ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 'auto' }}>
                    No messages yet — say hello below.
                  </p>
                ) : (
                  selected.messages.map(m => (
                    <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <Bubble side="left" name={senderName} text={m.body} timestamp={m.created_at} />
                      {m.reply_body && (
                        <Bubble side="right" name={replierName} text={m.reply_body} timestamp={m.replied_at || m.created_at} />
                      )}
                    </div>
                  ))
                )}
              </div>

              <div style={{ borderTop: '0.5px solid var(--border)', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder={isRep ? `Message ${selected.name}…` : `Reply to ${selected.name}…`}
                  rows={1}
                  style={{
                    flex: 1, resize: 'none', maxHeight: 100, boxSizing: 'border-box',
                    padding: '9px 12px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                    borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.5,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={!draft.trim() || send.isPending || reply.isPending}
                  style={{
                    flexShrink: 0, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 8, border: 'none', cursor: draft.trim() ? 'pointer' : 'not-allowed',
                    background: draft.trim() ? 'var(--accent)' : 'var(--bg-elevated)',
                    color: draft.trim() ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Right — contact context */}
        <ContactPanel role={role} selected={selected} />
      </div>
    </div>
  )
}
