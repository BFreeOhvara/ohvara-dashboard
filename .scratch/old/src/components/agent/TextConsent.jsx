import { MessageSquareText } from 'lucide-react'
import { SMS_CONSENT_SCRIPT } from '../../lib/smsConsent'

// Prompt 776 — "Client agreed to texts" on Book a call and Change a booking.
// The agent reads the script above the box to the client, word for word, and
// ticks it only on a yes. Unticked, the booking works the same; the client
// just never gets a text. Who ticked it and when is stamped by the server.
export default function TextConsent({ checked, onChange, disabled, compact }) {
  return (
    <div className="ov-note" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '14px 14px' : '14px 16px', borderRadius: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <MessageSquareText size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-mute)' }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ov-mid)' }}>Read this to the client</p>
          <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.55, color: 'var(--ov-hi)' }}>“{SMS_CONSENT_SCRIPT}”</p>
        </div>
      </div>
      <label className="ov-consent" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: disabled ? 'default' : 'pointer' }}>
        <input
          type="checkbox" className="ov-consent-box" checked={!!checked} disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
        <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Client agreed to texts</span>
      </label>
    </div>
  )
}
