import { useState, useEffect, useRef, useMemo, Component } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Phone, X, MapPin, User, Tag, CalendarClock, Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react'
import { Device } from '@twilio/voice-sdk'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Badge } from '../ui/Badge'
import { buildScriptFlow } from '../../lib/discoveryScript'
import { ScriptWalk } from './ScriptWalk'
import { inferTimezoneFromState, zonedTimeToUtcIso, timezoneLabel, utcIsoToZonedDatetimeLocal } from '../../lib/timezones'
import { useActiveCall } from '../../contexts/ActiveCallContext'
import { CallPrepModal, Field } from '../shared/CallPrepModal'
import { ErrorToast } from '../shared/ErrorToast'

// The only statuses a rep can set from the call modal — color coordinated.
// `note` tells the rep exactly where the lead routes (pipeline behavior).
const STATUS_OPTIONS = [
  { value: 'New',                color: '#38BDF8', dim: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.35)', note: null },
  { value: 'Appointment Booked', color: '#22C55E', dim: 'rgba(34,197,94,0.10)',   border: 'rgba(34,197,94,0.35)',  note: 'Nice work! Fill in the appointment details below' },
  { value: 'No Answer',          color: '#94A3B8', dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.35)', note: 'No one picked up — try again later or set a follow-up date' },
  { value: 'Not Interested',     color: '#EF4444', dim: 'rgba(239,68,68,0.10)',   border: 'rgba(239,68,68,0.35)',  note: 'Lead declined — removed from your active list' },
  { value: 'Follow-Up',          color: '#F59E0B', dim: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.35)', note: 'Pick a date below to come back to this one' },
]

// Statuses that count as a completed dial — logged to the calls table for stats
const CALL_OUTCOMES = ['Appointment Booked', 'No Answer', 'Not Interested', 'Follow-Up']

