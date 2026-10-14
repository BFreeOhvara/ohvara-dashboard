import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { useCallOutcomes } from '../../hooks/useRepCallEvents'
import { usePayouts } from '../../hooks/useFulfillmentPayouts'
import { usePendingInvites } from '../../hooks/useProfiles'
import { useRecoveryConfig } from '../../hooks/useRecoveryConfig'
import { HeroPanel, IconChip } from '../../components/agent/AgentUI'
import { isLive, useNow } from '../../lib/agentBookings'
import { flagsFor } from '../../lib/fulfillmentFlags'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import { weekFrame, buildCalls, adminWeek } from '../../lib/fulfillmentDay'
import { fmtCents } from '../../lib/payPeriod'
import { roleLabel } from '../../lib/roleLabels'
import { MONO } from '../../lib/exportStyles'

// Admin Overview (Prompt 758), ported from media/admin-redesign/admin-overview.dc.html.
// Five boxes: the hero, two week cards (calls booked, cancelled), "This week,
// day by day", and Needs you on the right. Numbers come from the same
// buildCalls list My calls uses (lib/fulfillmentDay.js adminWeek), across the
// whole company. Needs you lists what waits on the admin: last week's pay not
// approved, calls past their time, invites not accepted, calling / texting
// switched off. View only: nothing here changes a client.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// "3 days ago" / "today" for an ISO timestamp.
function ago(iso, nowMs) {
  const d = Math.floor((nowMs - new Date(iso).getTime()) / 864e5)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

// 7 bars, Mon to Sun: today and earlier at full strength, days to come a 4px stub.
function WeekBars({ counts, todayIdx, color }) {
  const max = Math.max(0, ...counts)
  return (
    <span aria-hidden="true" className="ao-strip">
      {counts.map((c, i) => {
        const future = i > todayIdx
        return (
          <span key={i} style={{
            height: future || !max ? 4 : Math.max(4, Math.round((c / max) * 54)),
            background: color, opacity: future ? 0.3 : 1,
          }} />
        )
      })}
    </span>
  )
}

function StatCard({ label, icon, color, tint, value, chip, week, todayIdx }) {
  return (
    <section className="ov-card ao-stat">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <IconChip icon={icon} color={color} tint={tint} size={38} radius={11} iconSize={19} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>{label}</span>
      </div>
      <div className="ao-stat-foot">
        <div>
          <div className="ao-num">{value}</div>
          {chip && <span className="ao-chip" style={{ background: chip.bg, color: chip.fg }}>{chip.text}</span>}
        </div>
        <WeekBars counts={week} todayIdx={todayIdx} color={color} />
      </div>
    </section>
  )
}

function DayChart({ days, todayIdx, loading }) {
  const booked = days.reduce((s, d) => s + d.booked, 0)
  const cancelled = days.reduce((s, d) => s + d.cancelled, 0)
  const top = Math.max(4, ...days.map(d => Math.max(d.booked, d.cancelled)))
  const h = v => (v ? `${Math.max(2, (v / top) * 100)}%` : 0)
  const range = days.length
    ? `${days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to ${days[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : ''
  const key = (bg, text) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ov-mid)' }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: bg }} />{text}
    </span>
  )
  return (
    <section className="ov-card ao-chart">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <h2 className="ao-h2">This week, day by day</h2>
          <div style={{ marginTop: 3, fontSize: 13, color: 'var(--ov-mute)' }}>Calls booked on the calendar and calls cancelled · {range}</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>{key('var(--ao-booked)', 'Booked')}{key('var(--ao-cancelled)', 'Cancelled')}</div>
      </div>
      <div className="ao-chart-body">
        <div className="ao-totals">
          <div><div className="ao-total">{loading ? '—' : booked}</div><div className="ao-total-l">booked</div></div>
          <div><div className="ao-total" style={{ color: 'var(--ov-up)' }}>{loading ? '—' : cancelled}</div><div className="ao-total-l">cancelled</div></div>
        </div>
        {!loading && booked === 0 && cancelled === 0 ? (
          <div className="ao-plot" style={{ alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--ov-mute)' }}>
            No calls on the calendar this week.
          </div>
        ) : (
        <div className="ao-plot" role="img" aria-label={`This week: ${booked} booked, ${cancelled} cancelled`}>
          {days.map((d, i) => {
            const label = i === todayIdx ? 'Today' : d.date.toLocaleDateString('en-US', { weekday: 'short' })
            return (
              <div key={i} className="ao-day" style={{ opacity: i > todayIdx ? 0.55 : 1 }}
                title={`${d.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}: ${d.booked} booked, ${d.cancelled} cancelled`}>
                <div className="ao-bars">
                  <span className="ao-bar" style={{ height: h(d.booked), background: 'var(--ao-booked)' }} />
                  <span className="ao-bar" style={{ height: h(d.cancelled), background: 'var(--ao-cancelled)' }} />
                </div>
                <span style={{ fontSize: 12.5, fontWeight: i === todayIdx ? 700 : 500, color: i === todayIdx ? 'var(--ov-hi)' : 'var(--ov-mute)' }}>{label}</span>
              </div>
            )
          })}
        </div>
        )}
      </div>
    </section>
  )
}

// One thing waiting on the admin. tone: warn (amber), info (blue), mute (grey).
function NeedRow({ n, onGo }) {
  return (
    <button type="button" className={`ao-need is-${n.tone}`} onClick={onGo}>
      <span className="ao-need-dot" aria-hidden="true" />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ov-hi)' }}>{n.title}</span>
        <span style={{ display: 'block', marginTop: 1, fontSize: 12.5, color: 'var(--ov-mute)' }}>{n.sub}</span>
      </span>
      <span className="ao-need-act">{n.action}</span>
    </button>
  )
}

export default function AdminOverview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const needsRef = useRef(null)
  const tz = profile?.timezone || DEFAULT_TIMEZONE

  const { data: queue = [], isLoading: queueLoading } = useFulfillmentQueue()
  const anyLive = queue.some(isLive)
  const todayStr = zonedDateStr(now, tz)
  const frame = useMemo(() => weekFrame(todayStr, tz), [todayStr, tz])
  const { data: events = [], isLoading: eventsLoading } = useCallOutcomes(
    new Date(frame.sinceMs).toISOString(), new Date(frame.bounds[14]).toISOString(), { live: anyLive },
  )
  const { data: payouts = [], isLoading: payLoading } = usePayouts(null)
  const { data: invites = [], isLoading: invitesLoading } = usePendingInvites()
  const { data: config, isLoading: configLoading } = useRecoveryConfig()

  const week = useMemo(() => adminWeek(
    frame, buildCalls(queue, now, tz, { from: frame.dates[0], to: frame.dates[13], events }),
  ), [frame, queue, events, now, tz])

  const chartLoading = queueLoading || eventsLoading || !profile
  const needsLoading = queueLoading || payLoading || invitesLoading || configLoading || !profile

  const needs = useMemo(() => {
    const out = []
    // Last week's pay: weeks that ended, not approved yet, with something to pay.
    const owed = payouts.filter(p => p.period_start === frame.dates[0] && p.status === 'upcoming' && p.amount_cents > 0)
    if (owed.length) {
      const total = owed.reduce((s, p) => s + p.amount_cents, 0)
      out.push({
        key: 'pay', tone: 'warn', action: 'Review', to: '/admin/payouts',
        title: 'Approve last week’s pay',
        sub: <>{owed.length === 1 ? '1 person' : `${owed.length} people`} · <span style={{ fontFamily: MONO }}>{fmtCents(total)}</span></>,
      })
    }
    const nowDate = new Date(now)
    const late = queue.filter(p => flagsFor(p, nowDate).overdue).length
    if (late) {
      out.push({
        key: 'late', tone: 'warn', action: 'View', to: '/admin/fulfillment',
        title: `${plural(late, 'call')} past their time`, sub: 'Not started yet · Fulfillment',
      })
    }
    if (invites.length) {
      const oldest = invites[invites.length - 1]
      out.push({
        key: 'invites', tone: 'info', action: 'Users', to: '/admin/users',
        title: `${plural(invites.length, 'invite')} not accepted`,
        sub: invites.length === 1
          ? `${roleLabel(oldest.role)} · sent ${ago(oldest.created_at, now)}`
          : `Oldest sent ${ago(oldest.created_at, now)}`,
      })
    }
    if (config && !config.voice_live) {
      out.push({ key: 'voice', tone: 'mute', action: 'Settings', to: '/settings#contact', title: 'Calling isn’t live yet', sub: 'Switch it on in Settings' })
    }
    if (config && !config.sms_live) {
      out.push({ key: 'sms', tone: 'mute', action: 'Settings', to: '/settings#contact', title: 'Texting isn’t live yet', sub: 'Switch it on in Settings' })
    }
    return out
  }, [payouts, queue, invites, config, frame.dates, now])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`
  const dateLabel = month => new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month, day: 'numeric' })
  const sub = needsLoading ? 'Checking what needs you…'
    : needs.length ? `${needs.length} ${needs.length === 1 ? 'thing needs' : 'things need'} you today.` : 'Nothing needs you today.'

  const seeNeeds = () => {
    needsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    needsRef.current?.focus({ preventScroll: true })
  }
  const dash = v => (chartLoading ? '—' : v)
  const diffChip = d => (d > 0
    ? { text: `${d} more than last week`, bg: 'var(--ov-up-tint)', fg: 'var(--ov-up)' }
    : d < 0 ? { text: `${-d} fewer than last week`, bg: 'var(--ov-stub)', fg: 'var(--ov-mid)' }
      : { text: 'Same as last week', bg: 'var(--ov-stub)', fg: 'var(--ov-mid)' })

  return (
    <div className="ao-page">
      <HeroPanel
        compact greeting={greeting} sub={sub} timezone={tz}
        dateLong={dateLabel('long')} dateShort={dateLabel('short')}
        action={{ label: 'See what needs you', icon: Check, onClick: seeNeeds }}
      />

      <div className="ao-grid">
        <StatCard
          label="Calls booked this week" icon={Phone} color="var(--ov-data-a)" tint="var(--ov-data-a-tint)"
          value={dash(week.booked.value)} chip={chartLoading ? null : diffChip(week.booked.diff)}
          week={week.booked.week} todayIdx={frame.todayIdx}
        />
        <StatCard
          label="Cancelled this week" icon={Check} color="var(--ov-up)" tint="var(--ov-up-tint)"
          value={dash(week.cancelled.value)}
          chip={chartLoading || week.rate == null ? null : { text: `${week.rate}% cancel rate`, bg: 'var(--ov-data-a-tint)', fg: 'var(--ov-data-a)' }}
          week={week.cancelled.week} todayIdx={frame.todayIdx}
        />

        <section ref={needsRef} tabIndex={-1} className="ov-card ao-needs" aria-label="Needs you">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 className="ao-h2">Needs you</h2>
            {!needsLoading && needs.length > 0 && <span className="ao-count">{needs.length}</span>}
          </div>
          <div className="ao-need-list">
            {needsLoading
              ? <p className="ao-empty">Checking…</p>
              : needs.length
                ? needs.map(n => <NeedRow key={n.key} n={n} onGo={() => navigate(n.to)} />)
                : <p className="ao-empty">Nothing needs you right now.</p>}
          </div>
          <button type="button" className="ov-primary" style={{ marginTop: 'auto' }} onClick={() => navigate('/admin/payouts')}>
            Open Payouts
          </button>
        </section>

        <DayChart days={week.days} todayIdx={frame.todayIdx} loading={chartLoading} />
      </div>
    </div>
  )
}
