import { useMemo, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies, useTeamPerformancePolicies, LIVE_POLICY_STATUSES } from '../../hooks/usePolicies'
import { excludeTestAccounts } from '../../lib/testAccounts'
import { money, fullName } from '../../lib/policyFormat'
import { Segmented } from '../../components/ui/Segmented'
import { MONO } from '../../lib/exportStyles'

// Balance — Prompt 412. Real projected-commission numbers, computed
// server-side (migration 098's estimated_commission column/trigger) from
// annual_premium x commission_schedule's tier-70 rate for the 9 carriers
// with real comp data. No reserve/holdback modeling anywhere — Brayden's
// explicit call, this is a flat commission estimate, nothing withheld
// (Prompt 411 renamed the tab away from "Balance & Reserve" for the same
// reason). Labeled "Projected Commission" throughout, never a bare number —
// real carrier payouts can differ (advance vs. as-earned timing,
// carrier-specific quirks), this is the best available estimate today, not
// a guaranteed payout.
const PENDING_CARRIERS = ['Aflac', 'Baltimore Life', 'Chubb']

function PendingBadge() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 4,
      fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap',
      background: 'var(--warning-dim)', color: 'var(--warning)', border: 'var(--border-w) solid var(--warning-bd)',
    }}>
      Pending — carrier comp data not yet available
    </span>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8,
      padding: '18px 22px', flex: 1, minWidth: 200,
    }}>
      <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)', fontFamily: MONO, marginTop: 10 }}>
        {value}
      </div>
      {sub && <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

export default function Balance() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  // Same You/Everyone gate Overview (Prompt 404) and Performance (Prompt 396)
  // already use — only the upline/team-visibility role gets a toggle, and
  // only once they've confirmed they're still personally writing business.
  const alsoWritesBusiness = !!profile?.also_writes_business
  const showScopeToggle = isAdmin && alsoWritesBusiness
  const [scope, setScope] = useState('you')
  const effectiveScope = showScopeToggle ? scope : (isAdmin ? 'everyone' : 'you')

  const { data: ownPoliciesRaw = [], isLoading: isLoadingOwn } = usePolicies(profile?.id)
  const { data: teamRaw = [], isLoading: isLoadingTeam } = useTeamPerformancePolicies()
  const teamPolicies = useMemo(() => excludeTestAccounts(teamRaw, profile?.id), [teamRaw, profile?.id])

  const ownPolicies = useMemo(
    () => ownPoliciesRaw.filter(p => LIVE_POLICY_STATUSES.includes(p.status)),
    [ownPoliciesRaw]
  )

  const isLoading = effectiveScope === 'everyone' ? isLoadingTeam : isLoadingOwn

  const totals = useMemo(() => {
    const rows = effectiveScope === 'everyone' ? teamPolicies : ownPolicies
    const isPending = effectiveScope === 'everyone'
      ? p => p.is_pending_commission
      : p => p.estimated_commission == null && PENDING_CARRIERS.includes(p.carrier_name)
    const total = rows.reduce((s, p) => s + Number(p.estimated_commission || 0), 0)
    const computedCount = rows.filter(p => p.estimated_commission != null).length
    const pendingCount = rows.filter(isPending).length
    return { total, computedCount, pendingCount }
  }, [effectiveScope, teamPolicies, ownPolicies])

  // Per-agent breakdown for the Everyone scope — team_performance_policies()
  // withholds carrier/product (PII boundary from Prompt 396), so a
  // per-policy table isn't possible here; a per-agent rollup is the
  // meaningful "broken out simply" view at this scope instead.
  const byAgent = useMemo(() => {
    if (effectiveScope !== 'everyone') return []
    const map = new Map()
    for (const p of teamPolicies) {
      if (!map.has(p.agent_id)) map.set(p.agent_id, { agent_id: p.agent_id, name: p.agent_name, total: 0, pending: 0 })
      const row = map.get(p.agent_id)
      row.total += Number(p.estimated_commission || 0)
      if (p.is_pending_commission) row.pending += 1
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [effectiveScope, teamPolicies])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            Balance
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Projected commission per policy — an estimate, not a confirmed carrier payout.
          </p>
        </div>
        {showScopeToggle && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[{ value: 'you', label: 'You' }, { value: 'everyone', label: 'Everyone' }]}
          />
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <StatCard
          label="Total Projected Commission"
          value={isLoading ? '—' : money(totals.total)}
          sub={effectiveScope === 'everyone' ? 'Company-wide, real carrier comp data only' : 'Your book, real carrier comp data only'}
        />
        <StatCard
          label="Policies With Real Comp Data"
          value={isLoading ? '—' : String(totals.computedCount)}
        />
        <StatCard
          label="Pending Carrier Comp Data"
          value={isLoading ? '—' : String(totals.pendingCount)}
          sub="Aflac, Baltimore Life, Chubb — awaiting real rates"
        />
      </div>

      {effectiveScope === 'you' ? (
        <div
          className="scrollbar-thin"
          style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, overflowX: 'auto' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                {['Client', 'Carrier', 'Product', 'Annual Premium', 'Projected Commission'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Annual Premium' || h === 'Projected Commission' ? 'right' : 'left',
                    padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--text-muted)',
                    borderBottom: 'var(--border-w) solid var(--border)',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : ownPolicies.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>No policies yet.</td></tr>
              ) : ownPolicies.map((p, i) => {
                const pending = p.estimated_commission == null && PENDING_CARRIERS.includes(p.carrier_name)
                return (
                  <tr key={p.id} style={{ borderTop: i > 0 ? 'var(--border-w) solid var(--border)' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{p.carrier_name || '—'}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{p.product_name || '—'}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: MONO, color: 'var(--text-primary)' }}>{money(p.annual_premium)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {p.estimated_commission != null
                        ? <span style={{ fontFamily: MONO, color: 'var(--text-primary)', fontWeight: 700 }}>{money(p.estimated_commission)}</span>
                        : pending
                          ? <PendingBadge />
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          className="scrollbar-thin"
          style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, overflowX: 'auto' }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, whiteSpace: 'nowrap' }}>
            <thead>
              <tr>
                {['Agent', 'Total Projected Commission', 'Pending Policies'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Agent' ? 'left' : 'right',
                    padding: '12px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--text-muted)',
                    borderBottom: 'var(--border-w) solid var(--border)',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={3} style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</td></tr>
              ) : byAgent.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '18px 16px', fontSize: 12.5, color: 'var(--text-muted)' }}>No policies yet.</td></tr>
              ) : byAgent.map((a, i) => (
                <tr key={a.agent_id} style={{ borderTop: i > 0 ? 'var(--border-w) solid var(--border)' : 'none' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 700, color: 'var(--text-primary)' }}>{a.name || '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: MONO, color: 'var(--text-primary)', fontWeight: 700 }}>{money(a.total)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>{a.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
