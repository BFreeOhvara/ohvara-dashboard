import { useMemo, useState } from 'react'
import {
  Plus, Trash2, Phone, Bell, FileText, CheckCircle, RotateCcw, XCircle, Clock,
  MessageSquare, UserPlus, UserCheck, Target, Ban, RefreshCw, DollarSign, GraduationCap, Award,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicies } from '../../hooks/usePolicies'
import { useFollowUps, useCreateFollowUp, useDeleteFollowUp } from '../../hooks/useFollowUps'
import { useSentInvites } from '../../hooks/useProfiles'
import { useRecentTeamMessages } from '../../hooks/useTeamChat'
import { Segmented } from '../../components/ui/Segmented'
import { MONO, card, control, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { Field, TextField } from '../../components/ui/ExportForm'
import { fullName, todayISO } from '../../lib/policyFormat'

// My Calls (Prompt 329) — the export's mockup for this page was two
// "Coming soon" tabs (Calls / Activity); Brayden's real spec supersedes it
// with three sections built fresh in the same visual language:
//
//  · Schedule — Cancellation Calls (real, auto-populated from the booking
//    flow already in Submissions) merged with Follow-ups (new, closer-logged
//    CRUD — migration 076).
//  · Activity — a chronological feed derived from real policy fields.
//    There's no separate event-log table; each row is a timestamp the
//    schema already tracks (submitted, effectuation confirmed, cancellation
//    booked/completed), not invented history.
//  · Graded calls — flagged, not spec'd. No call-recording/QA-scoring system
//    exists anywhere in this app yet, so this ships "coming soon" rather
//    than guessing at what "graded" means.

const TABS = [
  { value: 'schedule', label: 'Schedule' },
  { value: 'activity', label: 'Activity' },
  { value: 'graded',   label: 'Graded calls' },
]

// Local calendar date arithmetic (not UTC) matching todayISO()'s own
// local-time convention — same reasoning as AgentOverview.jsx's localISO().
function addDaysLocal(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function dayLabel(dateStr, today) {
  if (dateStr === today) return 'Today'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const arrowBtnStyle = {
  border: 'none', background: 'transparent', padding: 4,
  display: 'inline-flex', color: 'var(--text-secondary)', cursor: 'pointer',
}

// Activity tab's day-stepper (Prompt 367) — same inline prev/next-arrow
// pattern as Performance's Daily mode (ProductionPeriodPicker.jsx's
// PeriodPicker), just without the Daily/Monthly/All Time mode toggle since
// Activity only ever needs a single day, no popover/calendar/custom range.
function ActivityDayStepper({ day, today, onPrev, onNext }) {
  const canNext = day < today
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      border: 'var(--border-w) solid var(--border)', borderRadius: 6, background: 'var(--bg-elevated)',
    }}>
      <button onClick={onPrev} title="Previous day" style={arrowBtnStyle}><ChevronLeft size={14} /></button>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-primary)', minWidth: 92, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {dayLabel(day, today)}
      </span>
      <button
        onClick={onNext}
        disabled={!canNext}
        title="Next day"
        style={{ ...arrowBtnStyle, color: canNext ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: canNext ? 1 : 0.4, cursor: canNext ? 'pointer' : 'default' }}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

export default function MyCalls() {
  const [tab, setTab] = useState('schedule')
  const today = todayISO()
  const [activityDay, setActivityDay] = useState(today)

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Segmented value={tab} onChange={setTab} options={TABS} />
        {tab === 'activity' && (
          <ActivityDayStepper
            day={activityDay}
            today={today}
            onPrev={() => setActivityDay(d => addDaysLocal(d, -1))}
            onNext={() => setActivityDay(d => (d < today ? addDaysLocal(d, 1) : d))}
          />
        )}
      </div>

      {tab === 'schedule' && <Schedule />}
      {tab === 'activity' && <Activity day={activityDay} today={today} />}
      {tab === 'graded'   && <GradedCalls />}
    </div>
  )
}