// Catches render-time crashes inside the modal so a bad script payload (or
// any other bug in here) degrades to a retry state instead of unmounting
// the entire app.
class ModalErrorBoundary extends Component {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  render() {
    if (!this.state.crashed) return this.props.children
    return (
      <div style={{
        width: '100%', maxWidth: 480, background: '#0E0E1A',
        border: '0.5px solid var(--border)', borderRadius: 14,
        padding: '32px 28px', textAlign: 'center',
      }}>
        <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 8px' }}>
          Something went wrong loading this call
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 20px' }}>
          Nothing was saved. Close this and open the lead again — the script will regenerate.
        </p>
        <button
          onClick={this.props.onClose}
          style={{
            padding: '9px 24px', borderRadius: 8, background: 'var(--accent)',
            border: 'none', fontSize: 13, fontWeight: 500, color: 'white', cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>
    )
  }
}

// Seconds → "m:ss" for the in-call timer.
function fmtCallTime(total) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// timestamptz → value for <input type="datetime-local"> in local time
function toDatetimeLocal(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d)) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function gradeColor(grade) {
  if (!grade) return 'var(--text-muted)'
  if (['A+', 'A', 'A-'].includes(grade)) return 'var(--success)'
  if (['B+', 'B', 'B-'].includes(grade)) return 'var(--info)'
  if (['C+', 'C'].includes(grade)) return 'var(--warning)'
  return 'var(--danger)'
}

function gradeDim(grade) {
  if (!grade) return 'var(--bg-elevated)'
  if (['A+', 'A', 'A-'].includes(grade)) return 'var(--success-dim)'
  if (['B+', 'B', 'B-'].includes(grade)) return 'var(--info-dim)'
  if (['C+', 'C'].includes(grade)) return 'var(--warning-dim)'
  return 'var(--danger-dim)'
}

function PostCallCard({ state, onClose, leadName }) {
  const isGrading = state === 'grading'
  const grade = typeof state === 'object' ? state?.grade : null
  return (
    <div style={{
      width: '100%', maxWidth: 420, background: '#0E0E1A',
      border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden',
      boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '0.5px solid var(--border)',
      }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: 0 }}>
          {isGrading ? 'Grading your call…' : `Grade: ${grade}`}
        </p>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}
        >
          <X size={18} />
        </button>
      </div>
      <div style={{ padding: '22px 20px' }}>
        <p style={{ fontSize: 13, color: 'var(--success)', margin: '0 0 18px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>✓</span> Call saved for {leadName}
        </p>
        {isGrading ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Loader2 size={16} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>AI is analyzing the recording…</p>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 0 26px', lineHeight: 1.55 }}>
              Takes about 30–60 seconds. You can close now — the grade will appear in My Calls and your notifications.
            </p>
          </>
        ) : (
          <div style={{
            background: gradeDim(grade),
            border: `0.5px solid ${gradeColor(grade)}55`,
            borderLeft: `3px solid ${gradeColor(grade)}`,
            borderRadius: 10, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                background: gradeDim(grade), border: `0.5px solid ${gradeColor(grade)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: gradeColor(grade), fontFamily: 'var(--font-mono)' }}>
                  {grade}
                </span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 500, color: gradeColor(grade), margin: 0 }}>
                {leadName}
              </p>
            </div>
            {state?.feedback_good && (
              <p style={{ fontSize: 12, color: 'var(--success)', margin: '0 0 6px', lineHeight: 1.5 }}>
                ✓ {state.feedback_good}
              </p>
            )}
            {state?.feedback_improve && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                ↗ {state.feedback_improve}
              </p>
            )}
          </div>
        )}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        padding: '10px 18px', borderTop: '0.5px solid var(--border)',
      }}>
        <button
          onClick={onClose}
          style={{
            padding: '8px 22px', borderRadius: 8, cursor: 'pointer',
            background: grade ? 'var(--accent)' : 'var(--bg-elevated)',
            border: grade ? 'none' : '0.5px solid var(--border)',
            fontSize: 13, fontWeight: 500,
            color: grade ? 'white' : 'var(--text-secondary)',
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}

export function CallModal({ lead, onClose }) {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const { setIsInCall } = useActiveCall()

  const flow = useMemo(() => buildScriptFlow(lead, profile), [lead.id, profile?.id])
  const clientTz      = useMemo(() => inferTimezoneFromState(lead.state), [lead.state])
  const clientTzLabel = timezoneLabel(clientTz)

  const [status, setStatus]           = useState(lead.status)
  const [statusTouched, setStatusTouched] = useState(false)
  const [notes, setNotes]             = useState('')
  const [callsMissedPerWeek, setCallsMissedPerWeek] = useState(lead.calls_missed_per_week ?? '')
  const [avgTicket, setAvgTicket]                   = useState(lead.avg_ticket ?? '')
  const [primaryPain, setPrimaryPain]               = useState(lead.primary_pain || '')
  const [currentSetup, setCurrentSetup]             = useState(lead.current_setup || '')
  const [secondaryPain, setSecondaryPain]           = useState('')
  const [followUpAt, setFollowUpAt]   = useState(toDatetimeLocal(lead.follow_up_at))
  const [followUpNotes, setFollowUpNotes] = useState(lead.follow_up_notes || '')
  const [appointmentAt, setAppointmentAt] = useState(utcIsoToZonedDatetimeLocal(lead.appointment_at, clientTz))
  const [closing, setClosing]         = useState(false)
  const [doneError, setDoneError]     = useState('')
  const [callState, setCallState]     = useState('idle')
  const [deviceReady, setDeviceReady] = useState(false)
  const [muted, setMuted]             = useState(false)
  const [callSeconds, setCallSeconds] = useState(0)
  const deviceRef   = useRef(null)
  const callRef     = useRef(null)
  const callSidRef  = useRef(null)
  const [postCallCallId, setPostCallCallId] = useState(null)
  const [postCallState, setPostCallState]   = useState(null)
  // Has the rep actually placed the call this modal session? Gates status
  // changes (Prompt 310) — set true the moment they hit the call button,
  // via either the Twilio in-browser path or the tel: fallback link.
  const [callStarted, setCallStarted] = useState(false)
  const [toastMsg, setToastMsg]       = useState('')

  // Twilio Device setup — fetch token + register once per lead.
  useEffect(() => {
    let cancelled = false
    let device = null
    async function init() {
      try {
        const { data, error } = await supabase.functions.invoke('twilio-token')
        if (error || !data?.token) {
          console.error('[twilio-token] failed:', error || 'no token returned')
          return
        }
        if (cancelled) return
        device = new Device(data.token, { codecPreferences: ['opus', 'pcmu'] })
        device.on('registered', () => { if (!cancelled) setDeviceReady(true) })
        device.on('error', (twilioError) => {
          console.error('[Twilio Device] error:', twilioError?.message || twilioError?.code || twilioError)
          if (!cancelled) setCallState(prev => prev !== 'idle' ? 'error' : prev)
        })
        deviceRef.current = device
        device.register()
      } catch (e) {
        console.error('[twilio-token] exception:', e)
        if (!cancelled) setDeviceReady(false)
      }
    }
    init()
    return () => {
      cancelled = true
      try { callRef.current?.disconnect() } catch { /* already gone */ }
      try { device?.destroy() } catch { /* already gone */ }
      deviceRef.current = null
      callRef.current = null
    }
  }, [lead.id])

  useEffect(() => { setIsInCall(callState === 'in-call') }, [callState, setIsInCall])

  useEffect(() => {
    if (callState !== 'in-call') return
    const t = setInterval(() => setCallSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [callState])

  useEffect(() => {
    if (!postCallCallId) return
    const channel = supabase
      .channel(`call-grade-${postCallCallId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls',
        filter: `id=eq.${postCallCallId}`,
      }, (payload) => {
        const n = payload.new
        if (n.graded_at) {
          setPostCallState({ grade: n.grade, feedback_good: n.feedback_good, feedback_improve: n.feedback_improve })
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [postCallCallId])

  async function startCall() {
    const device = deviceRef.current
    if (!device || !lead.phone) return
    setCallStarted(true)
    setMuted(false)
    setCallSeconds(0)
    setCallState('connecting')
    try {
      const call = await device.connect({ params: { To: lead.phone } })
      callRef.current = call
      call.on('accept', () => { setCallState('in-call'); callSidRef.current = call.parameters?.CallSid || null })
      call.on('disconnect', () => { callRef.current = null; setMuted(false); setCallState('idle') })
      call.on('cancel',     () => { callRef.current = null; setCallState('idle') })
      call.on('error',      (e) => { console.error('[Twilio call] error:', e?.message || e?.code || e); callRef.current = null; setCallState('error') })
    } catch (e) {
      console.error('[Twilio startCall] connect failed:', e?.message || e)
      callRef.current = null
      setCallState('error')
    }
  }

  function toggleMute() {
    const call = callRef.current
    if (!call) return
    const next = !muted
    call.mute(next)
    setMuted(next)
  }

  function hangUp() {
    try { callRef.current?.disconnect() } catch { /* disconnect handler resets state */ }
  }

  function handleDataCollect(vals) {
    if (vals.calls_missed_per_week !== undefined)
      setCallsMissedPerWeek(vals.calls_missed_per_week === null ? '' : String(vals.calls_missed_per_week))
    if (vals.avg_ticket !== undefined)
      setAvgTicket(vals.avg_ticket === null ? '' : String(vals.avg_ticket))
  }

  const needsDate =
    (status === 'Appointment Booked' && !appointmentAt) ||
    (status === 'Follow-Up' && !followUpAt)

  async function handleDone() {
    if (!statusTouched || needsDate) return
    setClosing(true)
    setDoneError('')
    try {
      const combinedPainPoints = [lead.pain_points, secondaryPain || null].filter(Boolean).join(' | ') || null
      const patch = {
        status,
        notes: notes || null,
        calls_missed_per_week: callsMissedPerWeek === '' ? null : Number(callsMissedPerWeek),
        avg_ticket:             avgTicket === '' ? null : Number(avgTicket),
        primary_pain:           primaryPain || null,
        current_setup:          currentSetup || null,
        pain_points:            combinedPainPoints,
      }
      if (status === 'Follow-Up') {
        patch.follow_up_at    = new Date(followUpAt).toISOString()
        patch.follow_up_notes = followUpNotes || null
      }
      if (status === 'Appointment Booked') {
        patch.appointment_at = zonedTimeToUtcIso(appointmentAt, clientTz)
      }
      const { data: updated, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', lead.id)
        .select('id')
      if (error) throw error
      if (!updated?.length) throw new Error('Save failed — your session may have expired. Refresh the page and try again.')

      let insertedCallId = null
      if (profile?.id) {
        const utcMidnight = new Date().toISOString().split('T')[0] + 'T00:00:00Z'
        await supabase
          .from('calls')
          .delete()
          .eq('lead_id', lead.id)
          .eq('rep_id', profile.id)
          .gte('created_at', utcMidnight)
        if (CALL_OUTCOMES.includes(status)) {
          const { data: newCall } = await supabase.from('calls').insert({
            lead_id: lead.id,
            rep_id: profile.id,
            outcome: status,
            twilio_call_sid: callSidRef.current || null,
          }).select('id').single()
          if (newCall?.id) insertedCallId = newCall.id
        }
      }

      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['stats'] })

      if (status === 'Appointment Booked') {
        supabase.functions.invoke('enrich-business-info', {
          body: { leadId: lead.id, businessName: lead.business_name, city: lead.city || null, placeId: lead.place_id || null },
        }).then(({ data }) => {
          if (data?.success) qc.invalidateQueries({ queryKey: ['appointments'] })
        }).catch(() => {})
      }

      if (status === 'Appointment Booked') {
        supabase.functions.invoke('recommend-stack', {
          body: {
            businessName: lead.business_name, niche: lead.niche, location: lead.city || null,
            callsMissedPerWeek: patch.calls_missed_per_week, avgTicket: patch.avg_ticket,
            monthlyLaborCost: lead.monthly_labor_cost ?? null, repNotes: notes || lead.notes || null,
            jobTitle: lead.job_title || null, primaryPain: patch.primary_pain,
            currentSetup: patch.current_setup, secondaryPain: secondaryPain || null,
          },
        }).then(async ({ data }) => {
          if (!data?.rec) return
          await supabase.from('leads').update({
            recommended_automations: data.rec.recommended_automations ?? null,
            front_runner_agents:     data.rec.front_runners ?? null,
            sub_agents:              data.rec.sub_agents ?? null,
            custom_monthly_price:    data.rec.custom_monthly_price ?? null,
            recommended_stack:       data.rec,
            stack_generated_at:      new Date().toISOString(),
          }).eq('id', lead.id)

          const { data: pendingAppt } = await supabase
            .from('appointments')
            .select('id')
            .eq('lead_id', lead.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (pendingAppt?.id) {
            supabase.functions.invoke('provision-demo-client', {
              body: {
                appointmentId: pendingAppt.id, leadId: lead.id, businessName: lead.business_name,
                niche: lead.niche, location: lead.city || null,
                customMonthlyPrice: data.rec.custom_monthly_price ?? null,
                recommendedAutomations: data.rec.recommended_automations ?? null,
                frontRunnerAgents: data.rec.front_runners ?? null, subAgents: data.rec.sub_agents ?? null,
              },
            }).catch(err => console.error('[CallModal] provision-demo-client failed:', err))
          }
        }).catch(err => console.error('[CallModal] recommend-stack failed:', err))
      }

      if (callSidRef.current && insertedCallId) {
        setPostCallCallId(insertedCallId)
        setPostCallState('grading')
      } else {
        onClose()
      }
    } catch (err) {
      setDoneError(err.message || 'Failed to save')
      setClosing(false)
    }
  }

  // The statusNote is dynamic for setter — shows actual booked/follow-up time when available.
  const selected = STATUS_OPTIONS.find(o => o.value === status)
  const statusNote = (() => {
    if (!selected?.note) return undefined
    if (status === 'Follow-Up' && followUpAt)
      return `Returns to your list on ${new Date(followUpAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    if (status === 'Appointment Booked' && appointmentAt)
      return `Appointment: ${new Date(appointmentAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${clientTzLabel}`
    return selected.note
  })()

  const telHref = lead.phone ? `tel:${lead.phone.replace(/\D/g, '')}` : null

  // Left column slots
  const infoContent = (
    <>
      <Field icon={User}   label="Contact" value={lead.contact_name} />
      <Field icon={Tag}    label="Niche"   value={lead.niche} />
      <Field icon={MapPin} label="City"    value={[lead.city, lead.state].filter(Boolean).join(', ')} />
    </>
  )

  const statusAddon = (
    <>
      {status === 'Appointment Booked' && (
        <div style={{
          marginBottom: 14, padding: '12px',
          background: 'rgba(34,197,94,0.06)', borderRadius: 8,
          border: '0.5px solid rgba(34,197,94,0.2)',
        }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#22C55E', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <CalendarClock size={10} /> Appointment Time — {clientTzLabel} (client's local time)
          </p>
          <input
            type="datetime-local"
            value={appointmentAt}
            onChange={e => setAppointmentAt(e.target.value)}
            style={{
              width: '100%', height: 36, padding: '0 10px',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)', colorScheme: 'dark',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>
            {appointmentAt
              ? `Scheduled for ${new Date(appointmentAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ${clientTzLabel} — saved when you hit Done.`
              : `Pick the day and time the prospect agreed to, in THEIR local time (${clientTzLabel}).`}
          </p>
        </div>
      )}
      {status === 'Appointment Booked' && (
        <div style={{
          marginBottom: 14, padding: '12px',
          background: 'rgba(108,99,255,0.06)', borderRadius: 8,
          border: '0.5px solid var(--accent-border)',
        }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', margin: '0 0 8px' }}>
            Discovery — for the custom stack
          </p>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>What's costing them most?</label>
          <select
            value={primaryPain}
            onChange={e => setPrimaryPain(e.target.value)}
            style={{ width: '100%', height: 34, padding: '0 10px', marginBottom: 8, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          >
            <option value="">Select…</option>
            <option value="missed_calls">Missed calls</option>
            <option value="slow_response">Slow response</option>
            <option value="no_shows">No-shows</option>
            <option value="never_booked">Leads who called but never booked</option>
          </select>
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>What do they have today to handle that?</label>
          <input
            type="text" value={currentSetup}
            onChange={e => setCurrentSetup(e.target.value)}
            placeholder="e.g. voicemail only, answering service…"
            style={{ width: '100%', height: 34, padding: '0 10px', marginBottom: 8, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
          <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Anything else slipping through the cracks?</label>
          <input
            type="text" value={secondaryPain}
            onChange={e => setSecondaryPain(e.target.value)}
            placeholder="optional"
            style={{ width: '100%', height: 34, padding: '0 10px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 7, fontSize: 13, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
        </div>
      )}
      {status === 'Follow-Up' && (
        <div style={{
          marginBottom: 14, padding: '12px',
          background: 'rgba(245,158,11,0.06)', borderRadius: 8,
          border: '0.5px solid rgba(245,158,11,0.2)',
        }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#F59E0B', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <CalendarClock size={10} /> Schedule Follow-Up
          </p>
          <input
            type="datetime-local"
            value={followUpAt}
            onChange={e => setFollowUpAt(e.target.value)}
            style={{
              width: '100%', height: 36, padding: '0 10px', marginBottom: 8,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)', colorScheme: 'dark',
              boxSizing: 'border-box',
            }}
          />
          <textarea
            value={followUpNotes}
            onChange={e => setFollowUpNotes(e.target.value)}
            placeholder="Reason for follow-up (e.g. owner asked to call back Thursday)…"
            rows={2}
            style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 7, fontSize: 13, color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)', resize: 'none', lineHeight: 1.5,
              boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>Saved when you hit Done.</p>
        </div>
      )}
    </>
  )

  const callSection = !telHref ? (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: 44, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
      borderRadius: 10, fontSize: 13, color: 'var(--text-muted)',
    }}>
      No phone number on file
    </div>
  ) : callState === 'in-call' ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: 40, background: 'rgba(34,197,94,0.12)',
        border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: 10,
        fontSize: 13, fontWeight: 500, color: 'var(--success)',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
        Connected · <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtCallTime(callSeconds)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={toggleMute}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            height: 40, borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 500,
            background: muted ? 'rgba(245,158,11,0.14)' : 'var(--bg-elevated)',
            border: `0.5px solid ${muted ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
            color: muted ? 'var(--warning)' : 'var(--text-secondary)',
          }}
        >
          {muted ? <MicOff size={14} /> : <Mic size={14} />}
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={hangUp}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            height: 40, borderRadius: 10, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 500, color: 'white', background: 'var(--danger)',
          }}
        >
          <PhoneOff size={14} /> Hang Up
        </button>
      </div>
    </div>
  ) : callState === 'connecting' ? (
    <button
      disabled
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: 44, width: '100%',
        background: 'rgba(34,197,94,0.5)', borderRadius: 10, border: 'none',
        fontSize: 14, fontWeight: 500, color: 'white', cursor: 'not-allowed',
      }}
    >
      <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…
    </button>
  ) : deviceReady ? (
    <>
      <button
        onClick={startCall}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          height: 44, width: '100%',
          background: 'var(--success)', borderRadius: 10, border: 'none',
          fontSize: 14, fontWeight: 500, color: 'white', cursor: 'pointer',
          boxShadow: '0 0 20px rgba(34,197,94,0.3)',
        }}
      >
        <Phone size={15} /> Call {lead.phone}
      </button>
      {callState === 'error' && (
        <p style={{ fontSize: 11, color: 'var(--danger)', margin: '6px 0 0', textAlign: 'center' }}>
          Call failed — try again, or use <a href={telHref} onClick={() => setCallStarted(true)} style={{ color: 'var(--accent)' }}>your phone</a>.
        </p>
      )}
    </>
  ) : (
    <a
      href={telHref}
      onClick={() => setCallStarted(true)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: 44,
        background: 'var(--success)', borderRadius: 10,
        fontSize: 14, fontWeight: 500, color: 'white', textDecoration: 'none',
        boxShadow: '0 0 20px rgba(34,197,94,0.3)',
      }}
    >
      <Phone size={15} /> Call {lead.phone}
    </a>
  )

  const footerWarning = needsDate
    ? (status === 'Appointment Booked' ? 'Pick the appointment date & time to save' : 'Pick the follow-up date & time to save')
    : undefined

  // Post-call state: show the grade card in a separate overlay instead of the modal.
  if (postCallState !== null) {
    return createPortal(
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20,
        }}
        onClick={e => e.stopPropagation()}
      >
        <PostCallCard state={postCallState} onClose={onClose} leadName={lead.business_name} />
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => e.stopPropagation()}
    >
      <ModalErrorBoundary onClose={onClose}>
        <CallPrepModal
          lead={lead}
          onClose={onClose}
          badge={<Badge label={status} />}
          subtitle="Call prep · everything you need in one place"
          infoContent={infoContent}
          statusOptions={STATUS_OPTIONS}
          status={status}
          statusTouched={statusTouched}
          onStatusSelect={v => {
            if (v !== 'New' && !callStarted) { setToastMsg('You have to make the call first'); return }
            setStatus(v); setStatusTouched(true)
          }}
          statusNote={statusNote}
          statusAddon={statusAddon}
          notes={notes}
          onNotesChange={e => setNotes(e.target.value)}
          callSection={callSection}
          footerHint="Select a status to finish — X discards changes"
          footerWarning={footerWarning}
          footerError={doneError}
          onDone={handleDone}
          isDoneDisabled={closing || !statusTouched || needsDate}
          doneLabel={closing ? 'Saving…' : 'Done'}
        >
          <ScriptWalk flow={flow} mode="live" leadId={lead.id} onDataCollect={handleDataCollect} />
        </CallPrepModal>
      </ModalErrorBoundary>
      {toastMsg && <ErrorToast message={toastMsg} onDone={() => setToastMsg('')} />}
    </div>,
    document.body
  )
}
