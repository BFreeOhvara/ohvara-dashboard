import { useState } from 'react'
import { Send, MessageSquare, CheckCheck, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  MESSAGE_CATEGORIES, recipientName,
  useSendMessage, useMyMessages,
} from '../../hooks/useMessages'

function timeAgo(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function Messages() {
  const { profile } = useAuth()
  const [recipient, setRecipient] = useState('brayden')
  const [body, setBody] = useState('')
  const send = useSendMessage()
  const { data: messages, isLoading } = useMyMessages(profile?.id)

  const category = MESSAGE_CATEGORIES.find(c => c.value === recipient)

  async function handleSend() {
    if (!body.trim() || send.isPending) return
    await send.mutateAsync({
      sender_id: profile.id,
      sender_name: profile.full_name,
      recipient,
      body: body.trim(),
    })
    setBody('')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Messages
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Dashboard questions go to Brayden · sales questions go to Nate
        </p>
      </div>

      {/* Compose */}
      <div className="glass" style={{ borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          What's your question about?
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {MESSAGE_CATEGORIES.map(c => {
            const active = recipient === c.value
            return (
              <button
                key={c.value}
                onClick={() => setRecipient(c.value)}
                style={{
                  flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  border: `0.5px solid ${active ? 'var(--accent-border)' : 'var(--border)'}`,
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 500, color: active ? 'var(--accent)' : 'var(--text-secondary)', margin: 0 }}>
                  {c.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.4 }}>
                  → {c.to} · {c.hint}
                </p>
              </button>
            )
          })}
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder={`Ask ${category?.to}…`}
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', boxSizing: 'border-box',
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)', resize: 'vertical', lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            onClick={handleSend}
            disabled={!body.trim() || send.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 20px', borderRadius: 8, border: 'none',
              background: body.trim() ? 'var(--accent)' : 'var(--bg-elevated)',
              color: body.trim() ? 'white' : 'var(--text-muted)',
              fontSize: 13, fontWeight: 500,
              cursor: body.trim() && !send.isPending ? 'pointer' : 'not-allowed',
              opacity: send.isPending ? 0.7 : 1,
            }}
          >
            <Send size={13} />
            {send.isPending ? 'Sending…' : `Send to ${category?.to}`}
          </button>
        </div>
      </div>

      {/* History */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 10px' }}>
        Your messages
      </p>
      {isLoading ? null : !messages?.length ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
          <MessageSquare size={20} style={{ opacity: 0.5 }} />
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>No messages yet — ask your first question above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {messages.map(m => (
            <div key={m.id} className="glass" style={{ borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 4,
                  background: 'var(--accent-dim)', color: 'var(--accent)',
                }}>
                  To {recipientName(m.recipient)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{timeAgo(m.created_at)}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>

              {m.reply_body ? (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--success)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCheck size={11} /> {recipientName(m.recipient)} replied
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.reply_body}</p>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontStyle: 'italic' }}>
                  <Clock size={11} /> Awaiting reply
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
