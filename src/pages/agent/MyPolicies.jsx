import { useMemo, useState, useRef, useEffect, Fragment } from 'react'
import { Search, Filter, X, Bell, Hourglass, ExternalLink } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useHierarchy } from '../../hooks/useHierarchy'
import {
  usePolicies, ACTIVE_LIST_STATUSES, NEEDS_FOLLOWUP_STATUSES,
  useUpdatePolicy, pendingEffectuation, pendingUnderwriting, pendingLapseCheck,
  useAdvanceLapseCheck, useReactivateLapsedPolicy,
} from '../../hooks/usePolicies'
import { useCarriers } from '../../hooks/useCarriers'
import { PolicyModal } from '../../components/agent/PolicyModal'
import { Segmented } from '../../components/ui/Segmented'
import { AnchoredSelectField } from '../../components/ui/ExportForm'
import { money, fullName, formatDate } from '../../lib/policyFormat'
import { excludeTestAccounts } from '../../lib/testAccounts'

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
  'Submitted':    { color: 'var(--info)',    dim: 'var(--info-dim)',    bd: 'var(--info-bd)' },
  'In Effect':    { color: 'var(--success)', dim: 'var(--success-dim)', bd: 'var(--success-bd)' },
  'Undrafted':    { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
  'Not Approved': { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
  'Lapsed':       { color: 'var(--danger)',  dim: 'var(--danger-dim)',  bd: 'var(--danger-bd)' },
}

const TABS = [
  { value: 'active',   label: 'Active' },
  { value: 'followup', label: 'Needs Follow-up' },
]

const EMPTY_FILTERS = { status: '', product: '', carrier: '', state: '', reported: '' }

const th = {
  textAlign: 'left', padding: '13px 20px', fontSize: 10.5, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
  borderBottom: 'var(--border-w) solid var(--border)',
}
const cell = { padding: 20, borderBottom: 'var(--border-w) solid var(--border)' }

export default function MyPolicies() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const { downline } = useHierarchy(profile?.id, isAdmin)

  // Prompt 379: this page is "MY Policies" — it must default every role,
  // admin included, to their own book (`agent_id = auth.uid()`) rather than
  // relying on RLS's broader admin visibility to decide what renders here.
  // Admin's RLS access is intentionally wide for company-wide views
  // elsewhere (Performance, Overview) — that's not a license for this
  // specific "my own stuff" page to skip the explicit scope. Admin still
  // gets the You/Team toggle below so "everyone" stays one click away, it
  // just isn't the default anymore.
  const [scope, setScope] = useState('own')
  const { data: rawPolicies = [], isLoading } = usePolicies(
    scope === 'own' ? profile?.id : null
  )
  // Prompt 398: "Everyone" is a real company-wide rollup once real agents
  // are live, so nate44's fabricated policies can't bleed into it — same
  // rule already applied to Performance's Team scope and Leaderboard
  // (Prompt 371). "own" scope is unaffected either way, already narrowed to
  // this account's own agent_id.
  const policies = useMemo(
    () => (scope === 'own' ? rawPolicies : excludeTestAccounts(rawPolicies, profile?.id)),
    [rawPolicies, scope, profile?.id]
  )
  const update = useUpdatePolicy()
  const advanceLapseCheck = useAdvanceLapseCheck()
  const reactivateLapsed = useReactivateLapsedPolicy()
  const { data: carriers = [] } = useCarriers()

  const [tab, setTab] = useState('active')
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
    const filtered = policies.filter(p => {
      // Prompt 369: Undrafted/Not Approved/Lapsed moved to the Needs
      // Follow-up tab, and anything archived is done regardless of status.
      if (!ACTIVE_LIST_STATUSES.includes(p.status)) return false
      if (p.archived_at) return false
      if (q) {
        const hay = [p.policy_number, p.client_first_name, p.client_last_name, p.client_phone, p.carrier_name, p.product_name, p.product_type]
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
    // Prompt 351: rows still awaiting effectuation confirmation surface to
    // the top, so there's no hunting for them by search/scroll. Prompt 369
    // adds two more banner types (underwriting decision, lapse check-in) to
    // the same top-of-list treatment. `.sort` is stable in every JS engine
    // this app targets, so everything else keeps whatever order usePolicies
    // already returned it in.
    const pendingIds = new Set([
      ...pendingEffectuation(filtered).map(p => p.id),
      ...pendingUnderwriting(filtered).map(p => p.id),
      ...pendingLapseCheck(filtered).map(p => p.id),
    ])
    return [...filtered].sort((a, b) => (pendingIds.has(a.id) ? 0 : 1) - (pendingIds.has(b.id) ? 0 : 1))
  }, [policies, search, filters])

  const effIds = useMemo(() => new Set(pendingEffectuation(rows).map(p => p.id)), [rows])
  const uwIds = useMemo(() => new Set(pendingUnderwriting(rows).map(p => p.id)), [rows])
  const lapseIds = useMemo(() => new Set(pendingLapseCheck(rows).map(p => p.id)), [rows])

  function answerEffectuation(policy, status) {
    update.mutate({ id: policy.id, status, effectuation_answered_at: new Date().toISOString() })
  }

  // "Has the carrier's decision come back — was it approved?" Yes clears the
  // flag (policy proceeds normally); No is the only path to Not Approved.
  function answerUnderwriting(policy, approved) {
    update.mutate({ id: policy.id, pending_underwriting: false, status: approved ? policy.status : 'Not Approved' })
  }

  // "Is it still on the book, or did it lapse?" Yes pushes the check-in
  // forward a month (migration 085's advance_policy_lapse_check); No sets
  // status to Lapsed directly — no separate RPC needed for that half.
  function answerLapseCheck(policy, stillActive) {
    if (stillActive) advanceLapseCheck.mutate(policy.id)
    else update.mutate({ id: policy.id, status: 'Lapsed' })
  }

  // Carrier Portals (Prompt 331) is the one source of truth for portal_url —
  // match on carrier_id first (the real relation), carrier_name as a fallback
  // for older rows saved before that column existed.
  function carrierPortalUrl(policy) {
    const c = carriers.find(c => c.id === policy.carrier_id) || carriers.find(c => c.name === policy.carrier_name)
    return c?.portal_url || null
  }

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
      <Segmented value={tab} onChange={setTab} options={TABS} style={{ marginBottom: 14 }} />

      {tab === 'followup' && (
        <NeedsFollowUpTab
          policies={policies}
          isLoading={isLoading}
          onSelect={setSelected}
          onReactivate={p => {
            if (p.status === 'Lapsed') reactivateLapsed.mutate(p.id)
            else update.mutate({ id: p.id, status: 'Submitted' })
          }}
          onArchive={p => update.mutate({ id: p.id, archived_at: new Date().toISOString() })}
          pending={update.isPending || reactivateLapsed.isPending}
        />
      )}

      {tab === 'active' && (
      <>
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
                  options={[['', 'All statuses'], ...ACTIVE_LIST_STATUSES.map(s => [s, s])]}
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

        {(isAdmin || downline.length > 0) && (
          <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)', borderRadius: 6, marginLeft: 'auto' }}>
            {[['own', 'You'], ['team', isAdmin ? 'Everyone' : 'Team']].map(([key, label]) => (
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
                const needsEff = effIds.has(p.id)
                const needsUw = uwIds.has(p.id)
                const needsLapse = lapseIds.has(p.id)
                const pending = needsEff || needsUw || needsLapse
                // Second line lives inside the same visual row box as the
                // first — the top <tr>'s cells drop their bottom border so
                // there's no divider, and the confirmation banner below
                // supplies the row's actual outer border instead.
                const topCell = pending ? { ...cell, borderBottom: 'none' } : cell
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setSelected(p)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover-bg)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ ...topCell, fontSize: 11.5, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                        {p.policy_number || '—'}
                      </td>
                      <td style={{ ...topCell, minWidth: 160 }}>
                        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {fullName(p)}
                        </span>
                        <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                          {[p.state, p.client_phone].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td style={topCell}>
                        <span style={{
                          display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                          background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                          border: '1px solid var(--border)', whiteSpace: 'nowrap',
                        }}>
                          {p.product_type || p.product_name || '—'}
                        </span>
                      </td>
                      <td style={{ ...topCell, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {p.carrier_name || '—'}
                      </td>
                      <td style={{ ...topCell, textAlign: 'right', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                        {money(p.annual_premium)}
                      </td>
                      <td style={{ ...topCell, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                        {formatDate(p.policy_sold_date)}
                      </td>
                      <td style={topCell}>
                        <span style={{
                          display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                          background: st.dim, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: 'nowrap',
                        }}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                    {pending && (
                      <tr>
                        <td colSpan={7} style={{ padding: '0 20px 14px', borderBottom: 'var(--border-w) solid var(--border)' }}>
                          {needsEff && (
                            <EffectuationRow
                              policy={p}
                              portalUrl={carrierPortalUrl(p)}
                              pending={update.isPending}
                              onAnswer={status => answerEffectuation(p, status)}
                              canAnswer={p.agent_id === profile?.id}
                            />
                          )}
                          {needsUw && (
                            <UnderwritingRow
                              policy={p}
                              portalUrl={carrierPortalUrl(p)}
                              pending={update.isPending}
                              onAnswer={approved => answerUnderwriting(p, approved)}
                              canAnswer={p.agent_id === profile?.id}
                            />
                          )}
                          {needsLapse && (
                            <LapseCheckRow
                              policy={p}
                              pending={update.isPending || advanceLapseCheck.isPending}
                              onAnswer={stillActive => answerLapseCheck(p, stillActive)}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ margin: '10px 2px 0', fontSize: 11, color: 'var(--text-muted)' }}>
        A policy isn't complete until the old one is cancelled on the 3-way call — commission stays in reserve until then. Click any row for the full record.
      </p>
      </>
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

// Inline effectuation confirmation (Prompt 351) — the same Yes/No the
// PolicyModal banner offers (Prompt 345), just reachable without opening
// the record first. `onAnswer` stops propagation itself isn't needed here:
// this renders in its own <tr>, separate from the row's onClick.
// Prompt 364 — was a flex row with `flexWrap: 'wrap'`, so Yes/No's start x
// depended on the message text's own rendered width (worse, on which item
// the wrap broke before — the actual reason two rows measured 39px apart
// despite identical container width). Grid tracks don't reflow like that:
// columns 2 (buttons) and 3 (portal link) get a track size that's constant
// regardless of what's in column 1, so their start x can never drift.
// Column 3's fixed width is sized off the longest of the 12 real carrier
// names (migration 078/080/082) — "National Life Group" / "American
// Amicable" — measured live, not guessed, so no real carrier ever wraps.
const EFFECTUATION_GRID = '1fr max-content 260px'

function EffectuationRow({ policy, portalUrl, pending, onAnswer, canAnswer }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: EFFECTUATION_GRID, alignItems: 'center', gap: 16,
      padding: '12px 16px', background: 'var(--warning-dim)',
      border: '1px solid var(--warning-bd)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Bell size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
          Reached its effective date ({formatDate(policy.effective_date)}) — did this policy go into effect?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }} title={canAnswer ? undefined : 'Only the submitting agent can answer this'}>
        <button
          onClick={() => onAnswer('In Effect')}
          disabled={pending || !canAnswer}
          style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', opacity: canAnswer ? 1 : 0.45, cursor: canAnswer ? 'pointer' : 'not-allowed' }}
        >
          Yes
        </button>
        <button
          onClick={() => onAnswer('Undrafted')}
          disabled={pending || !canAnswer}
          style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', opacity: canAnswer ? 1 : 0.45, cursor: canAnswer ? 'pointer' : 'not-allowed' }}
        >
          No
        </button>
      </div>
      {portalUrl ? (
        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Not sure? Check {policy.carrier_name || 'carrier'} portal <ExternalLink size={11} />
        </a>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          No portal on file for {policy.carrier_name || 'this carrier'}
        </span>
      )}
    </div>
  )
}

// Underwriting decision banner (Prompt 369) — deliberately NOT the yellow/
// Bell effectuation look. Brayden's explicit concern was agents misclicking
// the wrong Yes/No box because two banners looked too similar, so this one
// gets its own color (--pink, added alongside this prompt) and icon
// (Hourglass, not Bell). Prompt 399: now shares EFFECTUATION_GRID (and its
// carrier-portal column) with EffectuationRow so the Yes/No buttons land in
// the exact same position on both banner types — was its own 2-column grid,
// which put Yes/No further right than the effectuation banner since there
// was no third column stealing that space.
function UnderwritingRow({ policy, portalUrl, pending, onAnswer, canAnswer }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: EFFECTUATION_GRID, alignItems: 'center', gap: 16,
      padding: '12px 16px', background: 'var(--pink-dim)',
      border: '1px solid var(--pink-bd)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Hourglass size={15} style={{ color: 'var(--pink)', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
          Submitted for underwriting — has {policy.carrier_name || "the carrier"}'s decision come back? Was it approved?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }} title={canAnswer ? undefined : 'Only the submitting agent can answer this'}>
        <button
          onClick={() => onAnswer(true)}
          disabled={pending || !canAnswer}
          style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', opacity: canAnswer ? 1 : 0.45, cursor: canAnswer ? 'pointer' : 'not-allowed' }}
        >
          Yes
        </button>
        <button
          onClick={() => onAnswer(false)}
          disabled={pending || !canAnswer}
          style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap', opacity: canAnswer ? 1 : 0.45, cursor: canAnswer ? 'pointer' : 'not-allowed' }}
        >
          No
        </button>
      </div>
      {portalUrl ? (
        <a
          href={portalUrl}
          target="_blank"
          rel="noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          Not sure? Check {policy.carrier_name || 'carrier'} portal <ExternalLink size={11} />
        </a>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          No portal on file for {policy.carrier_name || 'this carrier'}
        </span>
      )}
    </div>
  )
}

// Lapse check-in banner (Prompt 369) — same yellow/Bell/Yes-No look as
// EffectuationRow (schema item 3: "reuse the exact same visual banner
// component"), just different copy and no carrier-portal column.
const NO_PORTAL_GRID = '1fr max-content'

function LapseCheckRow({ policy, pending, onAnswer }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: NO_PORTAL_GRID, alignItems: 'center', gap: 16,
      padding: '12px 16px', background: 'var(--warning-dim)',
      border: '1px solid var(--warning-bd)', borderRadius: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Bell size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
          Is {fullName(policy)}'s policy still on the book, or did it lapse?
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onAnswer(true)}
          disabled={pending}
          style={{ height: 28, padding: '0 14px', border: 'none', borderRadius: 6, background: 'var(--success)', color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          Yes
        </button>
        <button
          onClick={() => onAnswer(false)}
          disabled={pending}
          style={{ height: 28, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          No
        </button>
      </div>
    </div>
  )
}

// Needs Follow-up tab (Prompt 369) — Undrafted/Not Approved/Lapsed policies
// that aren't archived. Simpler than the Active tab's table: no search/
// filter toolbar, just the list plus the two row actions.
function NeedsFollowUpTab({ policies, isLoading, onSelect, onReactivate, onArchive, pending }) {
  const rows = useMemo(() => policies
    .filter(p => NEEDS_FOLLOWUP_STATUSES.includes(p.status) && !p.archived_at)
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
  [policies])

  const REACTIVATE_LABEL = { 'Undrafted': 'Back on the books', 'Not Approved': 'Back on the books', 'Lapsed': 'Back on the books' }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Customer</th>
              <th style={th}>Carrier</th>
              <th style={{ ...th, textAlign: 'right' }}>AP</th>
              <th style={th}>Status</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...cell, fontSize: 13, color: 'var(--text-muted)' }}>
                  {isLoading ? 'Loading policies…' : 'Nothing needs follow-up right now.'}
                </td>
              </tr>
            ) : rows.map(p => {
              const st = STATUS_STYLE[p.status] || STATUS_STYLE['Undrafted']
              return (
                <tr key={p.id}>
                  <td style={{ ...cell, minWidth: 160, cursor: 'pointer' }} onClick={() => onSelect(p)}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {fullName(p)}
                    </span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                      {p.policy_number || '—'}
                    </span>
                  </td>
                  <td style={{ ...cell, fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {p.carrier_name || '—'}
                  </td>
                  <td style={{ ...cell, textAlign: 'right', fontSize: 12.5, color: 'var(--text-primary)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                    {money(p.annual_premium)}
                  </td>
                  <td style={cell}>
                    <span style={{
                      display: 'inline-flex', padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                      background: st.dim, color: st.color, border: `1px solid ${st.bd}`, whiteSpace: 'nowrap',
                    }}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => onReactivate(p)}
                        disabled={pending}
                        style={{ height: 26, padding: '0 10px', border: 'none', borderRadius: 6, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        {REACTIVATE_LABEL[p.status]}
                      </button>
                      <button
                        onClick={() => onArchive(p)}
                        disabled={pending}
                        style={{ height: 26, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        Mark as gone
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <AnchoredSelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options.map(([v, l]) => ({ value: v, label: l }))}
    />
  )
}
