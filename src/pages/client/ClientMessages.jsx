import { useState } from 'react'
import { Send, MessageSquare, CheckCheck, Clock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSendMessage, useMyMessages } from '../../hooks/useMessages'

function timeAgo(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ClientMessages() {
  const { profile } = useAuth()
  const [body, setBody] = useState('')
  const send = useSendMessage()
  const { data: messages, isLoading } = useMyMessages(profile?.id)

  async function handleSend() {
    if (!body.trim() || send.isPending) return
    await send.mutateAsync({
      sender_id: profile.id,
      sender_name: profile.full_name || profile.username || 'Client',
      recipient: 'nate',
      body: body.trim(),
    })
    setBody('')
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Support
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Ask Nate a question about your account or AI agent
        </p>
      </div>

      {/* Compose */}
      <div className="glass" style={{ borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Message Nate
        </p>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="What's your question? (account setup, AI agent behavior, billing, etc.)"
          rows={4}
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
            {send.isPending ? 'Sending…' : 'Send to Nate'}
          </button>
        </div>
      </div>

      {/* History */}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 10px' }}>
        Message history
      </p>
      {isLoading ? null : !messages?.length ? (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
          <MessageSquare size={20} style={{ opacity: 0.5 }} />
          <p style={{ fontSize: 13, margin: '8px 0 0' }}>No messages yet — send your first question above.</p>
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
                  To Nate
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {timeAgo(m.created_at)}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</p>

              {m.reply_body ? (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--success)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <CheckCheck size={11} /> Nate replied
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.reply_body}</p>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 5, fontStyle: 'italic' }}>
                  <Clock size={11} /> Awaiting reply from Nate
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
