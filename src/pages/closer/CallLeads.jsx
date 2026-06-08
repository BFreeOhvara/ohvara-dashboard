import { useState, useMemo } from 'react'
import { PhoneCall, RefreshCw } from 'lucide-react'
import { useAllLeads } from '../../hooks/useLeads'
import { Badge } from '../../components/ui/Badge'
import { CallButton } from '../../components/rep/CallButton'
import { AIScriptPanel } from '../../components/rep/AIScriptPanel'
import { Button } from '../../components/ui/Button'

const UNBOOKED_STATUSES = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Interested']

export default function CallLeads() {
  const { data: allLeads, isLoading, refetch } = useAllLeads()
  const [scriptLead, setScriptLead] = useState(null)
  const [search, setSearch] = useState('')

  // Only unbooked leads — closers bypass reps on these
  const leads = useMemo(() => {
    if (!allLeads) return []
    return allLeads.filter(l => UNBOOKED_STATUSES.includes(l.status))
  }, [allLeads])

  const filtered = useMemo(() => {
    if (!search.trim()) return leads
    const q = search.toLowerCase()
    return leads.filter(l =>
      l.business_name?.toLowerCase().includes(q) ||
      l.niche?.toLowerCase().includes(q) ||
      l.city?.toLowerCase().includes(q)
    )
  }, [leads, search])

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main panel — shrinks when script panel opens */}
      <div style={{
        flex: 1, minWidth: 0,
        marginRight: scriptLead ? 420 : 0,
        transition: 'margin-right 180ms cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Call Leads
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Unbooked leads across all reps —{' '}
              <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                {leads.length}
              </span>{' '}
              available
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Search */}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search business, niche, city…"
              style={{
                height: 30, padding: '0 10px',
                background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)',
                borderRadius: 6, fontSize: 12,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                width: 220,
                outline: 'none',
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw size={12} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Table */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{
            display: 'flex', alignItems: 'center',
            background: 'var(--bg-elevated)',
            borderBottom: '0.5px solid var(--border)',
          }}>
            <div style={{ flex: '1 1 0', padding: '8px 16px' }} className="section-label">Business</div>
            <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Niche</div>
            <div style={{ flex: '0 0 120px', padding: '8px 8px' }} className="section-label">Phone</div>
            <div style={{ flex: '0 0 140px', padding: '8px 8px' }} className="section-label">Rep Assigned</div>
            <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Status</div>
            <div style={{ flex: '0 0 140px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Action</div>
          </div>

          {/* Rows */}
          {isLoading ? (
            <div>
              {[...Array(8)].map((_, i) => (
                <div key={i} style={{ height: 44, borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{ margin: '14px 16px', height: 12, width: `${35 + (i % 4) * 12}%`, background: 'var(--bg-elevated)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
                </div>
              ))}
            </div>
          ) : !filtered.length ? (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '48px 16px', textAlign: 'center',
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                <PhoneCall size={18} color="var(--text-muted)" />
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
                {search ? 'No leads match that search' : 'No unbooked leads right now'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {search ? 'Try a different search term.' : 'All leads are already booked or not interested.'}
              </p>
            </div>
          ) : (
            filtered.map(lead => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onScriptOpen={() => setScriptLead(lead)}
              />
            ))
          )}
        </div>

        {/* Row count */}
        {filtered.length > 0 && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
            Showing {filtered.length} of {leads.length} unbooked leads
          </p>
        )}
      </div>

      {/* AI Script Panel */}
      {scriptLead && (
        <AIScriptPanel
          lead={scriptLead}
          onClose={() => setScriptLead(null)}
        />
      )}
    </div>
  )
}

function LeadRow({ lead, onScriptOpen }) {
  const repName = lead.assigned_rep?.full_name || '—'

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '0.5px solid var(--border)',
        minHeight: 44,
        transition: 'background-color 100ms',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Business */}
      <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 16px' }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.business_name}
        </p>
        {lead.city && (
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            {lead.city}{lead.state ? `, ${lead.state}` : ''}
          </p>
        )}
      </div>

      {/* Niche */}
      <div style={{ flex: '0 0 110px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lead.niche || '—'}
      </div>

      {/* Phone */}
      <div style={{ flex: '0 0 120px', padding: '10px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lead.phone || '—'}
      </div>

      {/* Rep */}
      <div style={{ flex: '0 0 140px', padding: '10px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {repName}
      </div>

      {/* Status */}
      <div style={{ flex: '0 0 110px', padding: '10px 8px' }}>
        <Badge label={lead.status} />
      </div>

      {/* Action */}
      <div style={{ flex: '0 0 140px', padding: '8px 16px 8px 0', display: 'flex', justifyContent: 'flex-end' }}>
        <CallButton
          lead={lead}
          onScriptOpen={onScriptOpen}
          onCallEnd={() => {}}
        />
      </div>
    </div>
  )
}
