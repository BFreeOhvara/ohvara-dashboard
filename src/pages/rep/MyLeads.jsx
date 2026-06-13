import { useState, useMemo, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Phone, RefreshCw, PhoneCall, Target, BarChart2, List, Lock, Check, GraduationCap } from 'lucide-react'
import { useMyLeads } from '../../hooks/useLeads'
import { useTodayCallStats } from '../../hooks/useProfiles'
import { useAuth } from '../../hooks/useAuth'
import {
  useTrainingProgress, trainingChecks, isTrainingComplete,
  TOTAL_VIDEOS, QUIZ_PASS_PCT, ROLEPLAY_PASS_GRADE,
} from '../../hooks/useTraining'
import { CallModal } from '../../components/rep/CallModal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { KPICard } from '../../components/ui/KPICard'

const STATUS_FILTERS = ['All', 'New', 'Appointment Booked', 'Follow-Up', 'No Answer', 'Not Interested']

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

// Short date+time for booked appointments shown in the status column
function formatAppointment(ts) {
  if (!ts) return null
  const d = new Date(ts)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// A follow-up lead that has come back to the rep's list: follow_up_at has
// arrived and the lead carries the reason the rep recorded. Not a cold call.
function isReturnedFollowUp(lead) {
  return !!(lead.follow_up_at && lead.follow_up_notes && new Date(lead.follow_up_at) <= new Date())
}

// Individual table row — clicking anywhere opens the Call Now modal
function LeadRow({ lead, onOpen, animDelay = 0 }) {
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
        {isReturnedFollowUp(lead) ? (
          <p style={{
            fontSize: 11, color: 'var(--warning)', fontWeight: 500, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            📅 Follow-Up — {lead.follow_up_notes}
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
  const { data: leads, isLoading, refetch } = useMyLeads()
  const { data: callStats } = useTodayCallStats(profile?.id)
  const { data: training, isLoading: trainingLoading } = useTrainingProgress()
  // Filter + scroll position survive tab switches via sessionStorage
  const [activeFilter, setActiveFilter] = useState(() => sessionStorage.getItem(SS_FILTER) || 'All')
  const [callLead, setCallLead] = useState(null)
  const scrollRef = useRef(null)
  const scrollRestored = useRef(false)

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

  const filtered = useMemo(() => {
    if (!leads) return []
    if (activeFilter === 'All') return leads
    return leads.filter(l => l.status === activeFilter)
  }, [leads, activeFilter])

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
            Today's batch · <span style={{ fontFamily: 'var(--font-mono)' }}>150</span> leads assigned
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {today}
          </span>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw size={12} />
            Refresh
          </Button>
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
          label="Batch Total"
          value={callStats?.batchTotal ?? kpis.total}
          sub="Leads assigned today"
          icon={List}
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

      {/* Status filter row — underline tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '0.5px solid var(--border)',
        marginBottom: 16,
        overflowX: 'auto',
      }}>
        {STATUS_FILTERS.map(f => {
          const count = f !== 'All' && leads ? leads.filter(l => l.status === f).length : null
          const isActive = activeFilter === f
          return (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              style={{
                height: 36,
                padding: '0 12px',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -0.5,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13,
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
                  color: isActive ? 'var(--accent)' : 'var(--text-dim)',
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', textAlign: 'center' }}>
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
        ) : (
          filtered.map((lead, i) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              onOpen={setCallLead}
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
    </div>
  )
}
