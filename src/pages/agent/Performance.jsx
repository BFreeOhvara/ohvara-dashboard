import { useMemo, useState } from 'react'
import {
  Wallet, TrendingUp, CheckCircle2, Users, DollarSign,
  Phone, Target, Activity, LogOut, Clock,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies, productionSnapshot, productionFlow, persistencyWindows } from '../../hooks/usePolicies'
import { money, moneyShort, formatDate, todayISO } from '../../lib/policyFormat'
import { usePeriodPicker, PeriodPicker } from '../../components/agent/ProductionPeriodPicker'
import { GapNote } from '../../components/ui/ExportForm'
import { Segmented } from '../../components/ui/Segmented'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Performance — Production + Leaderboard (Prompt 348), replacing the
// StatsPlaceholder. Structure/content match the Claude Design v3 mockup
// (media/claude-design-export-ohvara-dashboard-v3.html, lines 377-617);
// visual tokens follow this app's own DESIGN.md, same rule as every other
// mockup-referenced build.
//
// Two real data gaps, rendered as "—" rather than invented (same convention
// AgentOverview's Calls Taken tiles already use): call data doesn't exist
// in-app (calls happen on the closer's own phone), so Calls Taken and Close
// Rate (which divides by it) have no source. Approval Rate IS real — it's
// submitted-vs-in-force from `policies`, the same ratio bookMetrics() calls
// placedRate.
//
// Leaderboard visibility follows the existing policies_select RLS
// (can_view_agent → self + downline, or everything for admin) rather than a
// new company-wide query — a closer's board is scoped to their own team, not
// every branch, because that's the real security boundary today (see
// hooks/useHierarchy.js's own "KNOWN GAP" note). Opening it company-wide for
// every closer would need that RLS policy revisited — flagged, not built
// around.
//
// Not built: the mockup's per-closer "2× Top spot / NEW" badge chips. There's
// no ranking-history table to compute them from — adding fabricated badges
// would be worse than omitting them.

const MONO = "'JetBrains Mono',monospace"
const GOLD = 'var(--warning)'
const SILVER = '#9CA3AF'
const BRONZE = '#B87333'

function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function initialsOf(name) {
  return (name || '?').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
}

export default function Performance() {
  const [subTab, setSubTab] = useState('production')

  return (
    <div style={{ maxWidth: 1280 }}>
      <Segmented
        style={{ marginBottom: 24 }}
        value={subTab}
        onChange={setSubTab}
        options={[
          { value: 'production', label: 'Production' },
          { value: 'leaderboard', label: 'Leaderboard' },
        ]}
      />
      {subTab === 'production' ? <ProductionTab /> : <LeaderboardTab />}
    </div>
  )
}

