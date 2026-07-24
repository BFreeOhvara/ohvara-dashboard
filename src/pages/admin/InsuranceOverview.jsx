import { useMemo } from 'react'
import { Phone, TrendingUp, FileText, CheckCircle, X, DollarSign } from 'lucide-react'
import { usePolicies } from '../../hooks/usePolicies'
import { moneyShort, todayISO } from '../../lib/policyFormat'

// Admin · Overview — literal port of the approved Claude Design export
// (vault: media/claude-design-export-ohvara-dashboard-v3.html, lines 774-894):
// six KPI tiles, funnel + hourly call chart, cancellation breakdown +
// persistency, then the closer leaderboard.
//
// Every panel is the export's, byte for byte on structure. What differs is
// the data: policy-derived figures are real, and the call-derived ones
// (funnel, inbound-by-hour, transfers, close rate, handle time, duty status)
// have NO source yet — calls happen on the agent's own phone today. Those
// render an em-dash or an explicit "no data" line inside the same panel
// rather than sample numbers dressed up as real (Prompt 327).

const MONO = "'JetBrains Mono',monospace"

const card = {
  background: 'var(--bg-surface)',
  border: 'var(--border-w) solid var(--border)',
  borderRadius: 8,
}
const th = {
  textAlign: 'left', padding: '10px 16px', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)',
  borderBottom: 'var(--border-w) solid var(--border)',
}
const td = {
  padding: '11px 16px', borderBottom: 'var(--border-w) solid var(--border)',
  fontSize: 11.5, color: 'var(--text-primary)', fontFamily: MONO,
}

