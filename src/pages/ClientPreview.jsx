import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function StatCard({ label, value, sub, color = '#6C63FF' }) {
  return (
    <div style={{
      flex: 1, minWidth: 140,
      background: 'rgba(255,255,255,0.04)',
      border: '0.5px solid rgba(255,255,255,0.08)',
      borderRadius: 12, padding: '16px',
    }}>
      <p style={{ fontSize: 10, color: '#8888AA', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 8 }}>
        {label}
      </p>
      <p style={{ fontSize: 30, fontWeight: 600, color, lineHeight: 1, letterSpacing: '-0.02em', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </p>
      {sub && <p style={{ fontSize: 11, color: '#8888AA', marginTop: 6 }}>{sub}</p>}
    </div>
  )
}

function AutomationCard({ automation }) {
  const color = automation.tier === 'front' ? '#6C63FF' : '#22C55E'
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '0.5px solid rgba(255,255,255,0.06)',
      borderRadius: 12, padding: '16px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: '#F0F0F8', margin: 0 }}>{automation.name}</p>
        <span style={{
          fontSize: 9, padding: '2px 7px', borderRadius: 3,
          background: 'rgba(34,197,94,0.10)', color: '#22C55E',
          border: '0.5px solid rgba(34,197,94,0.20)',
          fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Active
        </span>
      </div>
      {automation.description && (
        <p style={{ fontSize: 12, color: '#8888AA', margin: '0 0 12px', lineHeight: 1.5 }}>{automation.description}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color, fontFamily: "'JetBrains Mono', monospace", margin: '0 0 2px' }}>{automation.actions}</p>
          <p style={{ fontSize: 10, color: '#8888AA', margin: 0 }}>Actions This Month</p>
        </div>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color, fontFamily: "'JetBrains Mono', monospace", margin: '0 0 2px' }}>{automation.successRate}%</p>
          <p style={{ fontSize: 10, color: '#8888AA', margin: 0 }}>Success Rate</p>
        </div>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, color, fontFamily: "'JetBrains Mono', monospace", margin: '0 0 2px' }}>${automation.value?.toLocaleString()}</p>
          <p style={{ fontSize: 10, color: '#8888AA', margin: 0 }}>Value Recovered</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {automation.feed?.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#B0B0C8' }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Public, unauthenticated demo-data preview page — ported from the abandoned
// ohvara-client-portal repo (Prompt 26, supersedes the cross-origin portal
// entirely; see LIVE_STATE). Fed by the already-deployed `get-demo-preview`
// edge fn, no real client account, no auth guard.
export default function ClientPreview() {
  const { appointmentId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.functions.invoke('get-demo-preview', {
        body: { appointmentId },
      })
      if (error || !data || data.error) {
        setErrored(true)
      } else {
        setData(data)
      }
      setLoading(false)
    }
    load()
  }, [appointmentId])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#080810', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <p style={{ fontSize: 14, color: '#8888AA' }}>Loading…</p>
      </div>
    )
  }

  if (errored || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#080810', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <p style={{ fontSize: 14, color: '#EF4444' }}>Preview not found.</p>
      </div>
    )
  }

  const totalActions = (data.automations || []).reduce((sum, a) => sum + (a.actions || 0), 0)
  const totalValue = (data.automations || []).reduce((sum, a) => sum + (a.value || 0), 0)

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080810',
      fontFamily: "'Inter', system-ui, sans-serif",
      WebkitFontSmoothing: 'antialiased',
      paddingBottom: 80,
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(8,8,16,0.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '0.5px solid rgba(255,255,255,0.06)',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: '#6C63FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 500, color: '#F0F0F8', margin: 0, lineHeight: 1 }}>
              {data.businessName}
            </p>
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: '2px 6px', borderRadius: 3,
          background: 'rgba(34,197,94,0.10)', color: '#22C55E',
          border: '0.5px solid rgba(34,197,94,0.20)',
          fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          Active
        </span>
      </div>

      <div style={{ padding: '24px 20px', maxWidth: 480, margin: '0 auto' }}>

        {/* AI number */}
        <div style={{
          background: '#6C63FF0d',
          border: '0.5px solid #6C63FF30',
          borderRadius: 14, padding: '20px',
          marginBottom: 24,
        }}>
          <p style={{ fontSize: 10, color: '#6C63FF', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 8 }}>
            Your AI Phone Number
          </p>
          <p style={{ fontSize: 28, fontWeight: 600, color: '#F0F0F8', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em', margin: 0 }}>
            {data.phoneNumber}
          </p>
          <p style={{ fontSize: 12, color: '#8888AA', marginTop: 8 }}>
            Forward your business line here, or give this number to callers
          </p>
        </div>

        {/* KPI stats */}
        <p style={{ fontSize: 10, color: '#55556A', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 12 }}>
          This Month — Combined Impact
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
          <StatCard label="Total Actions" value={totalActions} sub="across all automations" />
          <StatCard label="Value Recovered" value={`$${totalValue.toLocaleString()}`} sub="estimated this month" color="#22C55E" />
        </div>

        {/* Automations */}
        <p style={{ fontSize: 10, color: '#55556A', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 500, marginBottom: 12 }}>
          Your Automations
        </p>
        {(data.automations || []).map((a, i) => (
          <AutomationCard key={i} automation={a} />
        ))}

        {/* Support */}
        <div style={{ marginTop: 32, padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '0.5px solid rgba(255,255,255,0.06)' }}>
          <p style={{ fontSize: 12, color: '#8888AA', margin: 0 }}>
            Need help? Email{' '}
            <a href="mailto:brayden@ohvara.com" style={{ color: '#6C63FF', textDecoration: 'none' }}>
              brayden@ohvara.com
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
