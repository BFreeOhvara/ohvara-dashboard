import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import {
  usePolicies, useUpdatePolicy, pendingEffectuation,
  POLICY_STATUSES, CANCELLATION_STATUSES, PRE_SUBMISSION_STATUSES,
} from '../../hooks/usePolicies'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Input'
import { PolicyModal } from '../../components/agent/PolicyModal'
import { money, fullName, formatDate } from '../../lib/policyFormat'

// My Policies — the closer's whole book of business.
//
// Current-state view across all time, filtered by status (Round 3: no
// day-scoping here, unlike the event-log pages). Status filters live behind a
// Filters control rather than a permanent pill row, and search lives on the
// page rather than in the global header (Round 32).

const EMPTY_FILTERS = {
  status: '', cancellation: '', carrier: '', product: '', state: '', from: '', to: '',
}

export default function MyPolicies() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { downline } = useHierarchy(profile?.id, isAdmin)

  // Admin always sees the company-wide book. A closer defaults to their own
  // and can widen to their team only if they actually have recruits.
  const [scope, setScope] = useState('own')
  const effectiveScope = isAdmin ? 'all' : scope
  const { data: policies = [], isLoading } = usePolicies(
    effectiveScope === 'own' ? profile?.id : null
  )

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState(null)

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  const carriers = useMemo(
    () => [...new Set(policies.map(p => p.carrier_name).filter(Boolean))].sort(),
    [policies]
  )
  const products = useMemo(
    () => [...new Set(policies.map(p => p.product_type).filter(Boolean))].sort(),
    [policies]
  )
  const states = useMemo(
    () => [...new Set(policies.map(p => p.state).filter(Boolean))].sort(),
    [policies]
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return policies.filter(p => {
      if (q) {
        const hay = [
          p.policy_number, p.client_first_name, p.client_last_name,
          p.client_phone, p.carrier_name, p.product_type,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.status && p.status !== filters.status) return false
      if (filters.cancellation && p.cancellation_status !== filters.cancellation) return false
      if (filters.carrier && p.carrier_name !== filters.carrier) return false
      if (filters.product && p.product_type !== filters.product) return false
      if (filters.state && p.state !== filters.state) return false
      const sold = p.policy_sold_date || p.created_at?.slice(0, 10)
      if (filters.from && (!sold || sold < filters.from)) return false
      if (filters.to && (!sold || sold > filters.to)) return false
      return true
    })
  }, [policies, search, filters])

  const needsEffectuation = useMemo(
    () => pendingEffectuation(policies).filter(p => p.agent_id === profile?.id),
    [policies, profile?.id]
  )

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
            My Policies
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {isLoading ? 'Loading…' : `${rows.length} of ${policies.length} ${policies.length === 1 ? 'policy' : 'policies'}`}
          </p>
        </div>

        {!isAdmin && downline.length > 0 && (
          <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8 }}>
            {[['own', 'You'], ['team', 'Team']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 12,
                  fontWeight: scope === key ? 500 : 400, cursor: 'pointer', border: 'none',
                  background: scope === key ? 'var(--accent-dim)' : 'transparent',
                  color: scope === key ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <EffectuationPrompt policies={needsEffectuation} />

      {/* Search + Filters (Round 32) */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client, policy #, carrier…"
            style={{
              width: '100%', padding: '9px 12px 9px 32px',
              background: 'var(--bg-base)', border: '0.5px solid var(--border)',
              borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>
        <Button variant="secondary" size="md" onClick={() => setShowFilters(v => !v)}>
          <SlidersHorizontal size={13} />
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="md" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X size={13} /> Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <div className="glass" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <Select label="Status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">Any status</option>
            {POLICY_STATUSES.map(s => (
              <option key={s} value={s}>
                {/* Both pre-submission statuses are unreachable until live-call
                    handling lands — say so rather than looking broken. */}
                {s}{PRE_SUBMISSION_STATUSES.includes(s) ? ' (not yet in use)' : ''}
              </option>
            ))}
          </Select>
          <Select label="Cancellation" value={filters.cancellation} onChange={e => setFilters(f => ({ ...f, cancellation: e.target.value }))}>
            <option value="">Any</option>
            {CANCELLATION_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select label="Carrier" value={filters.carrier} onChange={e => setFilters(f => ({ ...f, carrier: e.target.value }))}>
            <option value="">Any carrier</option>
            {carriers.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="Product" value={filters.product} onChange={e => setFilters(f => ({ ...f, product: e.target.value }))}>
            <option value="">Any product</option>
            {products.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label="State" value={filters.state} onChange={e => setFilters(f => ({ ...f, state: e.target.value }))}>
            <option value="">Any state</option>
            {states.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <div className="flex flex-col gap-1.5">
            <label className="section-label">Sold from</label>
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="date-field" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="section-label">Sold to</label>
            <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="date-field" />
          </div>
        </div>
      )}

      {/* Rows — deliberately spacious (Round 32 item 2), and no nested scroll
          box: the page itself scrolls, per the standing mobile rule. */}
      {isLoading ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading policies…</p>
      ) : rows.length === 0 ? (
        <div className="glass" style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-primary)', margin: 0 }}>
            {policies.length === 0 ? 'No policies yet' : 'No policies match these filters'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {policies.length === 0
              ? 'Submitted deals land here from the New Submission form.'
              : 'Try clearing a filter or widening the date range.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(p => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="glass policy-row"
              style={{
                display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                width: '100%', padding: '16px 18px', textAlign: 'left', cursor: 'pointer',
              }}
            >
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
                  {fullName(p)}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '3px 0 0' }}>
                  {p.carrier_name || 'No carrier'}{p.policy_number ? ` · ${p.policy_number}` : ''}
                </p>
              </div>
              <div style={{ flex: '0 1 130px' }}>
                <p className="section-label" style={{ margin: 0 }}>Annual Premium</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)', margin: '3px 0 0' }}>
                  {money(p.annual_premium)}
                </p>
              </div>
              <div style={{ flex: '0 1 120px' }}>
                <p className="section-label" style={{ margin: 0 }}>Sold</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '3px 0 0' }}>
                  {formatDate(p.policy_sold_date)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 0 auto' }}>
                <Badge label={p.status} />
                {p.cancellation_status && <Badge label={p.cancellation_status} />}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <PolicyModal
          policy={rows.find(r => r.id === selected.id) || selected}
          canEdit={isAdmin || selected.agent_id === profile?.id}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}

// Effective-Date-triggered prompt (Round 46). Fires on or after the effective
// date already captured at submission; the answer moves the record to In
// Effect or Undrafted and is stamped so it never asks twice.
function EffectuationPrompt({ policies }) {
  const update = useUpdatePolicy()
  if (!policies.length) return null
  const p = policies[0]

  function answer(status) {
    update.mutate({ id: p.id, status, effectuation_answered_at: new Date().toISOString() })
  }

  return (
    <div className="glass-accent" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          Did this policy go into effect?
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          {fullName(p)} · {p.carrier_name || 'No carrier'} · effective {formatDate(p.effective_date)}
          {policies.length > 1 ? ` · ${policies.length - 1} more waiting` : ''}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" variant="success" disabled={update.isPending} onClick={() => answer('In Effect')}>Yes</Button>
        <Button size="sm" variant="secondary" disabled={update.isPending} onClick={() => answer('Undrafted')}>No</Button>
      </div>
    </div>
  )
}
