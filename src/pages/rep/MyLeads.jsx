import { useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Phone, PhoneCall, Target, BarChart2, Lock, Check, GraduationCap, AlarmClock, X, Search } from 'lucide-react'
import { useMyLeads } from '../../hooks/useLeads'
import { useTodayCallStats } from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import {
  useTrainingProgress, trainingChecks, isTrainingComplete,
  TOTAL_VIDEOS, QUIZ_PASS_PCT, ROLEPLAY_PASS_GRADE,
} from '../../hooks/useTraining'
import { CallModal } from '../../components/rep/CallModal'
import { Badge } from '../../components/ui/Badge'
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

// Individual table row — clicking anywhere opens the Call Now modal.
// `now` (epoch ms, ticked by the parent) drives the live follow-up countdown.
function LeadRow({ lead, onOpen, now, animDelay = 0 }) {
  const followUpDue = lead.status === 'Follow-Up' && lead.follow_up_at
    ? new Date(lead.follow_up_at).getTime()
    : null
  return (
    <div
      className="table-row-animated"
      onClick={() => onOpen(lead)}
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '0.5px solid var(--border)',
        background: 'transparent',
        transition: 'background-color 100ms',
        cursor: 'pointer',
        animationDelay: `${animDelay}ms`,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Business name + contact (or returned-follow-up flag) */}
      <div style={{ flex: '1 1 0', minWidth: 0, padding: '12px 16px', minHeight: 44 }}>
        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
          {lead.business_name}
        </p>
        {followUpDue ? (
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
        ) : null}
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
        {lead.status === 'Appointment Booked' && lead.appointment_at && (
          <p style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--success)',
            margin: '3px 0 0', whiteSpace: 'nowrap',
          }}>
            {formatAppointment(lead.appointment_at)}
          </p>
        )}
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
  )
}

// Locked state shown until the rep passes all three training checks.
// Progress lives in training_progress; unlock is automatic the moment
// the last check passes (no admin action, no reload needed).
function TrainingGate({ progress }) {
  const checks = trainingChecks(progress)
  const items = [
    {
      label: 'Watch all training videos',
      detail: `${checks.videosWatched} / ${TOTAL_VIDEOS} watched`,
      done: checks.videosDone,
    },
    {
      label: `Pass the flashcard quiz (${QUIZ_PASS_PCT}%+)`,
      detail: progress?.quiz_score != null
        ? `Best attempt: ${Math.round((progress.quiz_score / (progress.quiz_total || 1)) * 100)}%`
        : 'Not attempted yet',
      done: checks.quizDone,
    },
    {
      label: `Pass the AI roleplay (${ROLEPLAY_PASS_GRADE} or higher)`,
      detail: progress?.roleplay_grade
        ? `Last grade: ${progress.roleplay_grade}`
        : 'Not attempted yet',
      done: checks.roleplayDone,
    },
  ]
  const doneCount = items.filter(i => i.done).length

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 48px)' }}>
      <div className="glass" style={{ maxWidth: 520, width: '100%', borderRadius: 14, padding: '36px 32px', textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, margin: '0 auto 18px',
          background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Lock size={24} color="var(--accent)" />
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 8px', letterSpacing: '-0.01em' }}>
          Complete training to unlock your leads
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 22px' }}>
          Your 150 daily leads are waiting. Pass all three training steps and they unlock automatically.
        </p>

        {/* Overall progress */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${(doneCount / 3) * 100}%`,
              background: doneCount === 3 ? 'var(--success)' : 'var(--accent)',
              borderRadius: 3, transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>
            {doneCount} / 3
          </span>
        </div>

        {/* Checklist */}
        <div style={{ textAlign: 'left', marginBottom: 24 }}>
          {items.map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', marginBottom: 8,
              background: item.done ? 'rgba(34,197,94,0.06)' : 'var(--bg-surface)',
              border: `0.5px solid ${item.done ? 'rgba(34,197,94,0.25)' : 'var(--border)'}`,
              borderRadius: 10,
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                background: item.done ? 'var(--success)' : 'var(--bg-elevated)',
                border: item.done ? 'none' : '0.5px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {item.done && <Check size={12} color="white" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: item.done ? 'var(--success)' : 'var(--text-primary)', margin: 0 }}>
                  {item.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>{item.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <Link
          to="/rep/training"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            height: 42, padding: '0 24px',
            background: 'var(--accent)', borderRadius: 10,
            fontSize: 14, fontWeight: 500, color: 'white', textDecoration: 'none',
          }}
        >
          <GraduationCap size={16} />
          Go to Training Center
        </Link>
      </div>
    </div>
  )
}

export default function MyLeads() {
  const { profile } = useAuth()
  const { data: leads, isLoading } = useMyLeads()
  const { data: callStats } = useTodayCallStats(profile?.id)
  const { data: training, isLoading: trainingLoading } = useTrainingProgress()
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

  // Onboarding gate: leads stay locked until videos + quiz + roleplay pass
  if (trainingLoading) return null
  if (!isTrainingComplete(training)) return <TrainingGate progress={training} />

  return (
    // Page fills the viewport (parent <main> has 24px padding); the leads
    // table scrolls internally instead of the whole page.
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            My Leads
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
            Today's batch · <span style={{ fontFamily: 'var(--font-mono)' }}>{kpis.total}</span> leads assigned
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <LiveClock timezone={profile?.timezone} />
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {today}
          </span>
        </div>
      </div>

      {/* KPI row — counters come from the calls table (UTC day) so all
          three reset together at midnight UTC, same clock as the batch cron */}
      <div className="stagger" style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
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

      {/* Status filter row — underline tabs (left) + search input floated right,
          its own element outside both the tabs box and the table box */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
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
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads"
            style={{
              height: 32, padding: '0 10px 0 28px', width: 200,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 8, fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Table — glass surface, scrolls internally */}
      <div className="glass" style={{ overflow: 'hidden', borderRadius: 10, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Table header */}
        <div style={{
          display: 'flex', alignItems: 'center',
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, padding: '48px 16px', textAlign: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Phone size={18} color="var(--text-muted)" />
            </div>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', margin: 0 }}>
              {activeFilter === 'All' ? 'No leads assigned today' : `No ${activeFilter} leads`}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {activeFilter === 'All' ? 'Check back after the nightly batch runs.' : 'Try a different filter.'}
            </p>
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
