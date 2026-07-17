import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { Phone, PhoneCall, Target, BarChart2, Check, AlarmClock, X, Search } from 'lucide-react'
import { useMyLeads } from '../../hooks/useLeads'
import { useTodayCallStats } from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import { useTrainingProgress, isTrainingComplete } from '../../hooks/useTraining'
import { CallModal } from '../../components/rep/CallModal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { KPICard } from '../../components/ui/KPICard'
import { LiveClock } from '../../components/ui/LiveClock'

const STATUS_FILTERS = ['New', 'Appointment Booked', 'Follow-Up', 'No Answer', 'Not Interested', 'All']

// Tab underline/label color per status — mirrors Badge.jsx STATUS_STYLES colors.
const TAB_COLORS = {
  'New':                'var(--info)',
  'Appointment Booked': 'var(--success)',
  'Follow-Up':          'var(--warning)',
  'No Answer':          '#94A3B8',
  'Not Interested':     'var(--danger)',
  'All':                'var(--accent)',
}

// sessionStorage keys — preserve view state across tab switches
const SS_FILTER = 'ohvara_myleads_filter'
const SS_SCROLL = 'ohvara_myleads_scroll'

// Batch progress computed from leads data (the three KPI counters come
// from useTodayCallStats — calls-table based, resets at UTC midnight)
function computeKPIs(leads) {
  if (!leads) return { called: 0, total: 0 }
  const total  = leads.length
  const called = leads.filter(l => l.status !== 'New').length
  return { called, total }
}

// Count of the rep's leads with status Follow-Up whose follow_up_at lands on
// today (local calendar day). Computed from the already-loaded batch so it
// stays live with the row countdowns — no extra query. Drives the
// "Follow-Ups Due Today" stat card.
function countFollowUpsDueToday(leads, nowMs) {
  if (!leads) return 0
  const now = new Date(nowMs)
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  return leads.filter(l => {
    if (l.status !== 'Follow-Up' || !l.follow_up_at) return false
    const f = new Date(l.follow_up_at)
    return !isNaN(f) && f.getFullYear() === y && f.getMonth() === m && f.getDate() === d
  }).length
}