// ── Schedule ─────────────────────────────────────────────────────────────────
function Schedule() {
  const { profile } = useAuth()
  const { data: policies = [] } = usePolicies(profile?.id)
  const { data: followUps = [] } = useFollowUps(profile?.id)
  const createFollowUp = useCreateFollowUp()
  const deleteFollowUp = useDeleteFollowUp()

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ client_name: '', date: todayISO(), time: '09:00', notes: '' })
  const [error, setError] = useState('')

  const items = useMemo(() => {
    const calls = policies
      .filter(p => p.cancellation_call_at)
      .map(p => ({
        id: `canc-${p.id}`, kind: 'cancellation', at: p.cancellation_call_at,
        name: fullName(p), detail: `3-way call w/ ${p.carrier_name || 'carrier'}`,
        deletable: false,
      }))
    const fus = followUps.map(f => ({
      id: f.id, kind: 'followup', at: f.scheduled_at,
      name: f.client_name, detail: f.notes || 'Follow-up call',
      deletable: true,
    }))
    return [...calls, ...fus].sort((a, b) => a.at.localeCompare(b.at))
  }, [policies, followUps])

  async function submit() {
    setError('')
    if (!form.client_name.trim()) return setError('Enter a client name')
    if (!form.date || !form.time) return setError('Pick a date and time')
    const scheduled_at = new Date(`${form.date}T${form.time}`).toISOString()
    try {
      await createFollowUp.mutateAsync({
        agent_id: profile.id, client_name: form.client_name.trim(),
        scheduled_at, notes: form.notes.trim() || null,
      })
      setForm({ client_name: '', date: todayISO(), time: '09:00', notes: '' })
      setAdding(false)
    } catch (err) {
      setError(err.message || 'Could not save the follow-up')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: adding ? 16 : 0 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Upcoming</p>
            <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
              Cancellation calls booked in Submissions, plus follow-ups you log yourself.
            </p>
          </div>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              style={{ ...primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={13} /> Log follow-up
            </button>
          )}
        </div>

        {adding && (
          <div style={{ padding: '16px 0', borderTop: 'var(--border-w) solid var(--border)', marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
              <TextField label="Client" value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Who are you calling?" />
              <TextField label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} mono />
              <TextField label="Time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} mono />
            </div>
            <Field label="Notes (optional)" style={{ marginBottom: 12 }}>
              <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="What's this call for?" style={control} />
            </Field>
            {error && <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--danger)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submit} disabled={createFollowUp.isPending} style={{ ...primaryBtn, opacity: createFollowUp.isPending ? 0.6 : 1 }}>
                {createFollowUp.isPending ? 'Saving…' : 'Save follow-up'}
              </button>
              <button onClick={() => { setAdding(false); setError('') }} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <p style={{ margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            Nothing on the calendar — book a cancellation call from Submissions, or log a follow-up above.
          </p>
        ) : items.map((it, i) => (
          <div
            key={it.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 24px',
              borderBottom: i < items.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
            }}
          >
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: 4, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
              background: it.kind === 'cancellation' ? 'var(--warning-dim)' : 'var(--info-dim)',
              color: it.kind === 'cancellation' ? 'var(--warning)' : 'var(--info)',
              border: `var(--border-w) solid ${it.kind === 'cancellation' ? 'var(--warning-bd)' : 'var(--info-bd)'}`,
            }}>
              {it.kind === 'cancellation' ? <Phone size={10} /> : <Bell size={10} />}
              {it.kind === 'cancellation' ? 'CANCEL CALL' : 'FOLLOW-UP'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{it.name}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>{it.detail}</p>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
              {new Date(it.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            {it.deletable && (
              <button
                onClick={() => deleteFollowUp.mutate(it.id)}
                title="Delete follow-up"
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', padding: 4, cursor: 'pointer' }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Activity ─────────────────────────────────────────────────────────────────
// Derived purely from real policy fields (plus follow-ups/invites/team
// messages, all added in Prompt 365) — no separate event log exists, so this
// is what a status change already implies, not invented history.
const EVENT_ICON = {
  submitted: FileText, effect: CheckCircle, undrafted: XCircle, followup: RotateCcw,
  cancelbooked: Phone, cancelcomplete: CheckCircle, effconfirmed: CheckCircle,
  followuplogged: Bell, teammsg: MessageSquare, invitesent: UserPlus, inviteaccepted: UserCheck,
  goalcrossed: Target,
  // Prompt 365 overshoot-catalog preview types (nate44 only, see PREVIEW_TYPES below).
  cancelsave: CheckCircle, declined: Ban, lapsed: XCircle, reinstated: RefreshCw,
  followupdone: CheckCircle, payout: DollarSign, training: GraduationCap, persistency: Award,
}
const EVENT_COLOR = {
  submitted: 'var(--info)', effect: 'var(--success)', undrafted: 'var(--danger)', followup: 'var(--warning)',
  cancelbooked: 'var(--warning)', cancelcomplete: 'var(--success)', effconfirmed: 'var(--success)',
  followuplogged: 'var(--info)', teammsg: 'var(--info)', invitesent: 'var(--info)', inviteaccepted: 'var(--success)',
  goalcrossed: 'var(--success)',
  cancelsave: 'var(--success)', declined: 'var(--danger)', lapsed: 'var(--danger)', reinstated: 'var(--success)',
  followupdone: 'var(--success)', payout: 'var(--success)', training: 'var(--info)', persistency: 'var(--success)',
}

// Prompt 365 — Brayden asked for one sample row of every activity type that
// could plausibly belong in this feed, deliberately overshooting so he can
// tell CC/Falcon what to prune. These 8 have NO real schema backing today —
// no enum value, no table, no timestamp column exists anywhere to derive
// them from (full audit in the LIVE_STATE.md close-out entry). Hardcoded
// with fake timestamps and gated to the nate44 test account only, so no real
// agent's feed ever shows fabricated activity. This is a review-pass
// artifact, not a shipped feature — delete this list (and the one line that
// merges it in below) once Brayden has said what to keep.
function previewCatalog() {
  const day = 86400000
  const now = Date.now()
  return [
    { id: 'preview-cancelsave',   type: 'cancelsave',   label: 'Cancellation call completed — client stayed', sub: 'Save — kept the policy in force', at: new Date(now - 1 * day).toISOString() },
    { id: 'preview-declined',     type: 'declined',     label: 'Policy declined by carrier', sub: 'Application did not pass underwriting', at: new Date(now - 2 * day).toISOString() },
    { id: 'preview-lapsed',       type: 'lapsed',       label: 'Policy lapsed', sub: 'Non-payment — no cancellation call involved', at: new Date(now - 3 * day).toISOString() },
    { id: 'preview-reinstated',   type: 'reinstated',   label: 'Policy reinstated', sub: 'Came back into force after a lapse', at: new Date(now - 4 * day).toISOString() },
    { id: 'preview-followupdone', type: 'followupdone', label: 'Follow-up completed', sub: 'Marked resolved', at: new Date(now - 5 * day).toISOString() },
    { id: 'preview-payout',       type: 'payout',       label: 'Commission payout logged', sub: '$412.00 transferred', at: new Date(now - 6 * day).toISOString() },
    { id: 'preview-training',     type: 'training',     label: 'Training module completed', sub: 'Objection Handling — Module 3', at: new Date(now - 7 * day).toISOString() },
    { id: 'preview-persistency',  type: 'persistency',  label: 'Persistency milestone crossed', sub: '12-month cohort reached 90%', at: new Date(now - 8 * day).toISOString() },
  ].map(e => ({ ...e, preview: true }))
}

// Local calendar date (not UTC) for a timestamptz value — matches
// todayISO()'s own local-time convention (same pattern as AgentOverview.jsx's
// localISO()), so the day-stepper's "same day" bucketing can't drift off
// from what the agent sees on their own clock.
function localISO(value) {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Activity({ day, today }) {
  const { profile } = useAuth()
  const { data: policies = [], isLoading } = usePolicies(profile?.id)
  const { data: followUps = [] } = useFollowUps(profile?.id)
  const { data: sentInvites = [] } = useSentInvites(profile?.id)
  const { data: teamMessages = [] } = useRecentTeamMessages(15)

  const events = useMemo(() => {
    const out = []
    for (const p of policies) {
      const name = fullName(p)
      if (p.created_at) out.push({ id: `${p.id}-sub`, type: 'submitted', label: `New submission — ${name}`, sub: p.carrier_name || 'Carrier not set', at: p.created_at })
      if (p.status === 'In Effect') out.push({ id: `${p.id}-eff`, type: 'effect', label: `Went into effect — ${name}`, sub: p.policy_number || '', at: p.effectuation_answered_at || p.updated_at })
      if (p.status === 'Undrafted') out.push({ id: `${p.id}-undraft`, type: 'undrafted', label: `Came back undrafted — ${name}`, sub: p.policy_number || '', at: p.updated_at })
      if (p.status === 'Follow-up') out.push({ id: `${p.id}-fu`, type: 'followup', label: `Marked follow-up — ${name}`, sub: p.notes || '', at: p.updated_at })
      if (p.cancellation_call_at) out.push({ id: `${p.id}-cb`, type: 'cancelbooked', label: `Cancellation call booked — ${name}`, sub: p.carrier_name || '', at: p.cancellation_call_at })
      if (p.cancellation_status === 'Cancellation Complete') out.push({ id: `${p.id}-cc`, type: 'cancelcomplete', label: `Cancellation completed — ${name}`, sub: 'Commission released from reserve', at: p.updated_at })
      if (p.effectuation_answered_at) out.push({ id: `${p.id}-ec`, type: 'effconfirmed', label: `Effectuation confirmed — ${name}`, sub: '', at: p.effectuation_answered_at })
    }

    // Follow-up logged (Prompt 365) — real, closer_followups.created_at was
    // always there, this feed just never queried it before.
    for (const f of followUps) {
      if (f.created_at) out.push({ id: `${f.id}-fulog`, type: 'followuplogged', label: `Follow-up logged — ${f.client_name}`, sub: f.notes || 'No notes', at: f.created_at })
    }

    // Invite sent / accepted (Prompt 365) — real, rep_invites.created_at / used_at.
    for (const inv of sentInvites) {
      out.push({ id: `${inv.id}-sent`, type: 'invitesent', label: 'Invite sent', sub: `${inv.role} invite link generated`, at: inv.created_at })
      if (inv.used_at) out.push({ id: `${inv.id}-accepted`, type: 'inviteaccepted', label: 'Invite accepted', sub: `New ${inv.role} joined your team`, at: inv.used_at })
    }

    // New team message (Prompt 365) — real, migration 084 team_messages.
    // Only messages from OTHER people, not the agent's own sends.
    for (const m of teamMessages) {
      if (m.sender_id === profile?.id) continue
      const kind = m.team_conversations?.type === 'dm' ? 'DM' : 'Team chat'
      out.push({ id: `${m.id}-msg`, type: 'teammsg', label: `New team message — ${kind}`, sub: `${m.sender_name}: ${(m.body || '').slice(0, 60)}`, at: m.created_at })
    }

    // Monthly AP goal reached (Prompt 365) — real, derivable from existing
    // policies + profiles.monthly_ap_goal (no new schema): the policy whose
    // cumulative AP this month first crosses the goal.
    const goal = Number(profile?.monthly_ap_goal) || 20000
    const thisMonth = new Date().toISOString().slice(0, 7)
    const submittedThisMonth = policies
      .filter(p => (p.policy_sold_date || p.created_at?.slice(0, 10) || '').slice(0, 7) === thisMonth)
      .sort((a, b) => (a.policy_sold_date || a.created_at).localeCompare(b.policy_sold_date || b.created_at))
    let cumulative = 0
    for (const p of submittedThisMonth) {
      const wasUnder = cumulative < goal
      cumulative += Number(p.annual_premium || 0)
      if (wasUnder && cumulative >= goal) {
        out.push({ id: `goal-${thisMonth}`, type: 'goalcrossed', label: 'Monthly AP goal reached', sub: `Crossed the $${goal.toLocaleString()} target`, at: p.policy_sold_date || p.created_at })
        break
      }
    }

    // Day-stepper filter (Prompt 367) — only rows whose real timestamp falls
    // on the selected calendar day. Preview rows (below) are exempt — they
    // exist purely for nate44's review pass and bypass this entirely.
    const real = out.filter(e => e.at && localISO(e.at) === day)

    // nate44 review-mode dedup (Prompt 366), now scoped to the selected day
    // since 367 added real day-filtering on top — collapse to one row per
    // distinct type (most recent within the day) rather than every real row.
    let realDisplay = real
    if (profile?.username === 'nate44') {
      const seen = new Set()
      realDisplay = [...real]
        .sort((a, b) => b.at.localeCompare(a.at))
        .filter(e => {
          if (seen.has(e.type)) return false
          seen.add(e.type)
          return true
        })
    }

    const withPreview = profile?.username === 'nate44' ? [...realDisplay, ...previewCatalog()] : realDisplay
    return withPreview.sort((a, b) => b.at.localeCompare(a.at))
  }, [policies, followUps, sentInvites, teamMessages, profile?.id, profile?.username, profile?.monthly_ap_goal, day])

  const hasReal = events.some(e => !e.preview)

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {isLoading ? (
        <p style={{ margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        <>
          {!hasReal && (
            <p style={{
              margin: 0, padding: '22px 24px', fontSize: 12.5, color: 'var(--text-muted)',
              borderBottom: events.length > 0 ? 'var(--border-w) solid var(--border)' : 'none',
            }}>
              No activity on {dayLabel(day, today)}.
            </p>
          )}
          {events.map((e, i) => {
            const Icon = EVENT_ICON[e.type] || Clock
            const color = EVENT_COLOR[e.type] || 'var(--text-muted)'
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px',
                  borderBottom: i < events.length - 1 ? 'var(--border-w) solid var(--border)' : 'none',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={13} style={{ color }} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {e.label}
                    {e.preview && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                        padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                        background: 'var(--warning-dim)', color: 'var(--warning)', border: 'var(--border-w) solid var(--warning-bd)',
                      }}>
                        Preview — not real data
                      </span>
                    )}
                  </p>
                  {e.sub && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{e.sub}</p>}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, whiteSpace: 'nowrap' }}>
                  {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ── Graded calls ─────────────────────────────────────────────────────────────
// Flagged, not spec'd (Prompt 329): no call-recording/QA-scoring system
// exists anywhere in this app — Live Call itself is still a placeholder.
// Ships "coming soon" rather than guessing at who grades a call, on what
// criteria, from what recording/transcript source.
function GradedCalls() {
  return (
    <div style={{ minHeight: '40vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)', borderRadius: 8,
        padding: '64px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center',
        textAlign: 'center', gap: 16, maxWidth: 480,
      }}>
        <span style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent-dim)', border: '1px solid var(--accent-border)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Clock size={24} style={{ color: 'var(--accent)' }} />
        </span>
        <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Coming soon</p>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          No call-recording or QA-scoring system exists yet — Live Call itself has no call handling wired up.
          This needs a real answer from Brayden first: who grades a call, on what criteria, and from what
          recording or transcript source.
        </p>
      </div>
    </div>
  )
}
