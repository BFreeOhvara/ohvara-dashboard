import { useEffect, useRef, useState } from 'react'
import { Send, MessageSquare, ChevronLeft, Users, MoreHorizontal, Copy, Trash2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  useTeamChannel, useTeamMembers, useDmConversationId, useTeamMessages, useSendTeamMessage,
  useDeleteTeamMessage,
} from '../../hooks/useTeamChat'

// Team chat (Prompt 357) — the Messages sub-tab of the Team page. One shared
// "Team chat" channel (everyone closer/admin) plus a DM thread per other
// team member, picked from a flat list (no per-conversation unread preview —
// the notification bell already surfaces new activity; this stays a simple
// list + thread like the legacy MessageCenter but reads/writes the new
// team_conversations/team_messages schema instead of the fixed-contact
// `messages` table).

function timeAgo(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

function Avatar({ name, size = 32, icon: Icon }) {
  const { bg, fg, border } = avatarStyle(name)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: bg, color: fg, border: `0.5px solid ${border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 600,
    }}>
      {Icon ? <Icon size={Math.round(size * 0.5)} /> : ((name || '?').trim().charAt(0).toUpperCase() || '?')}
    </div>
  )
}

function ConversationRow({ name, subtitle, active, icon, onClick }) {
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
      <Avatar name={name} size={34} icon={icon} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {name}
        </span>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </p>
      </div>
    </button>
  )
}

// Prompt 391 — per-message "⋯" menu, hover-revealed (Tailwind group/group-
// hover; forced visible via `open` so it doesn't vanish mid-interaction if
// the mouse drifts off the row). Copy is always offered; Delete only when
// `canDelete` (sender's own message only, per Prompt 400 — mirrors migration
// 094's RLS, which is the real gate either way).
const menuItemStyle = {
  display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '8px 12px',
  border: 'none', background: 'transparent', textAlign: 'left', fontSize: 12, fontWeight: 600,
  color: 'var(--text-secondary)', whiteSpace: 'nowrap',
}

function MessageMenu({ text, canDelete, onDelete, align }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative', alignSelf: 'flex-end', marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        className={open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        title="Message actions"
        style={{
          width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'transparent', color: 'var(--text-muted)', borderRadius: 5,
          cursor: 'pointer', transition: 'opacity 120ms',
        }}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', [align]: 0, marginTop: 4, zIndex: 20,
          minWidth: 116, background: '#13131F', border: '0.5px solid var(--border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <button
            onClick={() => { navigator.clipboard?.writeText(text); setOpen(false) }}
            style={menuItemStyle}
          >
            <Copy size={12} /> Copy
          </button>
          {canDelete && (
            <button
              onClick={() => { onDelete(); setOpen(false) }}
              style={{ ...menuItemStyle, color: 'var(--danger)' }}
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Bubble({ side, name, text, timestamp, canDelete, onDelete }) {
  const isRight = side === 'right'
  return (
    <div className="group" style={{ display: 'flex', gap: 6, flexDirection: isRight ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
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
      <MessageMenu text={text} canDelete={canDelete} onDelete={onDelete} align={isRight ? 'left' : 'right'} />
    </div>
  )
}

// Thread pane — shared by the channel and every DM once a conversation id is
// known. `conversationId` is undefined for a DM until useDmConversationId's
// get-or-create query resolves.
function Thread({ conversationId, name, subtitle, onBack, myId, myName }) {
  const { data: messages = [], isLoading } = useTeamMessages(conversationId)
  const send = useSendTeamMessage()
  const del = useDeleteTeamMessage()
  const [draft, setDraft] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function handleSend() {
    if (!draft.trim() || !conversationId || send.isPending) return
    await send.mutateAsync({ conversation_id: conversationId, sender_id: myId, sender_name: myName, body: draft.trim() })
    setDraft('')
  }

  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button
          onClick={onBack}
          className="md:hidden"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', padding: 0, flexShrink: 0 }}
        >
          <ChevronLeft size={20} />
        </button>
        <Avatar name={name} size={28} icon={subtitle === 'Team chat' ? Users : undefined} />
        <div>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{name}</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>
        </div>
      </div>

      <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!conversationId || isLoading ? null : !messages.length ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 'auto' }}>
            No messages yet — say hello below.
          </p>
        ) : (
          messages.map(m => (
            <Bubble
              key={m.id}
              side={m.sender_id === myId ? 'right' : 'left'}
              name={m.sender_name}
              text={m.body}
              timestamp={m.created_at}
              canDelete={m.sender_id === myId}
              onDelete={() => del.mutate({ id: m.id, conversation_id: conversationId })}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: '0.5px solid var(--border)', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder={`Message ${name}…`}
          rows={1}
          disabled={!conversationId}
          style={{
            flex: 1, resize: 'none', maxHeight: 100, boxSizing: 'border-box',
            padding: '9px 12px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', lineHeight: 1.5,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || !conversationId || send.isPending}
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
  )
}

// Resolves the DM conversation id for whichever member is selected — a
// separate component so the get-or-create hook only runs for the active
// selection, not once per row in the member list.
function DmThread({ myId, myName, member, onBack }) {
  const { data: conversationId } = useDmConversationId(myId, member.id)
  return (
    <Thread
      conversationId={conversationId}
      name={member.full_name}
      subtitle={member.role === 'admin' ? 'Admin' : 'Closer'}
      onBack={onBack}
      myId={myId}
      myName={myName}
    />
  )
}

export function TeamMessages() {
  const { profile } = useAuth()
  const myId = profile?.id
  const myName = profile?.full_name || 'You'

  const { data: channel } = useTeamChannel()
  const { data: members = [] } = useTeamMembers(myId)

  // null = nothing selected; 'channel'; or a member object for a DM.
  const [selected, setSelected] = useState(null)

  // Prompt 391: flush edge-to-edge (borderRadius:0, no outer border), same
  // convention as the dedicated full-bleed /messages route in
  // components/messages/MessageCenter.jsx — this panel now spans the full
  // width of Team.jsx's wrapper instead of sitting inset with a visible frame.
  return (
    <div className="glass" style={{ display: 'flex', flex: 1, minHeight: 0, borderRadius: 0, overflow: 'hidden' }}>
      {/* Left — Team chat + one row per other team member */}
      <div
        className={`${selected ? 'hidden' : 'flex'} md:flex w-full md:w-[280px]`}
        style={{ flexShrink: 0, borderRight: '0.5px solid var(--border)', flexDirection: 'column' }}
      >
        <div style={{ padding: '12px 14px', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: 0, fontWeight: 500 }}>
            Conversations
          </p>
        </div>
        <div className="scrollbar-thin" style={{ flex: 1, overflowY: 'auto' }}>
          <ConversationRow
            name="Team chat"
            subtitle="Everyone on the team"
            icon={Users}
            active={selected === 'channel'}
            onClick={() => setSelected('channel')}
          />
          {members.map(m => (
            <ConversationRow
              key={m.id}
              name={m.full_name}
              subtitle={m.role === 'admin' ? 'Admin' : 'Closer'}
              active={selected?.id === m.id}
              onClick={() => setSelected(m)}
            />
          ))}
        </div>
      </div>

      {/* Middle — thread */}
      <div className={`${selected ? 'flex' : 'hidden'} md:flex`} style={{ flex: 1, minWidth: 0, flexDirection: 'column' }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <MessageSquare size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
            <p style={{ fontSize: 13 }}>Select a conversation</p>
          </div>
        ) : selected === 'channel' ? (
          <Thread
            conversationId={channel?.id}
            name="Team chat"
            subtitle="Everyone on the team"
            onBack={() => setSelected(null)}
            myId={myId}
            myName={myName}
          />
        ) : (
          <DmThread myId={myId} myName={myName} member={selected} onBack={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}
