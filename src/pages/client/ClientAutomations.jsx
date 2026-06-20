import { CheckCircle, Clock, Loader2, AlertTriangle, Eye, Zap } from 'lucide-react'
import { useMyClient } from '../../hooks/useClientPortal'
import { syntheticStatsFor } from '../../lib/syntheticStats'

// `emphasis` marks a front-runner agent (Core Solution) — slightly larger,
// accent-bordered card vs. the plain sub-agent (Supporting Agents) styling.
function AutomationCard({ a, index, isAgentLive, emphasis = false }) {
  const stats = syntheticStatsFor(a, index)
  return (
    <div
      className={emphasis ? 'glass-accent' : 'glass'}
      style={{ padding: emphasis ? '16px 18px' : '14px 16px', borderRadius: 10 }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: isAgentLive ? 12 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {emphasis && <Zap size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
            <p style={{ fontSize: emphasis ? 14 : 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>{a.name}</p>
            {isAgentLive
              ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', fontWeight: 500 }}>Active</span>
              : <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', fontWeight: 500 }}>Setting Up</span>
            }
          </div>
          {a.description && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.55 }}>{a.description}</p>
          )}
        </div>
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          {isAgentLive
            ? <CheckCircle size={14} style={{ color: 'var(--success)' }} />
            : <Clock size={14} style={{ color: 'var(--warning)' }} />
          }
        </div>
      </div>
      {isAgentLive && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {stats.kpis.map((kpi, k) => (
            <div key={k} style={{ padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 7, border: '0.5px solid var(--border)' }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: stats.color, fontFamily: 'var(--font-mono)', margin: '0 0 2px', fontVariantNumeric: 'tabular-nums' }}>
                {kpi.value}
              </p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0 }}>{kpi.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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

  const isDemo = client.status === 'demo'
  const isAgentLive = !!client.retell_agent_id
  const automations = client.recommended_automations || []
  const frontRunners = client.front_runner_agents || []
  const subAgents = client.sub_agents || []
  const hasTieredStack = frontRunners.length > 0

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Automations
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Custom stack · {automations.length} automation{automations.length !== 1 ? 's' : ''} built for {client.business_name}
        </p>
      </div>

      {isDemo && (
        <div className="glass-accent" style={{ padding: '10px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <Eye size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
          <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0 }}>
            <strong>Demo Preview</strong> — sample activity below. Goes live with real call data when you sign up.
          </p>
        </div>
      )}

      {automations.length === 0 ? (
        <div className="glass" style={{ padding: 20, borderRadius: 10, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No automations recommended yet.</p>
        </div>
      ) : hasTieredStack ? (
        <>
          <p style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 8 }}>
            Core Solution
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: subAgents.length > 0 ? 20 : 0 }}>
            {frontRunners.map((a, i) => (
              <AutomationCard key={i} a={a} index={i} isAgentLive={isAgentLive} emphasis />
            ))}
          </div>
          {subAgents.length > 0 && (
            <>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 8 }}>
                Supporting Agents
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {subAgents.map((a, i) => (
                  <AutomationCard key={i} a={a} index={frontRunners.length + i} isAgentLive={isAgentLive} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {automations.map((a, i) => (
            <AutomationCard key={i} a={a} index={i} isAgentLive={isAgentLive} />
          ))}
        </div>
      )}
    </div>
  )
}
