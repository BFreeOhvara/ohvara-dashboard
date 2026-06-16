import { useState } from 'react'
import { Inbox as InboxIcon, Send, CheckCheck, CornerDownRight } from 'lucide-react'
import { useInbox, useReplyMessage, useMarkMessageRead } from '../../hooks/useMessages'

function timeAgo(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Inbox shared by Brayden's admin view (recipient='brayden') and Nate's closer
// view (recipient='nate'). RLS already scopes what each role can read.
export function Inbox({ recipient, title, subtitle }) {
  const { data: messages, isLoading } = useInbox(recipient)
  const reply = useReplyMessage()
  const markRead = useMarkMessageRead()
  const [openId, setOpenId] = useState(null)
  const [draft, setDraft] = useState('')

  const unread = (messages || []).filter(m => !m.read).length

  function open(m) {
    if (openId === m.id) { setOpenId(null); return }
    setOpenId(m.id)
    setDraft(m.reply_body || '')
    if (!m.read) markRead.mutate(m.id)
  }

  async function sendReply(m) {
    if (!draft.trim() || reply.isPending) return
    await reply.mutateAsync({ id: m.id, reply_body: draft.trim() })
    setOpenId(null)
    setDraft('')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{title}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>
        </div>
        {unread > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: 'var(--accent)', color: 'white',
          }}>
            {unread} new
          </span>
        )}
      </div>

      {isLoading ? null : !messages?.length ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
          <InboxIcon size={22} style={{ opacity: 0.5 }} />
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>No messages yet.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(m => {
            const isOpen = openId === m.id
            return (
              <div
                key={m.id}
                className="glass"
                style={{
                  borderRadius: 10, padding: '12px 14px',
                  borderLeft: m.read ? '0.5px solid var(--border)' : '3px solid var(--accent)',
                  cursor: 'pointer',
                }}
                onClick={() => open(m)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{m.sender_name}</span>
                  {!m.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>{timeAgo(m.created_at)}</span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>

                {m.reply_body && !isOpen && (
                  <p style={{ fontSize: 12, color: 'var(--success)', margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCheck size={12} /> Replied
                  </p>
                )}

                {isOpen && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                    <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CornerDownRight size={11} /> {m.reply_body ? 'Your reply' : 'Reply'}
                    </p>
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder={`Reply to ${m.sender_name}…`}
                      rows={3}
                      style={{
                        width: '100%', padding: '9px 11px', boxSizing: 'border-box',
                        background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
                        borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                        fontFamily: 'var(--font-sans)', resize: 'vertical', lineHeight: 1.5,
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <button
                        onClick={() => sendReply(m)}
                        disabled={!draft.trim() || reply.isPending}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 18px', borderRadius: 8, border: 'none',
                          background: draft.trim() ? 'var(--accent)' : 'var(--bg-elevated)',
                          color: draft.trim() ? 'white' : 'var(--text-muted)',
                          fontSize: 13, fontWeight: 500,
                          cursor: draft.trim() && !reply.isPending ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <Send size={13} />
                        {reply.isPending ? 'Sending…' : m.reply_body ? 'Update reply' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
