import { useMemo, useEffect } from 'react'
import { DollarSign, Briefcase, Target, Landmark, CheckCircle2, Loader2, Calendar as CalendarIcon, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { useAuth } from '../../hooks/useAuth'
import { useMyCommission } from '../../hooks/useProfiles'
import { useMyPayouts, useConnectOnboard, useCheckOnboardStatus } from '../../hooks/usePayouts'
import { KPICard } from '../../components/ui/KPICard'
import { RangeCalendar, useRangeCalendar } from '../../components/ui/RangeCalendar'

const CHART_DAYS = 30
// Measured rendered row footprint (10px+10px padding + 3 text lines + border,
// confirmed 77.5px live) — caps the Payouts list to exactly 5 visible rows
// before it scrolls internally.
const PAYOUT_ROW_HEIGHT = 77.5

function StatusChip({ status }) {
  const isPaid = status === 'paid'
  return (
    <span style={{
      fontSize: 11, fontWeight: 500,
      color: isPaid ? '#22C55E' : '#F59E0B',
      background: isPaid ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
    }}>
      {isPaid ? 'Paid' : 'Pending'}
    </span>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#13131F', border: '0.5px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--success)', margin: 0, fontFamily: 'var(--font-mono)' }}>
        ${payload[0].value.toFixed(2)}
      </p>
    </div>
  )
}

export default function MyCommissions() {
  const { profile } = useAuth()
  const { data: commission, isLoading } = useMyCommission(profile?.id)
  const connected = !!profile?.stripe_onboarding_complete
  const onboard = useConnectOnboard()
  const checkStatus = useCheckOnboardStatus()

  const {
    rangeStart, rangeEnd, hoverDate, setHoverDate,
    calOpen, setCalOpen, calViewYear, calViewMonth,
    calBtnRef, calPanelRef, hasCustomRange, calBtnLabel,
    clearRange, handleDayClick, prevMonth, nextMonth,
    firstCallDateStr, todayStr,
  } = useRangeCalendar(profile?.id, profile?.timezone)

  async function startOnboarding() {
    try {
      const res = await onboard.mutateAsync()
      if (res?.url) {
        window.open(
          res.url,
          'stripe-connect',
          `popup,width=500,height=700,left=${Math.floor((screen.width - 500) / 2)},top=${Math.floor((screen.height - 700) / 2)}`
        )
      }
    } catch { /* error surfaced via onboard.error below */ }
  }

  // When Stripe returns to ?onboarding=complete inside the popup, relay via
  // postMessage and close. If window.opener is null (popup blocked / same-tab
  // fallback), run checkStatus directly.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('onboarding')
    if (!flag) return
    if (flag === 'complete') {
      if (window.opener) {
        window.opener.postMessage('stripe-onboarding-complete', window.location.origin)
        window.close()
      } else {
        checkStatus.mutateAsync().finally(() => window.location.assign('/rep/commissions'))
      }
    } else {
      window.history.replaceState({}, '', '/rep/commissions')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Receive the popup's relay message and confirm onboarding status.
  useEffect(() => {
    function handleMessage(e) {
      if (e.origin !== window.location.origin) return
      if (e.data !== 'stripe-onboarding-complete') return
      checkStatus.mutateAsync().finally(() => window.history.replaceState({}, '', '/rep/commissions'))
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Daily earned series over the last CHART_DAYS (local days)
  const daily = useMemo(() => {
    const days = []
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      days.push({
        key: d.toDateString(),
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        earned: 0,
      })
    }
    const byKey = Object.fromEntries(days.map(d => [d.key, d]))
    for (const row of commission?.rows || []) {
      const day = byKey[new Date(row.created_at).toDateString()]
      if (day) day.earned += Number(row.amount || 0)
    }
    return days
  }, [commission])

  // All 3 KPI boxes recompute over the selected range; with no range picked
  // they fall back to all-time totals (Prompt 231 item D — the old KPI 3 was
  // a static, unfiltered "Last 7 Days" figure that never responded to
  // anything; replaced with a real range-scoped average).
  const scopedRows = useMemo(() => {
    const rows = commission?.rows || []
    if (!hasCustomRange) return rows
    const from = new Date(rangeStart + 'T00:00:00')
    const to   = new Date(rangeEnd   + 'T23:59:59')
    return rows.filter(r => { const d = new Date(r.created_at); return d >= from && d <= to })
  }, [commission, hasCustomRange, rangeStart, rangeEnd])

  const scopedTotal = scopedRows.reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const scopedDeals = scopedRows.length
  const scopedAvg = scopedDeals ? scopedTotal / scopedDeals : null

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          My Commissions
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          10% of every closed deal — paid when the closer signs the client you booked
        </p>
      </div>

      {/* Connect bank + custom-range calendar — own row above KPI cards, right-aligned */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {!connected && (
          <button
            onClick={startOnboarding}
            disabled={onboard.isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, height: 36, padding: '0 14px',
              background: 'var(--accent)', border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 500, color: 'white',
              cursor: onboard.isPending ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {onboard.isPending
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Opening…</>
              : <><Landmark size={14} /> Connect bank</>}
          </button>
        )}

        <div style={{ position: 'relative' }} ref={calBtnRef}>
          <button
            onClick={() => setCalOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              height: 36, padding: '0 12px',
              background: hasCustomRange || calOpen ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              border: `0.5px solid ${hasCustomRange ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 8, cursor: 'pointer',
              fontSize: 12, color: hasCustomRange ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'all 0.1s',
            }}
          >
            <CalendarIcon size={12} />
            {calBtnLabel}
            {hasCustomRange && (
              <span
                onClick={e => { e.stopPropagation(); clearRange() }}
                style={{ marginLeft: 2, display: 'flex', alignItems: 'center', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={11} />
              </span>
            )}
          </button>

          {calOpen && (
            <div
              ref={calPanelRef}
              style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 200,
                background: '#13131F', border: '0.5px solid var(--border)',
                borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
                minWidth: 224,
              }}
            >
              <div style={{ padding: '8px 12px 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {!rangeStart ? 'Click a start date' : !rangeEnd ? 'Click an end date' : null}
              </div>
              <RangeCalendar
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                hoverDate={hoverDate}
                onDayClick={handleDayClick}
                onDayHover={setHoverDate}
                viewYear={calViewYear}
                viewMonth={calViewMonth}
                onPrev={prevMonth}
                onNext={nextMonth}
                firstCallDateStr={firstCallDateStr}
                todayStr={todayStr}
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI row — all 3 recompute over the selected range; all-time when no range is picked */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-start' }}>
        <KPICard
          label="Total Earned"
          value={Math.floor(scopedTotal)}
          prefix="$"
          sub={hasCustomRange ? calBtnLabel : 'All time'}
          subColor={scopedTotal > 0 ? 'var(--success)' : undefined}
          accent={scopedTotal > 0}
          icon={DollarSign}
        />
        <KPICard
          label="Closed Deals"
          value={scopedDeals}
          sub="10% per close"
          icon={Briefcase}
        />
        <KPICard
          label="Avg Per Deal"
          value={scopedAvg != null ? Math.floor(scopedAvg) : 0}
          prefix="$"
          sub={scopedDeals ? 'Per closed deal' : 'No deals in range'}
          icon={Target}
        />
      </div>

      {/* Daily earnings chart */}
      <div className="glass" style={{ padding: '18px 20px', borderRadius: 12 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>
          Last {CHART_DAYS} Days
        </p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Commission earned per day
        </p>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                interval={Math.ceil(CHART_DAYS / 10) - 1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={v => `$${v}`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--bg-surface)' }} />
              <Bar
                dataKey="earned"
                name="Earned"
                fill="#22C55E"
                radius={[3, 3, 0, 0]}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {!isLoading && (commission?.deals ?? 0) === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: '12px 0 0' }}>
            No commissions yet — they appear here when the closer signs a deal you booked.
          </p>
        )}
      </div>

      <MyPayouts connected={connected} hasCustomRange={hasCustomRange} rangeStart={rangeStart} rangeEnd={rangeEnd} />
    </div>
  )
}

// Stripe Connect bank-link + payout history. Reps connect their bank once
// (Stripe handles KYC + 1099), then watch each closed deal's 10% move
// pending → paid here.
// Same "closed" date shown in each row's dateLabel below — paid rows prefer
// the appointment's actual close date, everything else falls back to the
// payout's own created_at. Shared by filtering and display so a range pick
// can never disagree with what the row itself says (Prompt 241).
function payoutClosedDate(p) {
  return p.status === 'paid' && p.paid_at ? (p.appointment?.closed_at || p.created_at) : p.created_at
}

function MyPayouts({ connected, hasCustomRange, rangeStart, rangeEnd }) {
  const { profile } = useAuth()
  const { data: payouts } = useMyPayouts(profile?.id)

  // Filters to whichever window the 3 KPI boxes above are already scoped to
  // (Prompt 241) — All Time (everything), a picked day, or a picked range,
  // inclusive of both endpoints. The 5-row scroll cap and Last 30 Days chart
  // are unaffected.
  const scopedPayouts = useMemo(() => {
    const rows = payouts || []
    if (!hasCustomRange) return rows
    const from = new Date(rangeStart + 'T00:00:00')
    const to   = new Date(rangeEnd   + 'T23:59:59')
    return rows.filter(p => { const d = new Date(payoutClosedDate(p)); return d >= from && d <= to })
  }, [payouts, hasCustomRange, rangeStart, rangeEnd])

  return (
    <div className="glass" style={{ padding: '18px 20px', borderRadius: 12, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 2px' }}>My Payouts</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
            Connect your bank once — paid commissions land in ~2 days
          </p>
        </div>
        {connected && (
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
            color: 'var(--success)', background: 'rgba(34,197,94,0.12)', padding: '6px 12px', borderRadius: 999,
          }}>
            <CheckCircle2 size={14} /> Bank connected
          </span>
        )}
      </div>

      {scopedPayouts.length === 0 ? (
        <div style={{
          minHeight: PAYOUT_ROW_HEIGHT * 5, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
            {(payouts?.length ?? 0) === 0
              ? 'No payouts yet — a pending payout appears here when the closer signs a deal you booked.'
              : 'No payouts in this range.'}
          </p>
        </div>
      ) : (
        <div className="scrollbar-thin" style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: PAYOUT_ROW_HEIGHT * 5, overflowY: 'auto' }}>
          {scopedPayouts.map(p => {
            const biz = p.appointment?.lead?.business_name || 'Closed deal'
            const dealValueCents = p.deal_value_cents ?? (p.amount_cents * 10)
            const dealDollars = Math.round(dealValueCents / 100).toLocaleString()
            const cutDollars = Math.round(p.amount_cents / 100).toLocaleString()
            const isPaid = p.status === 'paid'
            const fmtDate = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            // Paid rows show both dates so you can see how long the deal sat
            // before payout; pending rows only have a close date so far.
            const dateLabel = isPaid && p.paid_at
              ? `Closed on ${fmtDate(payoutClosedDate(p))} · Paid on ${fmtDate(p.paid_at)}`
              : `Closed on ${fmtDate(payoutClosedDate(p))}`
            return (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '10px 4px', borderBottom: '0.5px solid var(--border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {biz}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    Closed ${dealDollars} · 10% · ${cutDollars} earned
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                    {dateLabel}
                  </p>
                </div>
                <StatusChip status={p.status} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
