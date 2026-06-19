import { useNavigate } from 'react-router-dom'
import { Phone, Clock, CheckCircle, Loader2, AlertTriangle, Bot, Package, Zap } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { KPICard } from '../../components/ui/KPICard'
import { useMyClient, useMyOnboarding } from '../../hooks/useClientPortal'
import { TIER_NAMES, TIER_FEATURES } from './clientConstants'

export default function ClientOverview() {
  const navigate = useNavigate()
  const { data: client, isLoading, error } = useMyClient()
  const { data: onboarding } = useMyOnboarding(client?.id)

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Loader2 size={18} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
    </div>
  )

  if (error || !client) return (
    <div className="glass" style={{ padding: 20, borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
      <div>
        <p style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>Couldn't load your account.</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Contact brayden@ohvara.com for help.</p>
      </div>
    </div>
  )

  if (onboarding && onboarding.status !== 'completed') return (
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

  const tier = client.tier || 'basic'
  const isActive = client.status === 'active'
  const isAgentLive = !!client.retell_agent_id
  const hasPhone = !!client.twilio_number
  const features = TIER_FEATURES.filter(f => f.tiers.includes(tier))

  return (
    <div style={{ display: 'flex', gap: 20, minHeight: 0 }}>

      {/* Left — KPIs + automations grid */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              {client.business_name}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              AI automation overview
            </p>
          </div>
          <Badge label={isActive ? 'active' : (client.status || 'pending')} />
        </div>

        {/* KPI row */}
        <div className="stagger" style={{ display: 'flex', gap: 12 }}>
          <KPICard
            label="Package"
            value={TIER_NAMES[tier] || tier}
            icon={Package}
            sub={`${features.length} automations included`}
          />
          <KPICard
            label="AI Agent"
            value={isAgentLive ? 'Live' : 'Setting Up'}
            icon={Bot}
            sub={isAgentLive ? 'Handling your calls' : 'Agent build in progress'}
            subColor={isAgentLive ? 'var(--success)' : 'var(--warning)'}
          />
          <KPICard
            label="Active Services"
            value={isAgentLive ? features.length : 0}
            icon={Zap}
            sub={isAgentLive ? 'All running' : 'Activating after setup'}
            subColor={isAgentLive ? 'var(--success)' : 'var(--warning)'}
          />
        </div>

        {/* Automations grid */}
        <div>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
            Your Automations
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {features.map(f => (
              <div key={f.key} className="glass" style={{ padding: '14px 16px', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{f.icon}</span>
                  {isAgentLive
                    ? <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                    : <Clock size={14} style={{ color: 'var(--warning)' }} />
                  }
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{f.name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 }}>{f.desc.split(' — ')[0]}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <div style={{ flexShrink: 0, width: 280, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Phone number */}
        <div className={hasPhone ? 'glass-accent' : 'glass'} style={{ padding: 20, borderRadius: 10 }}>
          <p style={{ fontSize: 10, color: hasPhone ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
            AI Phone Number
          </p>
          {hasPhone ? (
            <>
              <p style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', margin: 0 }}>
                {client.twilio_number}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={12} /> Forward your business line here
              </p>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Clock size={15} style={{ color: 'var(--warning)', marginTop: 2, flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--warning)', margin: 0 }}>Being provisioned</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Ready within 24 hours. We'll notify {client.owner_email || 'you'}.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Agent status */}
        <div className="glass" style={{ padding: '14px 16px', borderRadius: 10 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
            Agent Status
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bot size={16} style={{ color: isAgentLive ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0 }}>
                {isAgentLive ? 'Agent live' : 'Building agent'}
              </p>
              {client.retell_agent_id && (
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {client.retell_agent_id}
                </p>
              )}
            </div>
            {isAgentLive && <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />}
          </div>
        </div>

        {/* Support CTA */}
        <div className="glass" style={{ padding: '14px 16px', borderRadius: 10 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
            Support
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            Questions about your account or AI agent?
          </p>
          <button
            onClick={() => navigate('/client/messages')}
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 8, border: 'none',
              background: 'var(--accent)', color: 'white', fontSize: 13, fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Ask Nate a Question
          </button>
        </div>
      </div>
    </div>
  )
}
