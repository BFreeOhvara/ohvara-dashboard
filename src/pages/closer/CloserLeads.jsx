import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../../components/ui/Badge'

function useMyCloserLeads(closerId) {
  return useQuery({
    queryKey: ['leads', 'closer', closerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, phone, city, niche, status, created_at')
        .eq('assigned_closer_id', closerId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!closerId,
  })
}

function useRequestLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ closerId, count }) => {
      const { data, error } = await supabase.rpc('request_closer_leads', {
        p_closer_id: closerId,
        p_count: count,
      })
      if (error) throw error
      return data // number of leads assigned
    },
    onSuccess: (_, { closerId }) => {
      qc.invalidateQueries({ queryKey: ['leads', 'closer', closerId] })
    },
  })
}

const cell = (basis, extra = {}) => ({
  flex: basis, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, ...extra,
})

export default function CloserLeads() {
  const { profile } = useAuth()
  const { data: leads = [], isLoading } = useMyCloserLeads(profile?.id)
  const requestLeads = useRequestLeads()

  const [count, setCount] = useState(50)
  const [lastResult, setLastResult] = useState(null)

  async function handleRequest() {
    if (requestLeads.isPending) return
    const assigned = await requestLeads.mutateAsync({ closerId: profile.id, count })
    setLastResult(assigned)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>My Leads</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{leads.length}</span> leads assigned to you
          </p>
        </div>

        {/* Request Leads control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={e => setCount(Math.min(500, Math.max(1, Number(e.target.value) || 1)))}
            style={{
              width: 72, height: 34, padding: '0 10px', textAlign: 'center',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 6, fontSize: 13, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
            }}
          />
          <button
            onClick={handleRequest}
            disabled={requestLeads.isPending}
            style={{
              height: 34, padding: '0 14px', borderRadius: 6, border: 'none', cursor: requestLeads.isPending ? 'not-allowed' : 'pointer',
              background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 500,
              opacity: requestLeads.isPending ? 0.6 : 1,
            }}
          >
            {requestLeads.isPending ? 'Requesting…' : `Request ${count} Lead${count !== 1 ? 's' : ''}`}
          </button>
          {lastResult !== null && (
            <span style={{ fontSize: 12, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
              +{lastResult} assigned
            </span>
          )}
        </div>
      </div>

      {/* Assumption banner — Brayden must confirm lead pool */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', marginBottom: 16, background: 'var(--warning-dim)', border: '0.5px solid rgba(245,158,11,0.30)', borderRadius: 8 }}>
        <AlertCircle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, lineHeight: 1.5 }}>
          <strong>Assumption (confirm with Brayden):</strong> "Request Leads" pulls from the unassigned lead pool (no closer yet), oldest-first, up to 500. If the source should be filtered differently — e.g. only rep-touched leads, specific niches, or a separate closer pool — update migration 054's <code>request_closer_leads</code> function.
        </p>
      </div>

      {/* Lead list — scrollable box */}
      <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }} className="scrollbar-thin">
          <div style={{ minWidth: 520 }}>
            {/* Header */}
            <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-elevated)' }}>
              {[['Business', '1 1 0'], ['Niche', '0 0 120px'], ['City', '0 0 110px'], ['Phone', '0 0 140px'], ['Status', '0 0 110px']].map(([label, basis]) => (
                <div key={label} style={cell(basis, { fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 500 })}>
                  {label}
                </div>
              ))}
            </div>

            {/* Rows */}
            <div className="scrollbar-thin" style={{ maxHeight: 520, overflowY: 'auto' }}>
              {isLoading ? (
                <p style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>Loading…</p>
              ) : !leads.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '64px 16px', textAlign: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Phone size={18} color="var(--text-muted)" />
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>No leads</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Use "Request Leads" above to get leads assigned to you.</p>
                </div>
              ) : leads.map(lead => (
                <div key={lead.id} style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={cell('1 1 0', { color: 'var(--text-primary)', fontWeight: 500 })}>{lead.business_name || '—'}</div>
                  <div style={cell('0 0 120px')}>{lead.niche || '—'}</div>
                  <div style={cell('0 0 110px')}>{lead.city || '—'}</div>
                  <div style={cell('0 0 140px', { fontFamily: 'var(--font-mono)', fontSize: 11 })}>{lead.phone || '—'}</div>
                  <div style={cell('0 0 110px')}><Badge label={lead.status || 'New'} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
