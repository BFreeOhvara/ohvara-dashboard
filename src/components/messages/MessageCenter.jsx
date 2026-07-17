import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, MessageSquare, ChevronLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useReps, useClosers, useAdmins } from '../../hooks/useProfiles'
import {
  MESSAGE_CATEGORIES,
  useSendMessage, useMyMessages, useInbox, useReplyMessage, useMarkMessageRead,
} from '../../hooks/useMessages'

const HEADER = {
  rep:    { title: 'Messages', subtitle: 'Dashboard questions go to Brayden · sales questions go to Nate' },
  closer: { title: 'Messages', subtitle: 'Setter questions + Brayden direct messages' },
  admin:  { title: 'Messages', subtitle: 'Setter questions + Nate direct messages' },
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
          {conv.isManager && (
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-dim)', borderRadius: 3, padding: '1px 4px', flexShrink: 0 }}>
              Direct
            </span>
          )}
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
  const isRepThread = !selected?.isManager
  const { data: recentBookings } = useRepRecentBookings(selected?.key, role === 'closer' && isRepThread)
  if (!selected) return null

  return (
    <div
      className="hidden lg:flex"
      style={{ width: 240, flexShrink: 0, borderLeft: '0.5px solid var(--border)', flexDirection: 'column', alignItems: 'center', padding: '28px 18px', textAlign: 'center' }}
    >
      <Avatar name={selected.name} size={56} />
      <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: '12px 0 2px' }}>{selected.name}</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{selected.role}</p>
      {selected.description && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.5, opacity: 0.8 }}>{selected.description}</p>
      )}

      {role === 'closer' && isRepThread && (
        <div style={{ marginTop: 24, width: '100%', padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 8, border: '0.5px solid var(--border)' }}>
          <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--accent)', fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
            {recentBookings ?? '—'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Bookings, last 7 days</p>
        </div>
      )}
      {(role === 'admin' || selected.isManager) && (
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
//
// Prompt 75: admin and closer also get a mutual direct-message thread with
// each other. Admin fetches their inbox (recipient='brayden') AND their own
// sent-to-nate rows (useInbox('nate'), which after migration 053 only returns
// rows where sender_id = auth.uid()). The Nate thread = inbox rows from Nate +
// sent-to-nate rows. Closer mirrors this symmetrically with Brayden.
export function MessageCenter({ role }) {
  const { profile } = useAuth()
  const isRep = role === 'rep'
  const isAdmin = role === 'admin'
  const isCloser = role === 'closer'
  const primaryRecipient = isCloser ? 'nate' : isAdmin ? 'brayden' : null
  const mutualRecipient = isAdmin ? 'nate' : isCloser ? 'brayden' : null

  const { data: repMessages, isLoading: repLoading } = useMyMessages(isRep ? profile?.id : undefined)
  const { data: inboxMessages, isLoading: inboxLoading } = useInbox(!isRep ? primaryRecipient : undefined)
  // After migration 053: admin calling useInbox('nate') only sees own sent-to-nate rows (RLS);
  // closer calling useInbox('brayden') only sees own sent-to-brayden rows.
  const { data: mutualSentMessages = [] } = useInbox(!isRep && mutualRecipient ? mutualRecipient : undefined)

  const { data: allReps = [] } = useReps()
  const { data: allClosers = [] } = useClosers()
  const { data: allAdmins = [] } = useAdmins()

  const send = useSendMessage()
  const reply = useReplyMessage()
  const markRead = useMarkMessageRead()

  const [selectedKey, setSelectedKey] = useState(null)
  const [draft, setDraft] = useState('')

  const isLoading = isRep ? repLoading : inboxLoading

  // Manager profiles for seeding the mutual direct-message thread
  const managerProfiles = isAdmin ? allClosers : isCloser ? allAdmins : []

  const conversations = useMemo(() => {
    if (isRep) {
      return MESSAGE_CATEGORIES.map(c => {
        const msgs = (repMessages || [])
          .filter(m => m.recipient === c.value)
          .slice()
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const last = msgs[msgs.length - 1]
        return {
          key: c.value, name: c.to, role: c.label, description: c.hint, messages: msgs, unread: 0,
          recipientKey: c.value,
          lastMessage: last ? (last.reply_body || last.body) : 'No messages yet',
          lastTimestamp: last ? (last.replied_at || last.created_at) : null,
        }
      })
    }

    // Build rep conversation threads from inbox, excluding manager profiles
    const managerIds = new Set(managerProfiles.map(p => p.id))
    const bySender = {}
    for (const rep of allReps) {
      bySender[rep.id] = { key: rep.id, name: rep.full_name, role: 'Setter', messages: [], isManager: false }
    }
    for (const m of inboxMessages || []) {
      if (managerIds.has(m.sender_id)) continue // handled in manager thread below
      if (!bySender[m.sender_id]) bySender[m.sender_id] = { key: m.sender_id, name: m.sender_name, role: 'Setter', messages: [], isManager: false }
      bySender[m.sender_id].messages.push(m)
    }

    const repConvs = Object.values(bySender)
      .map(c => {
        const sorted = c.messages.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        const last = sorted[sorted.length - 1]
        return {
          ...c, messages: sorted, recipientKey: null,
          lastMessage: last ? (last.reply_body || last.body) : 'No messages yet',
          lastTimestamp: last ? (last.replied_at || last.created_at) : null,
          unread: c.messages.filter(m => !m.read).length,
        }
      })
      .sort((a, b) => {
        const aHas = !!a.lastTimestamp, bHas = !!b.lastTimestamp
        if (aHas && !bHas) return -1
        if (!aHas && bHas) return 1
        if (aHas && bHas) return new Date(b.lastTimestamp) - new Date(a.lastTimestamp)
        return a.name.localeCompare(b.name)
      })

    // Build manager direct-message threads (Brayden↔Nate)
    const managerConvs = managerProfiles.map(mgr => {
      const fromMgr = (inboxMessages || []).filter(m => m.sender_id === mgr.id)
      const toMgr = mutualSentMessages || []
      const allMsgs = [...fromMgr, ...toMgr].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const last = allMsgs[allMsgs.length - 1]
      return {
        key: mgr.id,
        name: mgr.full_name,
        role: mgr.role === 'closer' ? 'Closer' : 'Admin',
        messages: allMsgs,
        isManager: true,
        recipientKey: mutualRecipient,
        lastMessage: last ? last.body : 'No messages yet',
        lastTimestamp: last ? last.created_at : null,
        unread: 0,
      }
    })

    // Manager threads float to the top of the list
    return [...managerConvs, ...repConvs]
  }, [isRep, repMessages, inboxMessages, mutualSentMessages, allReps, managerProfiles, mutualRecipient])

  // Auto-select the rep's first contact thread once on load only — not on
  // every `selectedKey === null`, otherwise the mobile back button (which
  // clears selectedKey to return to the list, Prompt 298) would immediately
  // re-select it and the list would never be reachable on a phone.
  const repAutoSelected = useRef(false)
  useEffect(() => {
    if (isRep && !repAutoSelected.current && conversations.length) {
      setSelectedKey(conversations[0].key)
      repAutoSelected.current = true
    }
  }, [isRep, conversations])

  const selected = conversations.find(c => c.key === selectedKey) || null

  function openConversation(conv) {
    setSelectedKey(conv.key)
    setDraft('')
    if (!isRep && !conv.isManager) {
      conv.messages.filter(m => !m.read).forEach(m => markRead.mutate(m.id))
    }
  }

  async function handleSend() {
    if (!draft.trim() || !selected) return
    if (isRep || selected.isManager) {
      if (send.isPending) return
      const recipient = isRep ? selected.key : selected.recipientKey
      await send.mutateAsync({ sender_id: profile.id, sender_name: profile.full_name, recipient, body: draft.trim() })
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

        {/* Left — conversation list. Mobile: full-width, shown only when no
            thread is selected (list/thread master-detail toggle, Prompt 298
            — the fixed 280px column used to render permanently alongside the
            thread, squeezing it into a ~100px sliver on a phone). Desktop:
            unchanged fixed 280px column, always visible alongside the thread. */}
        <div
          className={`${selected ? 'hidden' : 'flex'} md:flex w-full md:w-[280px]`}
          style={{ flexShrink: 0, borderRight: '0.5px solid var(--border)', flexDirection: 'column' }}
        >
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

        {/* Middle — thread. Mobile: hidden entirely while the list is showing
            (the list panel above takes full width in that state instead);
            shown full-width once a conversation is picked. Desktop: always
            visible alongside the list, unchanged. */}
        <div className={`${selected ? 'flex' : 'hidden'} md:flex`} style={{ flex: 1, minWidth: 0, flexDirection: 'column' }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <MessageSquare size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p style={{ fontSize: 13 }}>Select a conversation</p>
            </div>
          ) : (
            <>
              <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <button
                  onClick={() => setSelectedKey(null)}
                  className="md:hidden"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0 }}
                >
                  <ChevronLeft size={20} />
                </button>
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
                ) : selected.isManager ? (
                  // Manager mutual thread — each INSERT row is its own chat bubble
                  selected.messages.map(m => (
                    <Bubble
                      key={m.id}
                      side={m.sender_id === profile.id ? 'right' : 'left'}
                      name={m.sender_name}
                      text={m.body}
                      timestamp={m.created_at}
                    />
                  ))
                ) : (
                  // Rep thread — message row + optional reply slot
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
                  placeholder={isRep || selected.isManager ? `Message ${selected.name}…` : `Reply to ${selected.name}…`}
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
