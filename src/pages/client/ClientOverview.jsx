import { useNavigate } from 'react-router-dom'
import { Phone, Clock, CheckCircle, Loader2, AlertTriangle, Bot } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { useMyClient, useMyOnboarding } from '../../hooks/useClientPortal'

const TIER_NAMES = { basic: 'Basic', pro: 'Pro', premium: 'Premium', elite: 'Elite' }

const TIER_FEATURES = [
  { key: 'receptionist', icon: '📞', name: 'AI Receptionist', desc: '24/7 inbound call handling', tiers: ['basic', 'pro', 'premium', 'elite'] },
  { key: 'textback', icon: '💬', name: 'Missed Call Text Back', desc: 'Auto-texts callers you miss', tiers: ['basic', 'pro', 'premium', 'elite'] },
  { key: 'reviews', icon: '⭐', name: 'Review Generation', desc: 'Automated review requests', tiers: ['pro', 'premium', 'elite'] },
  { key: 'followup', icon: '🔁', name: 'Lead Follow-Up', desc: 'Automated lead nurture', tiers: ['pro', 'premium', 'elite'] },
  { key: 'reminders', icon: '🔔', name: 'Appointment Reminders', desc: 'SMS reminder sequences', tiers: ['pro', 'premium', 'elite'] },
  { key: 'dispatcher', icon: '🗂', name: 'AI Dispatcher', desc: 'Job assignment automation', tiers: ['premium', 'elite'] },
  { key: 'sms', icon: '📣', name: 'SMS Marketing', desc: 'Campaign broadcasts', tiers: ['premium', 'elite'] },
  { key: 'website', icon: '🌐', name: 'Professional Website', desc: 'Custom site included', tiers: ['elite'] },
  { key: 'multiagent', icon: '🤖', name: 'Multiple AI Agents', desc: 'Up to 5 lines covered', tiers: ['elite'] },
]

export default function ClientOverview() {
  const navigate = useNavigate()
  const { data: client, isLoading: clientLoading, error: clientError } = useMyClient()
  const { data: onboarding } = useMyOnboarding(client?.id)

  if (clientLoading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <Loader2 size={18} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  if (clientError || !client) {
    return (
      <div className="glass" style={{ padding: 20, borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>Couldn't load your account.</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Contact brayden@ohvara.com for help.</p>
        </div>
      </div>
    )
  }

  if (onboarding && onboarding.status !== 'completed') {
    return (
      <div className="glass-accent" style={{ padding: 24, borderRadius: 12, textAlign: 'center', maxWidth: 480, margin: '40px auto 0' }}>
        <Bot size={28} style={{ color: 'var(--accent)', marginBottom: 12 }} />
        <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 8 }}>
          Finish setting up {client.business_name}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.5 }}>
          A few quick questions and we'll start building your AI receptionist.
        </p>
        <Button onClick={() => navigate('/client/onboarding')}>Continue Setup →</Button>
      </div>
    )
  }

  const tier = client.tier || 'basic'
  const isActive = client.status === 'active'
  const features = TIER_FEATURES.filter(f => f.tiers.includes(tier))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>{client.business_name}</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{TIER_NAMES[tier] || tier} plan</p>
        </div>
        <Badge label={isActive ? 'active' : client.status} />
      </div>

      {/* AI phone number */}
      <div className="glass-accent" style={{ padding: 20, borderRadius: 10 }}>
        {client.twilio_number ? (
          <>
            <p style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 8 }}>
              Your AI Phone Number
            </p>
            <p style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', margin: 0 }}>
              {client.twilio_number}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Phone size={12} /> Forward your business line here, or give this number to callers
            </p>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Clock size={16} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--warning)', margin: 0 }}>
                Your AI number is being set up
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                We'll notify {client.owner_email || 'you'} as soon as it's ready (within 24 hours)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Agent status */}
      <div className="glass" style={{ padding: '14px 16px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Bot size={16} style={{ color: client.retell_agent_id ? 'var(--success)' : 'var(--text-muted)' }} />
        <div>
          <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
            AI Agent {client.retell_agent_id ? 'live' : 'pending'}
          </p>
          {client.retell_agent_id && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              {client.retell_agent_id}
            </p>
          )}
        </div>
        {client.retell_agent_id && <CheckCircle size={14} style={{ color: 'var(--success)', marginLeft: 'auto' }} />}
      </div>

      {/* Services included */}
      <div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
          Your Services
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {features.map(f => (
            <div key={f.key} className="glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>{f.icon}</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{f.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Support */}
      <div className="glass" style={{ padding: 16, borderRadius: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          Need help? Email{' '}
          <a href="mailto:brayden@ohvara.com" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            brayden@ohvara.com
          </a>
        </p>
      </div>
    </div>
  )
}
