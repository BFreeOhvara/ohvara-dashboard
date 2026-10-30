import { useNavigate } from 'react-router-dom'
import { CalendarPlus, PhoneMissed, Phone, ChevronRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useWeeklyUsage } from '../../../hooks/useBillingTiers'
import { capState, formatReset } from '../../../lib/billing'
import { agentStageOf } from '../../../lib/agentBookings'
import { fullName } from '../../../lib/policyFormat'
import { timeText } from '../../../lib/fulfillmentDay'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'
import { NotificationBell } from '../../notifications/NotificationBell'
import { Avatar } from '../../ui/Avatar'
import { LiveDot } from '../../ui/LiveDot'
import { LoadError } from '../AgentUI'
import { StartInboundsCard } from '../billing/StartInboundsCard'
import { dayTile, untilText } from './phoneBits'

// Prompt 772 — the agent's Home on a phone (mockup Main.dc.html): date chip,
// bell (full screen) and avatar (to More); greeting; the bookings ring with
// Book a call; Needs you (the desktop's Needs attention items); Up next as a
// list with the next call highlighted; Booked / Cancelled this week. Every
// number comes from the Overview's own data (`g`), so the two can't disagree.

const NEED_LOOK = {
  confirmNumber: { icon: PhoneMissed, color: 'var(--ov-st-needs)', tint: 'var(--ov-st-needs-tint)', title: n => `${n} didn’t answer`, sub: 'Confirm the number so we can try again' },
  needsAttention: { icon: Phone, color: 'var(--nt-purple)', tint: 'var(--nt-purple-tint)', title: n => `Couldn’t reach ${n}`, sub: 'They’re yours to call and rebook' },
}
const NEEDS_SHOWN = 4
const NEXT_SHOWN = 3

