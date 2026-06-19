import { CheckCircle, Clock, Lock, Loader2, AlertTriangle } from 'lucide-react'
import { useMyClient } from '../../hooks/useClientPortal'
import { TIER_NAMES, TIER_FEATURES, TIER_ORDER } from './clientConstants'

export default function ClientAutomations() {
  const { data: client, isLoading, error } = useMyClient()

  if (isLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Loader2 size={18} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
    </div>
  )

  if (error || !client) return (
    <div className="glass" style={{ padding: 20, borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
      <p style={{ fontSize: 14, color: 'var(--text-primary)' }}>Couldn't load automations.</p>
    </div>
  )

  const tier = client.tier || 'basic'
  const isAgentLive = !!client.retell_agent_id
  const included = TIER_FEATURES.filter(f => f.tiers.includes(tier))
  const notIncluded = TIER_FEATURES.filter(f => !f.tiers.includes(tier))
  const tierIdx = TIER_ORDER.indexOf(tier)
  const nextTier = TIER_ORDER[tierIdx + 1]

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Automations
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          {TIER_NAMES[tier]} plan · {included.length} automation{included.length !== 1 ? 's' : ''} included
        </p>
      </div>

      {/* Active automations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: notIncluded.length ? 24 : 0 }}>
        {included.map(f => (
          <div key={f.key} className="glass" style={{ padding: '14px 16px', borderRadius: 10, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{f.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{f.name}</p>
                {isAgentLive
                  ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', fontWeight: 500 }}>Active</span>
                  : <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', fontWeight: 500 }}>Setting Up</span>
                }
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>{f.desc}</p>
            </div>
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              {isAgentLive
                ? <CheckCircle size={14} style={{ color: 'var(--success)' }} />
                : <Clock size={14} style={{ color: 'var(--warning)' }} />
              }
            </div>
          </div>
        ))}
      </div>

      {/* Not included / upgrade section */}
      {notIncluded.length > 0 && nextTier && (
        <>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 10 }}>
            Available on {TIER_NAMES[nextTier]}+
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notIncluded.map(f => (
              <div key={f.key} className="glass" style={{ padding: '14px 16px', borderRadius: 10, display: 'flex', gap: 14, alignItems: 'flex-start', opacity: 0.5 }}>
                <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 2, filter: 'grayscale(1)' }}>{f.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{f.name}</p>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontWeight: 500 }}>
                      {TIER_NAMES[f.tiers[0]]}+
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>{f.desc}</p>
                </div>
                <Lock size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
