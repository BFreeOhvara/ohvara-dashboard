import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useReps, useRepStats } from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { Phone, Calendar, TrendingUp, DollarSign, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { KPICard } from '../../components/ui/KPICard'
import { LiveClock } from '../../components/ui/LiveClock'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

// ── helpers ──────────────────────────────────────────────────────────────────

function todayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function fmt$(n) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`
}

function fmtTime(iso, tz) {
  return formatInTimezone(iso, tz, { hour: 'numeric', minute: '2-digit' })
}

function ConnectPct({ value }) {
  const n = parseFloat(value) || 0
  const color = n >= 15 ? 'var(--success)' : n >= 8 ? 'var(--warning)' : 'var(--danger)'
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, fontVariantNumeric: 'tabular-nums' }}>
      {n.toFixed(1)}%
    </span>
  )
}

// KpiCard — local shim; delegates to shared KPICard with glass + countup
function KpiCard({ label, value, sub, subColor, icon: Icon, accent }) {
  // Convert string values (e.g. '$3.2k') to numeric for countup where possible
  const numericValue = typeof value === 'number' ? value : null
  return (
    <KPICard
      label={label}
      value={numericValue ?? 0}
      sub={numericValue === null ? String(value ?? '—') : sub}
      subColor={subColor}
      icon={Icon}
      accent={accent}
    />
  )
}

// ── Price badge for bookings feed ───────────────────────────────────────────────
// No fixed tiers anymore (Prompt 5) — shows the lead's actual cached custom
// price if recommend-stack has already run, else a neutral "pending" badge.

function PriceBadge({ customMonthlyPrice }) {
  if (!customMonthlyPrice) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500,
        background: 'var(--bg-elevated)', color: 'var(--text-muted)',
      }}>
        Quote pending
      </span>
    )
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500,
      background: 'var(--accent-dim)', color: 'var(--accent)',
    }}>
      ${customMonthlyPrice.toLocaleString()}/mo
    </span>
  )
}

// ── Per-rep row ───────────────────────────────────────────────────────────────

function RepRow({ rep }) {
  const [expanded, setExpanded] = useState(false)
  const { data: stats } = useRepStats(rep.id, 'day')

  const todayLeadsQ = useQuery({
    queryKey: ['rep-today-leads', rep.id],
    queryFn: async () => {
      // Look up the rep's most recent batch_date instead of filtering on an
      // independently-computed "today" — assign_daily_batches() doesn't
      // advance batch_date until 06:05 UTC, so a computed UTC-midnight
      // "today" goes empty for ~6h every night. Mirrors the useMyLeads() fix
      // in src/hooks/useLeads.js (brain/LIVE_STATE Prompt 195 in the vault).
      const { data: latest, error: latestErr } = await supabase
        .from('leads')
        .select('batch_date')
        .eq('assigned_rep_id', rep.id)
        .not('batch_date', 'is', null)
        .order('batch_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestErr) throw latestErr
      if (!latest) return []

      const { data, error } = await supabase
        .from('leads')
        .select('id, business_name, niche, city, status')
        .eq('assigned_rep_id', rep.id)
        .eq('batch_date', latest.batch_date)
        .order('status')
      if (error) throw error
      return data
    },
    enabled: expanded,
  })

  const initials = rep.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <>
      <div
        className="table-row-animated"
        style={{
          display: 'flex', alignItems: 'center',
          borderBottom: '0.5px solid var(--border)',
          background: expanded ? 'var(--bg-elevated)' : 'transparent',
          transition: 'background-color 100ms',
          cursor: 'default',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = 'var(--bg-elevated)' }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Rep name */}
        <div style={{ flex: '1 1 0', minWidth: 0, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%',
            background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--accent)' }}>{initials}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rep.full_name}
            </p>
          </div>
        </div>

        {/* Calls today */}
        <div style={{ flex: '0 0 100px', padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
          {stats?.totalDials ?? '—'}
        </div>

        {/* Booked */}
        <div style={{ flex: '0 0 80px', padding: '10px 8px', fontFamily: 'var(--font-mono)', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: stats?.bookedCount > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
          {stats?.bookedCount ?? '—'}
        </div>

        {/* Connect % */}
        <div style={{ flex: '0 0 100px', padding: '10px 8px' }}>
          <ConnectPct value={stats?.bookingRate} />
        </div>

        {/* Status */}
        <div style={{ flex: '0 0 90px', padding: '10px 8px' }}>
          <Badge label={rep.is_active ? 'active' : 'inactive'} />
        </div>

        {/* Expand */}
        <div style={{ flex: '0 0 44px', padding: '10px 16px 10px 0', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              color: 'var(--text-muted)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 3, borderRadius: 4, display: 'flex',
              transition: 'color 100ms',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* Expanded — today's leads for this rep */}
      {expanded && (
        <div style={{
          background: 'var(--bg-elevated)',
          borderBottom: '0.5px solid var(--border)',
          padding: '8px 16px 12px',
        }}>
          <p className="section-label" style={{ marginBottom: 8 }}>Today's Leads</p>
          {todayLeadsQ.isLoading ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</p>
          ) : !todayLeadsQ.data?.length ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No leads assigned today.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {todayLeadsQ.data.map(l => (
                <div key={l.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '3px 8px', borderRadius: 4,
                  border: '0.5px solid var(--border)',
                  background: 'var(--bg-overlay)',
                  fontSize: 11, color: 'var(--text-secondary)',
                }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{l.business_name}</span>
                  <Badge label={l.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Recharts tooltip ─────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(8,8,16,0.95)', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
    }}>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-mono)' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

// ── Analytics charts row ──────────────────────────────────────────────────────

function AnalyticsRow() {
  // 7-day activity trend — leads whose status changed in last 7 days
  const { data: trendData } = useQuery({
    queryKey: ['admin', 'activity-trend'],
    queryFn: async () => {
      const days = 7
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)

      const { data } = await supabase
        .from('leads')
        .select('updated_at, status')
        .gte('updated_at', cutoff.toISOString())

      if (!data?.length) {
        // Return zero-filled last 7 days
        return Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i))
          return { day: d.toLocaleDateString('en-US', { weekday: 'short' }), contacts: 0, booked: 0 }
        })
      }

      const buckets = {}
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i))
        const key = d.toLocaleDateString('en-US', { weekday: 'short' })
        buckets[key] = { day: key, contacts: 0, booked: 0 }
      }

      data.forEach(l => {
        const key = new Date(l.updated_at).toLocaleDateString('en-US', { weekday: 'short' })
        if (buckets[key]) {
          if (l.status === 'Contacted' || l.status === 'Voicemail' || l.status === 'No Answer') {
            buckets[key].contacts++
          }
          if (l.status === 'Booked') {
            buckets[key].booked++
          }
        }
      })

      return Object.values(buckets)
    },
    refetchInterval: 120000,
  })

  // Pipeline breakdown by status
  const { data: pipelineData } = useQuery({
    queryKey: ['admin', 'pipeline-breakdown'],
    queryFn: async () => {
      const { data } = await supabase
        .from('leads')
        .select('status')

      if (!data?.length) return []

      const counts = {}
      data.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1 })

      const ORDER = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Booked']
      return ORDER
        .filter(s => counts[s])
        .map(s => ({ status: s, count: counts[s] }))
    },
    refetchInterval: 120000,
  })

  const STATUS_COLORS = {
    New:       'var(--text-muted)',
    Contacted: 'var(--info)',
    Voicemail: 'var(--warning)',
    'No Answer': 'var(--danger)',
    Booked:    'var(--success)',
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      {/* 7-day activity */}
      <div className="glass" style={{ flex: 1, padding: '14px 16px 10px', borderRadius: 10, minWidth: 0 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          7-Day Activity
        </p>
        <ResponsiveContainer width="100%" height={100}>
          <AreaChart data={trendData || []} margin={{ top: 0, right: 0, bottom: 0, left: -28 }}>
            <defs>
              <linearGradient id="colorContacts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#6C63FF" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6C63FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBooked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#22C55E" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#55556A' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#55556A' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="contacts" name="Contacts" stroke="#6C63FF" strokeWidth={1.5} fill="url(#colorContacts)" dot={false} />
            <Area type="monotone" dataKey="booked"   name="Booked"   stroke="#22C55E" strokeWidth={1.5} fill="url(#colorBooked)"   dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Pipeline bar chart — full width on mobile (stacks below the 7-day
          chart instead of squeezing it, Prompt 298), fixed 240px at md+ */}
      <div className="glass w-full md:flex-none md:w-[240px]" style={{ padding: '14px 16px 10px', borderRadius: 10 }}>
        <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Pipeline
        </p>
        <ResponsiveContainer width="100%" height={100}>
          <BarChart data={pipelineData || []} margin={{ top: 0, right: 0, bottom: 0, left: -28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="status" tick={{ fontSize: 10, fill: '#55556A' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#55556A' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="count" name="Leads" radius={[3, 3, 0, 0]}
              fill="#6C63FF"
              /* per-bar coloring via cell would need Cell import — simplified single color */
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Main admin overview ───────────────────────────────────────────────────────

export default function Overview() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const { data: reps, isLoading: repsLoading } = useReps()

  const { data: kpis } = useQuery({
    queryKey: ['admin', 'kpis', 'today'],
    queryFn: async () => {
      const today = todayStart()
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

      const [callsRes, apptRes, revenueRes, showRes] = await Promise.all([
        supabase.from('calls').select('id', { count: 'exact' }).gte('created_at', today),
        supabase.from('appointments').select('id, status, lead:leads(monthly_labor_cost)').gte('created_at', monthStart),
        supabase.from('leads').select('monthly_labor_cost').eq('status', 'Booked'),
        supabase.from('appointments').select('id, outcome').neq('status', 'pending'),
      ])

      const appts = apptRes.data || []
      const booked = appts.filter(a => a.status === 'pending' || a.status === 'completed').length
      const showed = (showRes.data || []).filter(a => a.outcome !== 'no_show').length
      const showRate = showRes.data?.length ? Math.round((showed / showRes.data.length) * 100) : 0
      const pipeline = (revenueRes.data || []).reduce((s, l) => s + (l.monthly_labor_cost || 0), 0)

      return {
        callsToday: callsRes.count || 0,
        bookedToday: appts.filter(a => {
          const d = new Date(a.created_at || 0)
          return d >= new Date(today)
        }).length,
        showRate,
        pipeline: Math.round(pipeline * 0.3), // 30% close probability
      }
    },
    refetchInterval: 60000,
  })

  const { data: recentBookings } = useQuery({
    queryKey: ['admin', 'recent-bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_at, created_at, status,
          lead:leads(id, business_name, niche, monthly_labor_cost, custom_monthly_price),
          closer:profiles!appointments_closer_id_fkey(id, full_name),
          rep:profiles!appointments_rep_id_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(12)
      if (error) throw error
      return data
    },
    refetchInterval: 30000,
  })

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="flex flex-col md:flex-row" style={{ gap: 20, minHeight: 0 }}>
      {/* Left — KPIs + rep table */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2" style={{ marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
              Overview
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              Live across all reps and closers
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {today}
            </span>
            <LiveClock timezone={tz} />
          </div>
        </div>

        {/* KPI row — glass + countup */}
        {/* .kpi-grid (Prompt 295) — mobile 2-col grid, desktop flex row.
            Plain `flexWrap:'wrap'` doesn't actually wrap here since each
            KPICard has `minWidth:0` and just shrinks to fit instead of
            wrapping (caught visually in Prompt 298 verification). */}
        <div className="stagger kpi-grid" style={{ gap: 12, marginBottom: 20 }}>
          <KpiCard label="Calls Today"    value={kpis?.callsToday}  icon={Phone}     iconColor="var(--info)" />
          <KpiCard label="Booked Today"   value={kpis?.bookedToday} icon={Calendar}  iconColor="var(--success)" subColor={kpis?.bookedToday > 0 ? 'var(--success)' : undefined} />
          <KpiCard
            label="Show Rate"
            value={`${kpis?.showRate ?? 0}%`}
            icon={TrendingUp}
            iconColor="var(--warning)"
            subColor={kpis?.showRate >= 70 ? 'var(--success)' : kpis?.showRate >= 50 ? 'var(--warning)' : 'var(--danger)'}
            sub={kpis?.showRate >= 70 ? 'Above target' : kpis?.showRate >= 50 ? 'Near target' : 'Below target'}
          />
          <KpiCard
            label="Revenue Pipeline"
            value={kpis ? fmt$(kpis.pipeline) : '—'}
            icon={DollarSign}
            iconColor="var(--success)"
            sub="30% close probability"
          />
        </div>

        {/* Analytics charts */}
        <AnalyticsRow />

        {/* Rep performance table — horizontal scroll on narrow screens
            (Prompt 298: fixed 100/80/100/90/44px columns totaled 414px+ and
            were clipped by this container's old `overflow:'hidden'`; each
            row also has an inline expand/collapse detail panel, so a full
            mobile-card rebuild would duplicate that logic — the scrollable-
            table pattern already used by LeadPipeline/CloserPipeline's
            QueueTable is the lower-risk fix here). */}
        <div className="glass scrollbar-thin" style={{ overflowX: 'auto', borderRadius: 10 }}>
          <div style={{ minWidth: 560 }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center',
              borderBottom: '0.5px solid var(--border)',
              background: 'var(--bg-elevated)',
            }}>
              <div style={{ flex: '1 1 0', padding: '8px 16px' }} className="section-label">Rep</div>
              <div style={{ flex: '0 0 100px', padding: '8px 8px' }} className="section-label">Calls Today</div>
              <div style={{ flex: '0 0 80px', padding: '8px 8px' }} className="section-label">Booked</div>
              <div style={{ flex: '0 0 100px', padding: '8px 8px' }} className="section-label">Connect %</div>
              <div style={{ flex: '0 0 90px', padding: '8px 8px' }} className="section-label">Status</div>
              <div style={{ flex: '0 0 44px' }} />
            </div>

            {repsLoading ? (
              <div>
                {[...Array(4)].map((_, i) => (
                  <div key={i} style={{ height: 48, borderBottom: '0.5px solid var(--border)', padding: '14px 16px' }}>
                    <div style={{ height: 14, width: '40%', background: 'var(--bg-elevated)', borderRadius: 4 }} />
                  </div>
                ))}
              </div>
            ) : !reps?.length ? (
              <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No reps found.</p>
              </div>
            ) : (
              reps.map(rep => <RepRow key={rep.id} rep={rep} />)
            )}
          </div>
        </div>
      </div>

      {/* Right — recent bookings feed. Full width and capped-height on
          mobile (stacks below the rep table instead of forcing the whole
          2-col shell to overflow horizontally, Prompt 298); fixed 300px
          sticky sidebar unchanged at md+. */}
      <div
        className="glass w-full md:w-[300px] flex-shrink-0 flex flex-col max-h-[420px] md:max-h-[calc(100vh-48px)] md:sticky md:top-0"
        style={{ overflow: 'hidden', borderRadius: 10 }}
      >
        <div style={{
          padding: '12px 16px', borderBottom: '0.5px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>Recent Bookings</p>
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-mono)',
            padding: '1px 5px', borderRadius: 3,
            background: 'var(--accent-dim)', color: 'var(--accent)',
          }}>
            {recentBookings?.length ?? 0}
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }} className="scrollbar-thin">
          {!recentBookings?.length ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No bookings yet today.</p>
            </div>
          ) : (
            recentBookings.map((appt, i) => (
              <div
                key={appt.id}
                style={{
                  padding: '10px 16px',
                  borderBottom: i < recentBookings.length - 1 ? '0.5px solid var(--border)' : 'none',
                  transition: 'background-color 100ms',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {appt.lead?.business_name || 'Unknown'}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {appt.closer?.full_name || 'Unassigned'} · {fmtTime(appt.scheduled_at || appt.created_at, tz)}
                    </p>
                  </div>
                  <PriceBadge customMonthlyPrice={appt.lead?.custom_monthly_price} />
                </div>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  via {appt.rep?.full_name || '—'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