function Ring({ used, cap }) {
  const r = 33
  const len = 2 * Math.PI * r
  const part = cap ? Math.min(1, used / cap) : used > 0 ? 1 : 0
  return (
    <span className="ph-ring">
      <svg width="78" height="78" viewBox="0 0 78 78" aria-hidden="true">
        <circle cx="39" cy="39" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="8" />
        {part > 0 && (
          <circle cx="39" cy="39" r={r} fill="none" stroke="#34E0C4" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${len * part} ${len}`} transform="rotate(-90 39 39)" />
        )}
      </svg>
      <span className="ph-ring-mid">
        <b>{used ?? '—'}</b>
        <small>{cap != null ? `of ${cap}` : 'booked'}</small>
      </span>
    </span>
  )
}

export function PhoneHome({ g, greeting, sub, isLoading, isError, refetch, now, tz }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { data: usage, isLoading: usageLoading } = useWeeklyUsage(profile?.id)
  const cap = capState(usage)
  const zone = tz || DEFAULT_TIMEZONE
  const chip = new Date(now).toLocaleDateString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' })
  const open = p => navigate(`/agent/clients?open=${p.id}`)

  const ringLine = usageLoading || !cap ? '—'
    : cap.cap == null ? 'No weekly limit'
      : cap.atCap ? 'Limit reached' : `${cap.left} left`
  const ringSub = [usage?.tier_name, `resets ${formatReset(usage?.week_end, profile?.timezone)}`].filter(Boolean).join(' · ')

  const needs = g.attention
  const next = g.upcoming.slice(0, NEXT_SHOWN)
  const cancelledPct = !isLoading && g.booked.value > 0 ? `${Math.round((g.cancelled.value / g.booked.value) * 100)}% of booked` : null
  const diffText = d => (d == null ? null : d > 0 ? `+${d} vs last week` : d < 0 ? `${d} vs last week` : 'Same as last week')

  return (
    <div className="ph-stack">
      <div className="ph-top">
        <span className="ph-chip"><span className="ph-chip-dot" aria-hidden="true" />{chip}</span>
        <span style={{ flex: 1 }} />
        {profile?.id && <NotificationBell profileId={profile.id} full />}
        <button type="button" className="ph-avatar" onClick={() => navigate('/agent/more')} aria-label="Your account">
          <Avatar profile={profile} size={44} />
        </button>
      </div>

      <div>
        <h1 className="ph-h1" style={{ fontSize: 31, letterSpacing: '-0.035em' }}>{greeting}</h1>
        <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--ov-soft)' }}>{sub}</p>
      </div>

      {isError && <LoadError what="your calls" onRetry={() => refetch()} />}

      {g.live.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16,
          background: 'var(--danger-dim)', border: 'var(--border-w) solid var(--danger-bd)', color: 'var(--danger)',
        }}>
          <LiveDot size={10} />
          <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>
            Fulfillment is on a call with {g.live.map(fullName).join(', ')} right now.
          </p>
        </div>
      )}

      <section className="ov-hero ph-ringcard" style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Ring used={usageLoading ? null : cap?.used ?? 0} cap={cap?.cap ?? null} />
          <span style={{ flex: 1, minWidth: 0, color: '#FFFFFF' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Bookings this week</span>
            <span style={{ display: 'block', marginTop: 3, fontFamily: 'var(--font-display)', fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>{ringLine}</span>
            {!usageLoading && <span style={{ display: 'block', marginTop: 2, fontSize: 12.5, color: 'var(--ov-hero-soft)' }}>{ringSub}</span>}
          </span>
        </div>
        <button type="button" className="ov-hero-btn ph-bookbtn" onClick={() => navigate('/agent/book')}>
          <CalendarPlus size={18} strokeWidth={2.2} aria-hidden="true" />Book a call
        </button>
      </section>

      {(isLoading || needs.length > 0) && (
        <section aria-labelledby="ph-needs">
          <div className="ph-sechead">
            <h2 id="ph-needs" className="ph-h2">Needs you</h2>
            {!isLoading && <span className="ph-count">{needs.length}</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="ph-seclink" onClick={() => navigate('/agent/clients?stage=needs')}>See all</button>
          </div>
          <div className="ov-card ph-card">
            {isLoading ? <div className="ph-empty">Loading…</div> : needs.slice(0, NEEDS_SHOWN).map(p => {
              const look = NEED_LOOK[agentStageOf(p)] || NEED_LOOK.needsAttention
              const Icon = look.icon
              const name = fullName(p)
              return (
                <button key={p.id} type="button" className="ph-row" onClick={() => navigate(`/agent/clients?open=${p.id}&stage=needs`)}>
                  <span className="ph-tile" style={{ background: look.tint, color: look.color }}><Icon size={18} strokeWidth={2} aria-hidden="true" /></span>
                  <span className="ph-row-main">
                    <span className="ph-row-title">{look.title(name)}</span>
                    <span className="ph-row-sub">{look.sub}</span>
                  </span>
                  <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>
      )}

      <StartInboundsCard />

      <section aria-labelledby="ph-next">
        <div className="ph-sechead">
          <h2 id="ph-next" className="ph-h2">Up next</h2>
          <span style={{ flex: 1 }} />
          {!isLoading && <span className="ph-mute">{g.upcoming.length} booked</span>}
        </div>
        {isLoading ? <div className="ov-card ph-card ph-empty">Loading…</div>
          : next.length === 0 ? (
            <div className="ov-card ph-card ph-empty">Nothing booked yet. Tap + to book a call.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {next.map((p, i) => {
                const ctz = p.client_timezone || zone
                const t = dayTile(p.scheduled_call_at, now, ctz)
                return (
                  <button key={p.id} type="button" className={`ph-next${i === 0 ? ' is-first' : ' ov-card'}`} onClick={() => open(p)}>
                    <span className="ph-daytile"><small>{t.dow}</small><b>{t.d}</b></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ph-row-title" style={{ fontSize: 15 }}>{fullName(p)}</span>
                      <span className="ph-row-sub">{p.current_carrier || p.carrier_name || 'Carrier not noted'}</span>
                    </span>
                    <span style={{ textAlign: 'right', flex: 'none' }}>
                      <span className="ph-next-time">{timeText(p.scheduled_call_at, ctz)}</span>
                      <span className="ph-row-sub">{untilText(p.scheduled_call_at, now, ctz)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
      </section>

      <section className="ph-stats" aria-label="This week">
        <button type="button" className="ov-card ph-stat" onClick={() => navigate('/agent/clients?range=week&stage=all')}>
          <div className="ph-stat-label">Booked this week</div>
          <div className="ph-stat-num">{isLoading ? '—' : g.booked.value}</div>
          {!isLoading && <div className="ph-stat-sub" style={g.booked.diff > 0 ? { color: 'var(--ov-up)' } : undefined}>{diffText(g.booked.diff)}</div>}
        </button>
        <button type="button" className="ov-card ph-stat" onClick={() => navigate('/agent/clients?stage=cancelled')}>
          <div className="ph-stat-label">Cancelled this week</div>
          <div className="ph-stat-num" style={{ color: 'var(--ov-st-cancelled)' }}>{isLoading ? '—' : g.cancelled.value}</div>
          {!isLoading && <div className="ph-stat-sub">{cancelledPct || diffText(g.cancelled.diff)}</div>}
        </button>
      </section>
    </div>
  )
}
