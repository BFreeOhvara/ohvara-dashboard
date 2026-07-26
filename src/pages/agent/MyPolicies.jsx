import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, Filter, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import { usePolicies, LIVE_POLICY_STATUSES } from '../../hooks/usePolicies'
import { PolicyModal } from '../../components/agent/PolicyModal'
import { money, fullName, formatDate } from '../../lib/policyFormat'

// My Policies — literal port of the export's "Closer · My Pipeline" screen
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines 647-751):
// a search + Filters-popover toolbar with active-filter chips, then one
// spacious table (Policy # / Customer / Product / Carrier / AP / Reported /
// Status) and the reserve footnote.
//
// Per-status colors are NOT in the export — they live in `data3.js`, which was
// never handed over — so they're mapped onto the design system's own semantic
// tokens below. Flagged; swap if the real palette differs when data3.js lands.
//
// Scope (Prompt 345): this page only ever shows real policies — In Effect,
// Submitted, Undrafted (LIVE_POLICY_STATUSES). Follow-up/Not Interested are
// pre-submission call outcomes, not policies, so they're filtered out below
// regardless of what's in the table — Follow-up rows belong on My Calls →
// Schedule, Not Interested rows have no home at all.

const MONO = "'JetBrains Mono',monospace"

const STATUS_STYLE = {
  'Submitted': { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)' },
  'In Effect': { color: 'var(--success)', dim: 'var(--success-dim)', bd: 'var(--success-bd)' },
  'Undrafted': { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
}

const EMPTY_FILTERS = { status: '', product: '', carrier: '', state: '', reported: '' }

const th = {
  textAlign: 'left', padding: '13px 20px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
  borderBottom: 'var(--border-w) solid var(--border)',
}
const cell = { padding: 20, borderBottom: 'var(--border-w) solid var(--border)' }

const selectStyle = {
  width: '100%', height: 32, background: 'var(--bg-base)',
  border: 'var(--border-w) solid var(--border)', borderRadius: 6,
  padding: '0 8px', fontSize: 12, color: 'var(--text-primary)',
}

export default function MyPolicies() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { downline } = useHierarchy(profile?.id, isAdmin)

  const [scope, setScope] = useState('own')
  const effectiveScope = isAdmin ? 'all' : scope
  const { data: policies = [], isLoading } = usePolicies(
    effectiveScope === 'own' ? profile?.id : null
  )

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const popRef = useRef(null)

  useEffect(() => {
    if (!filtersOpen) return
    const onDown = e => { if (popRef.current && !popRef.current.contains(e.target)) setFiltersOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [filtersOpen])

  const options = useMemo(() => ({
    carriers: [...new Set(policies.map(p => p.carrier_name).filter(Boolean))].sort(),
    products: [...new Set(policies.map(p => p.product_type).filter(Boolean))].sort(),
    states: [...new Set(policies.map(p => p.state).filter(Boolean))].sort(),
  }), [policies])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const daysAgo = iso => (Date.now() - new Date(iso).getTime()) / 86400000
    return policies.filter(p => {
      if (!LIVE_POLICY_STATUSES.includes(p.status)) return false
      if (q) {
        const hay = [p.policy_number, p.client_first_name, p.client_last_name, p.client_phone, p.carrier_name, p.product_type]
          .filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (filters.status && p.status !== filters.status) return false
      if (filters.product && p.product_type !== filters.product) return false
      if (filters.carrier && p.carrier_name !== filters.carrier) return false
      if (filters.state && p.state !== filters.state) return false
      if (filters.reported) {
        const sold = p.policy_sold_date || p.created_at?.slice(0, 10)
        if (!sold) return false
        const d = daysAgo(sold)
        if (filters.reported === '7' && d > 7) return false
        if (filters.reported === '14' && d > 14) return false
        if (filters.reported === 'older' && d <= 14) return false
      }
      return true
    })
  }, [policies, search, filters])

  const REPORTED_LABELS = { 7: 'Last 7 days', 14: 'Last 14 days', older: 'Older than 14 days' }
  const activeChips = [
    filters.status && { key: 'status', label: filters.status },
    filters.product && { key: 'product', label: filters.product },
    filters.carrier && { key: 'carrier', label: filters.carrier },
    filters.state && { key: 'state', label: filters.state },
    filters.reported && { key: 'reported', label: REPORTED_LABELS[filters.reported] },
  ].filter(Boolean)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px',
          background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
          borderRadius: 6, flex: 1, maxWidth: 360,
        }}>
          <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, carrier, policy #…"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none' }}
          />
        </div>

        <div style={{ position: 'relative' }} ref={popRef}>
          <button
            onClick={() => setFiltersOpen(v => !v)}
            style={{
              height: 34, padding: '0 14px',
              border: `1px solid ${activeChips.length ? 'var(--accent-border)' : 'var(--border)'}`,
              borderRadius: 6,
              background: activeChips.length ? 'var(--accent-dim)' : 'var(--bg-surface)',
              color: activeChips.length ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 7,
            }}
          >
            <Filter size={13} />
            Filters
            {activeChips.length > 0 && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                background: 'var(--accent)', color: '#fff', fontSize: 10, fontFamily: MONO,
              }}>
                {activeChips.length}
              </span>
            )}
          </button>

          {filtersOpen && (
            <div style={{
              position: 'absolute', top: 40, left: 0, width: 300,
              background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
              borderRadius: 10, padding: 16, zIndex: 30,
              boxShadow: '0 12px 32px rgba(0,0,0,0.28)', animation: 'fadeUp 120ms ease-out',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>Filter policies</span>
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 11, fontWeight: 700, padding: 0 }}
                >
                  Clear all
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FilterSelect
                  label="Status" value={filters.status}
                  onChange={v => setFilters(f => ({ ...f, status: v }))}
                  options={[['', 'All statuses'], ...LIVE_POLICY_STATUSES.map(s => [s, s])]}
                />
                <FilterSelect
                  label="Product" value={filters.product}
                  onChange={v => setFilters(f => ({ ...f, product: v }))}
                  options={[['', 'All products'], ...options.products.map(p => [p, p])]}
                />
                <FilterSelect
                  label="Carrier" value={filters.carrier}
                  onChange={v => setFilters(f => ({ ...f, carrier: v }))}
                  options={[['', 'All carriers'], ...options.carriers.map(c => [c, c])]}
                />
                <FilterSelect
                  label="State" value={filters.state}
                  onChange={v => setFilters(f => ({ ...f, state: v }))}
                  options={[['', 'All states'], ...options.states.map(s => [s, s])]}
                />
                <FilterSelect
                  label="Reported" value={filters.reported}
                  onChange={v => setFilters(f => ({ ...f, reported: v }))}
                  options={[['', 'Any time'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['older', 'Older than 14 days']]}
                />
              </div>
            </div>
          )}
        </div>

        <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
          {isLoading ? 'Loading…' : `${rows.length} of ${policies.length} ${policies.length === 1 ? 'policy' : 'policies'}`}
        </span>

        {!isAdmin && downline.length > 0 && (
          <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)', borderRadius: 6, marginLeft: 'auto' }}>
            {[['own', 'You'], ['team', 'Team']].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setScope(key)}
                style={{
                  border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700,
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

      {activeChips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {activeChips.map(c => (
            <button
              key={c.key}
              onClick={() => setFilters(f => ({ ...f, [c.key]: '' }))}
              style={{
                height: 26, padding: '0 6px 0 10px', border: '1px solid var(--accent-border)',
                borderRadius: 6, background: 'var(--accent-dim)', color: 'var(--accent)',
                fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {c.label}<X size={11} />
            </button>
          ))}
        </div>
      )}

      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
        borderRadius: 8, overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Policy #</th>
                <th style={th}>Customer</th>
                <th style={th}>Product</th>
                <th style={th}>Carrier</th>
                <th style={{ ...th, textAlign: 'right' }}>AP</th>
                <th style={{ ...th, textAlign: 'right' }}>Reported</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...cell, fontSize: 13, color: 'var(--text-muted)' }}>
                    {isLoading
                      ? 'Loading policies…'
                      : policies.length === 0
                        ? 'No policies yet — submitted deals land here from the New Submission form.'
                        : 'No policies match these filters.'}
                  </td>
                </tr>
              ) : rows.map(p => {
                const st = STATUS_STYLE[p.status] || STATUS_STYLE['Submitted']
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover-bg)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <td style={{ ...cell, fontSize: 11.5, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {p.policy_number || '—'}
                    </td>
                    <td style={{ ...cell, minWidth: 160 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        {fullName(p)}
                      </span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                        {[p.state, p.client_phone].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </td>
                    <td style={cell}>
                      <span style={{
                        display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                        background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                        border: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}>
                        {p.product_type || '—'}
                      </span>
                    </td>
                    <td style={{ ...cell, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {p.carrier_name || '—'}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {money(p.annual_premium)}
                    </td>
                    <td style={{ ...cell, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {formatDate(p.policy_sold_date)}
                    </td>
                    <td style={cell}>
                      <span style={{
                        display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                        background: st.dim, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: 'nowrap',
                      }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ margin: '10px 2px 0', fontSize: 11, color: 'var(--text-muted)' }}>
        A policy isn't complete until the old one is cancelled on the 3-way call — commission stays in reserve until then. Click any row for the full record.
      </p>

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

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block', marginBottom: 5, fontSize: 10, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>
        {label}
      </span>
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