function Tile({ icon: Icon, label, value, valueColor = 'var(--text-primary)', sub }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, padding: '18px 20px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: valueColor, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflowWrap: 'anywhere' }}>
        {value}
      </div>
      {sub && <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

// ── Production tab ───────────────────────────────────────────────────────────
function ProductionTab() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const today = todayISO()
  const todayMonthKey = today.slice(0, 7)

  // usePolicies(null) already returns everything RLS lets this account see —
  // self + downline for a closer, everything for admin (policies_select →
  // can_view_agent → downline_of()). That's exactly what "Team" should mean
  // (Prompt 348 point 5), so no separate hierarchy query is needed here:
  // "You" narrows to this account's own rows, "Team" is the unfiltered set.
  const { data: allVisible = [], isLoading } = usePolicies(null)
  const [scope, setScope] = useState('you')
  // Prompt 371: "Team" is a real company-wide rollup once admin's actual
  // team is live, so test-account (nate44) policies are excluded from it —
  // same rule as Leaderboard below. "You" is unaffected either way, since
  // it's already scoped to this account's own agent_id.
  const scopedPolicies = useMemo(
    () => (scope === 'you'
      ? allVisible.filter(p => p.agent_id === profile?.id)
      : excludeTestAccounts(allVisible, profile?.id)),
    [allVisible, scope, profile?.id]
  )

  const picker = usePeriodPicker(today)
  const { bounds, asOf } = picker

  const snapshot = useMemo(() => productionSnapshot(scopedPolicies, asOf), [scopedPolicies, asOf])
  const flow = useMemo(() => productionFlow(scopedPolicies, bounds.lo, bounds.hi), [scopedPolicies, bounds])

  const scopeWord = scope === 'you' ? 'your' : "the team's"
  const asOfLabel = asOf === today ? 'today' : formatDate(asOf)

  // ── Persistency — always current rolling windows, no period control ───────
  // (Prompt 352: removed the This Month/Last Month/Custom Range picker — the
  // 30/3/6/12-month windows are inherently "as of today" and there's no
  // clean meaning for "persistency as of last month" at this stage.)
  const persistency = useMemo(
    () => persistencyWindows(scopedPolicies, [todayMonthKey], todayMonthKey),
    [scopedPolicies, todayMonthKey]
  )

  const v = x => (isLoading ? '—' : x)

  return (
    <div>
      {/* Prompt 386: alignItems flex-start so the You/Team toggle sits level
          with PeriodPicker's own toggle row (its top row) instead of being
          vertically centered against the now-two-row block below it. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <Segmented
          size="sm"
          value={scope}
          onChange={setScope}
          options={[{ value: 'you', label: 'You' }, { value: 'team', label: 'Team' }]}
        />
        <PeriodPicker {...picker} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 16 }}>
        <Tile
          icon={Wallet} label="Active AP"
          value={v(moneyShort(snapshot.activeAP))}
          sub={`${snapshot.policiesActive} in-force polic${snapshot.policiesActive === 1 ? 'y' : 'ies'} · ${scopeWord} book as of ${asOfLabel}`}
        />
        <Tile
          icon={TrendingUp} label="Submitted AP" valueColor="var(--success)"
          value={v(moneyShort(flow.submittedAP))}
          sub={`${flow.submittedCount} app${flow.submittedCount === 1 ? '' : 's'} submitted · ${picker.label}`}
        />
        <Tile
          icon={CheckCircle2} label="Issued AP" valueColor="var(--success)"
          value={v(moneyShort(flow.issuedAP))}
          sub={`approved & placed in force · ${picker.label}`}
        />
        <Tile
          icon={Users} label="Policies Active"
          value={v(String(snapshot.policiesActive))}
          sub={`${scopeWord} in-force book as of ${asOfLabel}`}
        />
        <Tile
          icon={DollarSign} label="Average Premium"
          value={v(flow.avgMonthlyPremium ? `${money(flow.avgMonthlyPremium)}/mo` : '—')}
          sub={`avg. across submitted apps · ${picker.label}`}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 24 }}>
        <Tile
          icon={Phone} label="Calls Taken"
          value="—"
          sub="Not tracked in-app yet"
        />
        <Tile
          icon={Target} label="Close Rate"
          value="—"
          sub="Needs call tracking"
        />
        <Tile
          icon={Activity} label="Approval Rate"
          value={v(flow.approvalRate === null ? '—' : `${Math.round(flow.approvalRate)}%`)}
          sub="apps approved ÷ apps submitted"
        />
        <Tile
          icon={LogOut} label="Fall-off Rate" valueColor="var(--danger)"
          value={v(snapshot.fallOffRate === null ? '—' : `${Math.round(snapshot.fallOffRate)}%`)}
          sub={`of the book issued through ${asOfLabel}`}
        />
        <Tile
          icon={Clock} label="Average Days to Issue"
          value={v(snapshot.avgDaysToIssue === null ? '—' : Math.round(snapshot.avgDaysToIssue))}
          sub={`submitted → effective, as of ${asOfLabel}`}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Persistency</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        {persistency.map(p => (
          <div key={p.window} style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, padding: '18px 20px' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              {p.window}
            </span>
            <div style={{ marginTop: 10, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', fontFamily: MONO }}>
              {isLoading ? '—' : p.rolling === null ? '—' : `${p.rolling}%`}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
              {isLoading || p.allTime === null ? '—' : `${p.allTime}%`} all-time
            </p>
          </div>
        ))}
      </div>
      <GapNote>6- and 12-month windows unlock as the book ages.</GapNote>
    </div>
  )
}

// ── Leaderboard tab ─────────────────────────────────────────────────────────
function LeaderboardTab() {
  const { profile } = useAuth()
  const { data: allVisible = [], isLoading } = usePolicies(null)
  const [boardMode, setBoardMode] = useState('monthly')

  const today = todayISO()
  const [lo, hi] = boardMode === 'daily' ? [today, today] : [today.slice(0, 7) + '-01', today]

  // Prompt 371: standings are a real ranking once admin's actual team is
  // live, so nate44's fabricated policies can't inflate/appear in it.
  const eligible = useMemo(() => excludeTestAccounts(allVisible, profile?.id), [allVisible, profile?.id])

  const standings = useMemo(() => {
    const byAgent = new Map()
    for (const p of eligible) {
      const d = (p.policy_sold_date || p.created_at?.slice(0, 10) || '')
      if (d < lo || d > hi) continue
      const id = p.agent_id
      const name = p.agent?.full_name || 'Unknown'
      if (!byAgent.has(id)) byAgent.set(id, { id, name, ap: 0, families: 0 })
      const row = byAgent.get(id)
      row.ap += Number(p.annual_premium || 0)
      row.families += 1
    }
    return [...byAgent.values()]
      .sort((a, b) => b.ap - a.ap)
      .map((r, i) => ({ ...r, rank: i + 1, avg: r.families ? r.ap / r.families : 0 }))
  }, [eligible, lo, hi])

  const top3 = standings.slice(0, 3)
  const rest = standings.slice(3)
  const placeColor = rank => (rank === 1 ? GOLD : rank === 2 ? SILVER : BRONZE)
  const periodLabel = boardMode === 'daily' ? `Today · ${formatDate(today)}` : monthLabel(today.slice(0, 7))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <Segmented
          value={boardMode}
          onChange={setBoardMode}
          options={[{ value: 'daily', label: 'Daily' }, { value: 'monthly', label: 'Monthly' }]}
        />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{periodLabel} · ranked by submitted AP</span>
      </div>

      {isLoading ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
            <PodiumCard row={top3[1]} place="2ND PLACE" color={placeColor(2)} size="sm" />
            <PodiumCard row={top3[0]} place="TOP PERFORMER" color={placeColor(1)} size="lg" />
            <PodiumCard row={top3[2]} place="3RD PLACE" color={placeColor(3)} size="sm" />
          </div>

          <div style={{ background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: 'var(--border-w) solid var(--border)' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Full standings</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>submitted AP · {periodLabel}</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Rank', 'Closer', 'Families', 'Avg / family', 'Submitted AP'].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        textAlign: i >= 2 ? 'right' : 'left', padding: '10px 16px', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
                        borderBottom: 'var(--border-w) solid var(--border)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rest.map(r => (
                  <tr key={r.id}>
                    <td style={tdStyle}>#{r.rank}</td>
                    <td style={{ ...tdStyle, fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{r.name}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{r.families}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{moneyShort(r.avg)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{moneyShort(r.ap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const tdStyle = {
  padding: '11px 16px', borderBottom: 'var(--border-w) solid var(--border)',
  fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO,
}

// row is undefined when fewer than 3 closers have submissions in this
// window (Prompt 356) — the podium always shows 3 boxes, an empty slot
// renders as a muted N/A placeholder rather than being omitted.
function PodiumCard({ row, place, color, size }) {
  const lg = size === 'lg'
  const empty = !row
  return (
    <div style={{
      flex: 1, background: 'var(--bg-surface)', border: `1.5px solid ${empty ? 'var(--border)' : color}`, borderRadius: 10,
      padding: lg ? '38px 20px 24px' : '20px 18px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: lg ? 8 : 7,
      boxShadow: lg && !empty ? '0 8px 24px rgba(0,0,0,0.18)' : 'none', position: lg ? 'relative' : 'static',
      opacity: empty ? 0.55 : 1,
    }}>
      <span style={{
        display: 'inline-flex', padding: lg ? '3px 10px' : '3px 9px', borderRadius: 5, fontSize: lg ? 10 : 9.5, fontWeight: 700, letterSpacing: '0.06em',
        background: empty ? 'var(--bg-elevated)' : color, color: empty ? 'var(--text-muted)' : '#fff',
      }}>
        {place}
      </span>
      <span style={{
        width: lg ? 60 : 48, height: lg ? 60 : 48, borderRadius: '50%', background: 'var(--bg-elevated)',
        border: `${lg ? 2.5 : 2}px solid ${empty ? 'var(--border)' : color}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: lg ? 18 : 15, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4,
      }}>
        {empty ? '—' : initialsOf(row.name)}
      </span>
      <span style={{ fontSize: lg ? 15 : 13.5, fontWeight: 700, color: empty ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {empty ? 'N/A' : row.name}
      </span>
      {empty ? (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No closer yet</span>
      ) : (
        <>
          <span style={{ fontSize: lg ? 26 : 20, fontWeight: 700, color: 'var(--success)', fontFamily: MONO }}>{moneyShort(row.ap)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{moneyShort(row.avg)} avg · {row.families} famil{row.families === 1 ? 'y' : 'ies'}</span>
        </>
      )}
    </div>
  )
}