// Short date+time for booked appointments shown in the status column
function formatAppointment(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// How long until a follow-up is due — drives the row countdown. Coarse on
// purpose (minutes/hours/days); seconds only inside the final minute.
function formatCountdown(due, now) {
  const ms = due - now
  if (ms <= 0) return 'now'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `in ${d}d ${h}h`
  if (h > 0) return `in ${h}h ${m}m`
  if (m > 0) return `in ${m}m`
  return `in ${s}s`
}

// Reminder fires this long before a follow-up's due time.
const FOLLOW_UP_REMIND_MS = 5 * 60 * 1000

// Individual lead — desktop renders as a table row, below `md` as a stacked
// card (business name anchors it, status is immediately visible, secondary
// fields sit in a muted two-column grid, Call Now is a full-width tap target).
// Clicking anywhere (either layout) opens the Call Now modal.
// `now` (epoch ms, ticked by the parent) drives the live follow-up countdown.
function LeadRow({ lead, onOpen, now, animDelay = 0 }) {
  const followUpDue = lead.status === 'Follow-Up' && lead.follow_up_at
    ? new Date(lead.follow_up_at).getTime()
    : null
  const followUpOrContactLine = followUpDue ? (
    <p style={{
      fontSize: 11, color: 'var(--warning)', fontWeight: 500, marginTop: 2,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {followUpDue > now
        ? `⏳ Follow-up ${formatCountdown(followUpDue, now)}`
        : '📅 Follow-up due now'}
      {lead.follow_up_notes ? ` — ${lead.follow_up_notes}` : ''}
    </p>
  ) : lead.contact_name ? (
    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {lead.contact_name}
    </p>
  ) : null
  const appointmentLine = lead.status === 'Appointment Booked' && lead.appointment_at ? (
    <p style={{
      fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--success)',
      margin: '3px 0 0', whiteSpace: 'nowrap',
    }}>
      {formatAppointment(lead.appointment_at)}
    </p>
  ) : null

  return (
    <div
      className="table-row-animated"
      onClick={() => onOpen(lead)}
      style={{
        borderBottom: '0.5px solid var(--border)',
        background: 'transparent',
        transition: 'background-color 100ms',
        cursor: 'pointer',
        animationDelay: `${animDelay}ms`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Desktop table row — unchanged at md+ */}
      <div className="hidden md:flex" style={{ alignItems: 'center', gap: 0 }}>
        {/* Business name + contact (or returned-follow-up flag) */}
        <div style={{ flex: '1 1 0', minWidth: 0, padding: '12px 16px', minHeight: 44 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
            {lead.business_name}
          </p>
          {followUpOrContactLine}
        </div>

        {/* Niche */}
        <div style={{ flex: '0 0 120px', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
          {lead.niche || '—'}
        </div>

        {/* City */}
        <div style={{ flex: '0 0 100px', padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
          {lead.city || '—'}
        </div>

        {/* Phone */}
        <div style={{ flex: '0 0 130px', padding: '12px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minHeight: 44 }}>
          {lead.phone || '—'}
        </div>

        {/* Status — booked leads also show the scheduled appointment time */}
        <div style={{ flex: '0 0 110px', padding: '12px 8px', minHeight: 44 }}>
          <Badge label={lead.status} />
          {appointmentLine}
        </div>

        {/* Actions */}
        <div style={{ flex: '0 0 120px', padding: '8px 16px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 }}>
          <button
            className="btn-call"
            onClick={e => { e.stopPropagation(); onOpen(lead) }}
          >
            <Phone size={11} />
            Call Now
          </button>
        </div>
      </div>

      {/* Mobile card — below md */}
      <div className="flex md:hidden" style={{ flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
        {/* Business name anchors the card; status badge stays immediately visible */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
              {lead.business_name}
            </p>
            {followUpOrContactLine}
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <Badge label={lead.status} />
            {appointmentLine}
          </div>
        </div>

        {/* Secondary fields — muted two-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.niche || '—'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.city || '—'}
          </div>
          <div style={{ gridColumn: '1 / -1', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.phone || '—'}
          </div>
        </div>

        {/* Call Now — full-width tap target, one tap away */}
        <button
          className="btn-call"
          onClick={e => { e.stopPropagation(); onOpen(lead) }}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <Phone size={11} />
          Call Now
        </button>
      </div>
    </div>
  )
}

// Real padlock rendered as a cutout — a translucent shade with the lock
// shape punched transparent through it, rather than a solid icon sitting on
// top (Prompt 296: the old dashed-circle + phone-handset icon didn't read as
// a lock at all).
//
// Prompt 297 made this a full-area veil that scaled to cover its parent at
// any aspect ratio (`preserveAspectRatio="xMidYMid slice"`) — Brayden found
// it read as two overlapping locks (the veil plus Prompt 283's separate low-
// opacity watermark Lock icon, which was never removed and sat behind it —
// deleted in Prompt 300) and asked for one smaller, precisely centered lock
// instead of a dynamically-scaled full-bleed one. Prompt 300 rebuilt the
// lock hand-drawn at a fixed pixel size but, in the process, also shrank the
// whole veil down to just the lock's own small bounding box, losing the
// full-area black shade Brayden wanted kept. Prompt 301: keep the fixed,
// undistorted lock geometry, but render the shade full-bleed again (own
// viewBox-less SVG at 100%/100%) with the fixed-size lock cutout centered
// inside it via a nested viewport (percentage x/y + a -50%/-50% pixel
// offset), so the cutout's pixel size never changes but the shade always
// covers the whole locked content area regardless of the parent's size.
// Prompt 302: the body/base rectangle grows into a real card (wide enough
// for the heading to sit on one line, tall enough to hold the heading AND
// the button stacked inside it) — shackle scaled up proportionally to sit
// on top of it. Also root-caused "Go to Training Center" doing nothing:
// the veil's outer <svg> is `position:absolute, inset:0` covering the
// whole locked-content box (same box the button sits in) with no
// `pointer-events:none` — masked-out (transparent) regions of an SVG are
// still hit-tested as "painted" by default, so the veil silently ate every
// click over the button's area even though nothing was visible there.
// Prompt 306: 302's 260×104 body (~2.5:1 wide rectangle) with a thin
// radius-36 shackle no longer read as a padlock ("funky"/"wonky" per
// Brayden). Body is now a true square, shackle span ~53% of the body's
// width (a normal padlock's shackle-to-body ratio) with a thicker stroke
// to match the larger scale — kept large overall (grown, not shrunk) per
// Brayden's explicit "keep the lock the same scale, make it larger" ask.
// The body's generous size leaves the heading+button vertically centered
// with visible padding above/below rather than packed edge-to-edge —
// intentional, since a square tall enough to comfortably hold both at a
// legible size is necessarily taller than the content strictly needs.
// Prompt 307: 306's shackle legs stopped exactly at the body's top edge —
// the stroke's round end-cap only buried ~13px (half the 26px stroke
// width) into the body, so the arch read as a separate piece perched on
// top rather than fused into it. Legs now plunge SHACKLE_OVERLAP (60px,
// well past the cap radius and the body's own corner curvature) below the
// top edge, so the union of shackle-stroke + body-rect is dominated by
// the body's straight silhouette right at the seam — no visible notch or
// gap, single continuous padlock outline, matching the reference image.
const LOCK_BODY = { left: 20, top: 145, width: 300, height: 300 }
const SHACKLE_R = 80
const SHACKLE_LEG = 45
const SHACKLE_OVERLAP = 60
const SHACKLE_CX = LOCK_BODY.left + LOCK_BODY.width / 2
const SHACKLE_LEG_BOTTOM = LOCK_BODY.top + SHACKLE_OVERLAP
const SHACKLE_PATH = `M${SHACKLE_CX - SHACKLE_R} ${SHACKLE_LEG_BOTTOM} V${LOCK_BODY.top - SHACKLE_LEG} a${SHACKLE_R} ${SHACKLE_R} 0 0 1 ${SHACKLE_R * 2} 0 V${SHACKLE_LEG_BOTTOM}`
// Overall local box: body width + left/right margin; body height + the
// shackle's own space above it + top/bottom margins.
const LOCK_W = LOCK_BODY.left * 2 + LOCK_BODY.width
const LOCK_H = LOCK_BODY.top + LOCK_BODY.height + 20

function LockedVeil() {
  return (
    <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, display: 'block', pointerEvents: 'none' }}>
      <mask id="myleads-lock-veil-cutout">
        <rect x="0" y="0" width="100%" height="100%" fill="white" />
        <svg x="50%" y="50%" width={LOCK_W} height={LOCK_H} style={{ transform: `translate(${-LOCK_W / 2}px, ${-LOCK_H / 2}px)` }}>
          <rect x={LOCK_BODY.left} y={LOCK_BODY.top} width={LOCK_BODY.width} height={LOCK_BODY.height} rx={20} fill="black" />
          <path d={SHACKLE_PATH} fill="none" stroke="black" strokeWidth={26} strokeLinecap="round" />
        </svg>
      </mask>
      <rect x="0" y="0" width="100%" height="100%" rx={14} fill="rgba(0,0,0,0.55)" mask="url(#myleads-lock-veil-cutout)" />
    </svg>
  )
}

export default function MyLeads() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { data: rawLeads, isLoading: rawLoading } = useMyLeads()
  const { data: rawCallStats } = useTodayCallStats(profile?.id)
  const { data: training, isLoading: trainingLoading } = useTrainingProgress()
  // Onboarding gate: leads stay locked until videos + quiz + roleplay pass.
  // Reps ARE actually assigned a batch in the DB regardless of training
  // status (assign_daily_batches has no training filter) — this page just
  // renders as if there's nothing there yet, rather than a separate
  // blocking card (Prompt 283), so a locked rep sees the exact page shape
  // they'll see once unlocked.
  const locked = !trainingLoading && !isTrainingComplete(training)
  const leads = locked ? [] : rawLeads
  const isLoading = locked ? false : rawLoading
  const callStats = locked ? null : rawCallStats
  // Filter + scroll position survive tab switches via sessionStorage
  const [activeFilter, setActiveFilter] = useState(() => sessionStorage.getItem(SS_FILTER) || 'New')
  const [search, setSearch] = useState('')
  const [callLead, setCallLead] = useState(null)
  const [reminderLead, setReminderLead] = useState(null)
  const [dayComplete, setDayComplete] = useState(false)
  const remindedRef = useRef(new Set())
  const scrollRef = useRef(null)
  const scrollRestored = useRef(false)

  // Ticks the follow-up countdowns + drives the reminder check. 15s keeps the
  // list cheap while firing the reminder within 15s of the 5-min mark.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  // Follow-up reminder: pop up ~5 min before a Follow-Up lead's due time.
  // DEFERRED while the call modal is open (mid-call) or another reminder is
  // showing — the effect bails, so the next tick fires it the moment the rep
  // closes the modal (as long as the due time hasn't passed). Each lead
  // reminds once (remindedRef), so dismiss doesn't re-trigger.
  useEffect(() => {
    if (callLead || reminderLead || !leads) return
    const candidate = leads.find(l => {
      if (l.status !== 'Follow-Up' || !l.follow_up_at) return false
      if (remindedRef.current.has(l.id)) return false
      const due = new Date(l.follow_up_at).getTime()
      return now >= due - FOLLOW_UP_REMIND_MS && now < due
    })
    if (candidate) {
      remindedRef.current.add(candidate.id)
      setReminderLead(candidate)
    }
  }, [now, callLead, reminderLead, leads])

  function changeFilter(f) {
    setActiveFilter(f)
    sessionStorage.setItem(SS_FILTER, f)
  }

  // Restore the table's scroll position once leads have rendered
  useEffect(() => {
    if (isLoading || scrollRestored.current || !scrollRef.current) return
    const saved = Number(sessionStorage.getItem(SS_SCROLL) || 0)
    if (saved > 0) scrollRef.current.scrollTop = saved
    scrollRestored.current = true
  }, [isLoading])

  const kpis = useMemo(() => computeKPIs(leads), [leads])
  const newCount = useMemo(() => leads ? leads.filter(l => l.status === 'New').length : null, [leads])
  // Recompute on each `now` tick so the count rolls over with the day / as
  // follow-ups come due alongside the row countdowns.
  const followUpsDueToday = useMemo(() => countFollowUpsDueToday(leads, now), [leads, now])

  const filtered = useMemo(() => {
    if (!leads) return []
    let list = activeFilter === 'All' ? leads : leads.filter(l => l.status === activeFilter)
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length) {
      list = list.filter(l => {
        const haystack = [l.business_name, l.contact_name, l.phone, l.city, l.niche]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return tokens.every(t => haystack.includes(t))
      })
    }
    return list
  }, [leads, activeFilter, search])

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  // Avoid a flash of the locked shell before we know the real gate state.
  if (trainingLoading) return null

  return (
    // Page fills the viewport (parent <main> has 24px padding); the leads
    // table scrolls internally instead of the whole page.
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Top bar — stacks on mobile so the date/clock never has to squeeze
          next to the title and wrap (Prompt 295) */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            My Leads
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Today's batch · <span style={{ fontFamily: 'var(--font-mono)' }}>{kpis.total}</span> leads assigned
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {today}
          </span>
          {profile?.timezone_confirmed_at ? (
            <LiveClock timezone={profile?.timezone} />
          ) : (
            <Link
              to="/settings#regional"
              style={{
                fontSize: 12, fontWeight: 500, color: 'var(--accent)',
                background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
                borderRadius: 20, padding: '4px 12px', textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Select Time Zone and Settings
            </Link>
          )}
        </div>
      </div>

      {/* KPI row — counters come from the calls table (UTC day) so all
          three reset together at midnight UTC, same clock as the batch cron.
          Mobile: 2x2 grid; desktop: original flex row. */}
      <div className="stagger kpi-grid" style={{ gap: 12, marginBottom: 20 }}>
        <KPICard
          label="Calls Today"
          value={callStats?.calls ?? 0}
          sub={`${Math.max(kpis.total - kpis.called, 0)} leads remaining`}
          icon={PhoneCall}
        />
        <KPICard
          label="Booked Today"
          value={callStats?.booked ?? 0}
          sub={(callStats?.booked ?? 0) > 0 ? 'Great work!' : 'Keep dialing'}
          subColor={(callStats?.booked ?? 0) > 0 ? 'var(--success)' : undefined}
          accent={(callStats?.booked ?? 0) > 0}
          icon={Target}
        />
        <KPICard
          label="Booking Rate"
          value={callStats?.bookingRate ?? 0}
          suffix="%"
          sub={(callStats?.bookingRate ?? 0) >= 10 ? 'Above target' : (callStats?.bookingRate ?? 0) >= 5 ? 'Near target' : 'Below target'}
          subColor={(callStats?.bookingRate ?? 0) >= 10 ? 'var(--success)' : (callStats?.bookingRate ?? 0) >= 5 ? 'var(--warning)' : 'var(--danger)'}
          icon={BarChart2}
        />
        <KPICard
          label="Follow-Ups Due Today"
          value={followUpsDueToday}
          sub={followUpsDueToday > 0 ? 'Callbacks scheduled for today' : 'None due today'}
          subColor={followUpsDueToday > 0 ? 'var(--warning)' : undefined}
          icon={AlarmClock}
        />
      </div>

      {/* Daily progress bar */}
      {leads && leads.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 8,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 16,
        }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((kpis.called / Math.max(leads.length, 1)) * 100, 100)}%`,
              background: kpis.called >= leads.length ? 'var(--success)' : 'var(--accent)',
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {kpis.called} / {leads.length}
          </div>
          {kpis.called >= leads.length && (
            <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 500 }}>Batch complete!</span>
          )}
        </div>
      )}

      {/* Status filter row — underline tabs + search input. Stacks on mobile
          (Prompt 295) — a fixed-width search box was squeezing the tabs down
          to 1-2 visible before they ran out of room; full-width rows for
          both fixes that without needing a separate overflow pattern. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3" style={{ marginBottom: 16 }}>
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '0.5px solid var(--border)',
        overflowX: 'auto',
        flex: 1,
        minWidth: 0,
      }}>
        {STATUS_FILTERS.map(f => {
          const count = f !== 'All' && leads ? leads.filter(l => l.status === f).length : null
          const isActive = activeFilter === f
          const tabColor = TAB_COLORS[f] || 'var(--accent)'
          return (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              style={{
                height: 36,
                padding: '0 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${tabColor}` : '2px solid transparent',
                marginBottom: -0.5,
                color: tabColor,
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                whiteSpace: 'nowrap',
                transition: 'all 0.1s',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {f}
              {count !== null && count > 0 && (
                <span style={{
                  fontSize: 10,
                  background: 'var(--bg-elevated)',
                  color: tabColor,
                  padding: '1px 5px',
                  borderRadius: 3,
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
        <div className="relative flex-shrink-0 w-full sm:w-[200px]">
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads"
            className="w-full"
            style={{
              height: 32, padding: '0 10px 0 28px',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 8, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Table — glass surface, scrolls internally */}
      <div className="glass" style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Table header — desktop only; cards below md are self-labeling */}
        <div className="hidden md:flex" style={{
          alignItems: 'center',
          borderBottom: '0.5px solid var(--border)',
          padding: '0',
          background: 'var(--bg-elevated)',
          flexShrink: 0,
        }}>
          <div style={{ flex: '1 1 0', padding: '8px 16px' }} className="section-label">Business</div>
          <div style={{ flex: '0 0 120px', padding: '8px 8px' }} className="section-label">Niche</div>
          <div style={{ flex: '0 0 100px', padding: '8px 8px' }} className="section-label">City</div>
          <div style={{ flex: '0 0 130px', padding: '8px 8px' }} className="section-label">Phone</div>
          <div style={{ flex: '0 0 110px', padding: '8px 8px' }} className="section-label">Status</div>
          <div style={{ flex: '0 0 120px', padding: '8px 16px 8px 0', textAlign: 'right' }} className="section-label">Action</div>
        </div>

        {/* Rows — internal scroll; position persisted to sessionStorage */}
        <div
          ref={scrollRef}
          className="scrollbar-thin"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
          onScroll={e => sessionStorage.setItem(SS_SCROLL, String(e.currentTarget.scrollTop))}
        >
        {isLoading ? (
          <div>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ height: 48, borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface)' }}>
                <div style={{ margin: '12px 16px', height: 14, width: `${40 + (i % 4) * 15}%`, background: 'var(--bg-elevated)', borderRadius: 4, animation: 'pulse 2s infinite' }} />
              </div>
            ))}
          </div>
        ) : !filtered.length ? (
          // Complete Day state: all leads actioned, New tab is empty
          newCount === 0 && kpis.total > 0 && activeFilter === 'New' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', textAlign: 'center' }}>
              {dayComplete ? (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--success)', margin: '0 0 6px' }}>Day complete!</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Your batch resets overnight. See you tomorrow.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(34,197,94,0.12)', border: '0.5px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                    <Check size={20} color="var(--success)" />
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>
                    All {kpis.total} leads worked
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px' }}>
                    Nothing left in New — tap to confirm your day is done.
                  </p>
                  <button
                    onClick={() => setDayComplete(true)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      height: 40, padding: '0 24px',
                      background: 'var(--success)', borderRadius: 10, border: 'none',
                      fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
                    }}
                  >
                    <Check size={15} />
                    Complete Day
                  </button>
                </>
              )}
            </div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, padding: locked ? '24px 16px' : '48px 16px', textAlign: 'center', position: 'relative' }}>
            {locked ? (
              <>
                {/* Full-area shade with a single, fixed-size centered lock
                    cutout — full coverage kept from Prompt 301. Prompt 302:
                    the body is now a real card that holds BOTH the heading
                    (one line) and the button stacked inside its own bounds,
                    instead of the button living below the lock in normal
                    flow. Veil has pointer-events:none (Prompt 302 fix) so
                    it no longer swallows clicks meant for the button. */}
                <LockedVeil />
                <div style={{
                  position: 'absolute',
                  left: `calc(50% - ${LOCK_W / 2 - LOCK_BODY.left}px)`,
                  top: `calc(50% - ${LOCK_H / 2 - LOCK_BODY.top}px)`,
                  width: LOCK_BODY.width, height: LOCK_BODY.height,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                  padding: '0 16px',
                }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', lineHeight: 1.3, margin: 0, whiteSpace: 'nowrap' }}>
                    Complete Training to Unlock Your Leads
                  </p>
                  <Button onClick={() => navigate('/setter/training')}>
                    Go to Training Center
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <Phone size={18} color="var(--text-muted)" />
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
                  {activeFilter === 'All' ? 'No leads assigned today' : `No ${activeFilter} leads`}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {activeFilter === 'All' ? 'Check back after the nightly batch runs.' : 'Try a different filter.'}
                </p>
              </>
            )}
          </div>
          )
        ) : (
          filtered.map((lead, i) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              onOpen={setCallLead}
              now={now}
              animDelay={Math.min(i, 20) * 30}
            />
          ))
        )}
        </div>
      </div>

      {/* Row count */}
      {filtered.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
          Showing {filtered.length} of {leads?.length ?? 0} leads
        </p>
      )}

      {/* Call Now modal — opened by row click or the Call Now button */}
      {callLead && (
        <CallModal
          lead={callLead}
          onClose={() => setCallLead(null)}
        />
      )}

      {/* Follow-up reminder — fires ~5 min before due, only when no call is in
          progress (the effect defers it while the modal is open) */}
      {reminderLead && !callLead && (
        <FollowUpReminder
          lead={reminderLead}
          now={now}
          onCall={() => { setCallLead(reminderLead); setReminderLead(null) }}
          onDismiss={() => setReminderLead(null)}
        />
      )}
    </div>
  )
}

// Toast-style reminder that a follow-up is coming due. Portaled to body so a
// transformed ancestor can't clip its fixed position (same reason CallModal
// portals). "Call now" hands the lead to the Call Now modal.
function FollowUpReminder({ lead, now, onCall, onDismiss }) {
  const due = lead.follow_up_at ? new Date(lead.follow_up_at).getTime() : null
  return createPortal(
    <div style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 1100,
      width: 320, maxWidth: 'calc(100vw - 40px)',
      background: '#0E0E1A', border: '0.5px solid var(--warning)',
      borderRadius: 12, padding: '14px 16px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: 'rgba(245,158,11,0.12)', border: '0.5px solid rgba(245,158,11,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlarmClock size={16} color="var(--warning)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Follow-up {due ? formatCountdown(due, now) : 'due'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.business_name}
          </p>
          {lead.follow_up_notes && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>
              {lead.follow_up_notes}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={onCall}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '6px 14px', borderRadius: 7, border: 'none',
                background: 'var(--accent)', color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >
              <Phone size={12} /> Call now
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: '6px 12px', borderRadius: 7,
                background: 'transparent', border: '0.5px solid var(--border)',
                color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, flexShrink: 0 }}
        >
          <X size={15} />
        </button>
      </div>
    </div>,
    document.body
  )
}