export default function InsuranceOverview() {
  const { data: policies = [], isLoading } = usePolicies(null)

  const today = todayISO()
  const month = today.slice(0, 7)

  const m = useMemo(() => {
    const ap = rows => rows.reduce((s, p) => s + Number(p.annual_premium || 0), 0)
    const soldToday = policies.filter(p => p.policy_sold_date === today)
    const soldMonth = policies.filter(p => (p.policy_sold_date || '').slice(0, 7) === month)
    const effMonth = policies.filter(p => p.status === 'In Effect' && (p.effective_date || '').slice(0, 7) === month)
    const cancelled = policies.filter(p => p.cancellation_status === 'Cancellation Complete' && (p.policy_sold_date || '').slice(0, 7) === month)
    const inUnderwriting = policies.filter(p => p.status === 'Submitted').length
    return {
      apToday: ap(soldToday), countToday: soldToday.length,
      apMonth: ap(soldMonth), countMonth: soldMonth.length, inUnderwriting,
      effAP: ap(effMonth), effCount: effMonth.length,
      placedRate: soldMonth.length ? Math.round((effMonth.length / soldMonth.length) * 100) : 0,
      cancelAP: ap(cancelled), cancelCount: cancelled.length,
      netAP: ap(soldMonth) - ap(cancelled),
    }
  }, [policies, today, month])

  const kpis = [
    { label: 'Inbound calls today', icon: Phone, value: '—', sub: 'Calls are not tracked in-app yet', subColor: 'var(--text-muted)' },
    { label: 'Submitted AP today', icon: TrendingUp, value: moneyShort(m.apToday), sub: `${m.countToday} app${m.countToday === 1 ? '' : 's'}`, subColor: 'var(--success)' },
    { label: 'Submitted AP — MTD', icon: FileText, value: moneyShort(m.apMonth), sub: `${m.countMonth} apps · ${m.inUnderwriting} in underwriting`, subColor: 'var(--text-muted)' },
    { label: 'Effectuated AP — MTD', icon: CheckCircle, value: moneyShort(m.effAP), sub: `${m.effCount} policies in force · placed rate ${m.placedRate}%`, subColor: 'var(--text-muted)' },
    { label: 'Cancelled AP — MTD', icon: X, value: moneyShort(m.cancelAP), sub: `${m.cancelCount} lapses / early cancels`, subColor: 'var(--danger)' },
    { label: 'Net AP — MTD', icon: DollarSign, value: moneyShort(m.netAP), sub: 'Submitted − cancelled', subColor: 'var(--text-muted)' },
  ]

  // Days between the sale and the scheduled 3-way call, for cancellations
  // that actually completed. The schema has no "old policy cancelled on"
  // date, so the call date is the closest real proxy — caption says so.
  const cancRows = useMemo(() => {
    const done = policies.filter(p => p.cancellation_status === 'Cancellation Complete' && p.cancellation_call_at && p.policy_sold_date)
    const buckets = [
      { bucket: '0-14d', color: 'var(--success)', max: 14 },
      { bucket: '15-30d', color: 'var(--success)', max: 30 },
      { bucket: '31-90d', color: 'var(--warning)', max: 90 },
      { bucket: '90d+', color: 'var(--danger)', max: Infinity },
    ].map(b => ({ ...b, rows: [] }))
    for (const p of done) {
      const days = Math.round((new Date(p.cancellation_call_at) - new Date(p.policy_sold_date)) / 86400000)
      const b = buckets.find(x => days <= x.max)
      if (b) b.rows.push(p)
    }
    const total = done.length
    return buckets.map(b => ({
      bucket: b.bucket,
      color: b.color,
      count: b.rows.length,
      pct: total ? `${Math.round((b.rows.length / total) * 100)}%` : '—',
      barW: total ? `${Math.max(2, Math.round((b.rows.length / total) * 100))}%` : '0%',
      ap: moneyShort(b.rows.reduce((s, p) => s + Number(p.annual_premium || 0), 0)),
    }))
  }, [policies])

  // Share of policies effective at least N days ago that are still In Effect.
  // A window with nothing old enough in it reads "—", not 100%.
  const persistency = useMemo(() => {
    const windows = [['30 day', 30], ['3 month', 90], ['6 month', 180], ['12 month', 365]]
    const now = Date.now()
    return windows.map(([label, days]) => {
      const eligible = policies.filter(p => {
        if (!p.effective_date) return false
        return (now - new Date(p.effective_date).getTime()) / 86400000 >= days
      })
      if (eligible.length === 0) return { window: label, rolling: '—', allTime: '—' }
      const inForce = eligible.filter(p => p.status === 'In Effect').length
      const pct = `${((inForce / eligible.length) * 100).toFixed(1)}%`
      return { window: label, rolling: pct, allTime: pct }
    })
  }, [policies])

  const leaderboard = useMemo(() => {
    const byAgent = new Map()
    for (const p of policies) {
      const id = p.agent_id
      if (!id) continue
      if (!byAgent.has(id)) byAgent.set(id, { id, name: p.agent?.full_name || 'Unknown', mtd: 0, closesToday: 0 })
      const a = byAgent.get(id)
      if ((p.policy_sold_date || '').slice(0, 7) === month) a.mtd += Number(p.annual_premium || 0)
      if (p.policy_sold_date === today) a.closesToday += 1
    }
    return [...byAgent.values()].sort((a, b) => b.mtd - a.mtd).map((a, i) => ({ ...a, rank: `#${i + 1}` }))
  }, [policies, month, today])

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16, marginBottom: 28 }}>
        {kpis.map(k => (
          <div key={k.label} style={{ ...card, minWidth: 0, padding: '17px 19px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <k.icon size={11} style={{ color: 'var(--text-muted)' }} />
              <span style={{
                fontSize: 9.5, fontWeight: 700, letterSpacing: '0.09em',
                textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
              }}>
                {k.label}
              </span>
            </div>
            <div style={{
              fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1,
              color: 'var(--text-primary)', fontFamily: MONO,
            }}>
              {isLoading ? '—' : k.value}
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 10.5, color: k.subColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {k.sub}
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20, alignItems: 'start', marginBottom: 28 }}>
        <div style={{ ...card, padding: '20px 24px' }}>
          <PanelHead title="Funnel — last 7 days" note="click → call → qualify → transfer → submit → cancel" />
          <NoData>
            The funnel needs ad-click and call data. Google Ads and the AI receptionist
            aren't feeding the app yet, so nothing here would be real.
          </NoData>
        </div>
        <div style={{ ...card, padding: '20px 24px' }}>
          <PanelHead title="Inbound calls by hour — today" note="" />
          <NoData>No call data source yet.</NoData>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20, alignItems: 'start', marginBottom: 28 }}>
        <div style={{ ...card, padding: '20px 24px' }}>
          <PanelHead title="Cancellation breakdown — time to resolve" note="app submitted → 3-way cancellation call" />
          {cancRows.every(r => r.count === 0) ? (
            <NoData>No completed cancellations yet.</NoData>
          ) : cancRows.map(c => (
            <div key={c.bucket} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <span style={{ width: 80, flexShrink: 0, fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO }}>{c.bucket}</span>
              <div style={{ flex: 1, height: 14, borderRadius: 4, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 4, opacity: 0.85, background: c.color, width: c.barW }} />
              </div>
              <span style={{ width: 26, textAlign: 'right', fontSize: 11.5, color: 'var(--text-primary)', fontFamily: MONO }}>{c.count}</span>
              <span style={{ width: 40, textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>{c.pct}</span>
              <span style={{ width: 52, textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)', fontFamily: MONO }}>{c.ap}</span>
            </div>
          ))}
        </div>

        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: 'var(--border-w) solid var(--border)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Persistency</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>policies still in force</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, padding: '8px 16px' }}>Window</th>
                <th style={{ ...th, padding: '8px 16px', textAlign: 'right' }}>Rolling</th>
                <th style={{ ...th, padding: '8px 16px', textAlign: 'right' }}>All-time</th>
              </tr>
            </thead>
            <tbody>
              {persistency.map(p => (
                <tr key={p.window}>
                  <td style={{ ...td, padding: '8px 16px', fontSize: 12, fontFamily: 'inherit' }}>{p.window}</td>
                  <td style={{ ...td, padding: '8px 16px', textAlign: 'right' }}>{p.rolling}</td>
                  <td style={{ ...td, padding: '8px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>{p.allTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: 0, padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
            Windows unlock as the book ages.
          </p>
        </div>
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: 'var(--border-w) solid var(--border)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            Closer leaderboard — {new Date().toLocaleDateString('en-US', { month: 'long' })} MTD
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>ranked by submitted AP</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Closer</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right' }}>Transfers today</th>
                <th style={{ ...th, textAlign: 'right' }}>Closes today</th>
                <th style={{ ...th, textAlign: 'right' }}>Close rate</th>
                <th style={{ ...th, textAlign: 'right' }}>Avg handle</th>
                <th style={{ ...th, textAlign: 'right' }}>Submitted AP — MTD</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...td, fontFamily: 'inherit', fontSize: 13, color: 'var(--text-muted)' }}>
                    {isLoading ? 'Loading…' : 'No policies submitted yet.'}
                  </td>
                </tr>
              ) : leaderboard.map(c => (
                <tr key={c.id}>
                  <td style={{ ...td, fontFamily: 'inherit' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, marginRight: 8 }}>{c.rank}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</span>
                  </td>
                  <td style={{ ...td, fontFamily: 'inherit', color: 'var(--text-muted)', fontSize: 11 }}>—</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                  <td style={{ ...td, textAlign: 'right' }}>{c.closesToday}</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                  <td style={{ ...td, textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{moneyShort(c.mtd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function PanelHead({ title, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
      {note && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{note}</span>}
    </div>
  )
}

function NoData({ children }) {
  return <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>{children}</p>
}
