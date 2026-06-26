import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  MapPin, Phone, Mail, Bell, Calendar, Star, Globe, ChevronRight, X,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Textarea, Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { inferTimezoneFromState, zonedTimeToUtcIso, timezoneLabel, formatInTimezone, utcIsoToZonedDatetimeLocal, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { CLOSER_SCRIPT } from '../../lib/closerScript'

const STATUS_OPTIONS = [
  { value: 'closed',             label: 'Closed',           color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  { value: 'lost',               label: 'Lost',             color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  { value: 'no_show',            label: 'No Show',          color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  { value: 'missed',             label: 'Missed',           color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
  { value: 'needs_rescheduling', label: 'Needs Reschedule', color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
]

const SAY_LINES = CLOSER_SCRIPT.flatMap(s => s.lines)

export function AppointmentCard({ appt }) {
  const { profile } = useAuth()
  const lead = appt.lead
  const clientTz = inferTimezoneFromState(lead?.state)
  const viewerTz = profile?.timezone || DEFAULT_TIMEZONE
  const [modalOpen, setModalOpen] = useState(false)
  const [outcome, setOutcome] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [lossReason, setLossReason] = useState('')
  const [notes, setNotes] = useState(appt.closer_notes || '')
  const [scheduledAt, setScheduledAt] = useState(utcIsoToZonedDatetimeLocal(appt.scheduled_at, clientTz))
  const [lostLoading, setLostLoading] = useState(false)
  const [sayStep, setSayStep] = useState(0)
  const update = useUpdateAppointment()

  useEffect(() => {
    if (!modalOpen) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [modalOpen])

  async function handleComplete() {
    if (!outcome) return
    if (outcome === 'missed' || outcome === 'needs_rescheduling') {
      await update.mutateAsync({ appointmentId: appt.id, updates: { status: outcome, closer_notes: notes || undefined } })
      setModalOpen(false)
      return
    }
    await update.mutateAsync({
      appointmentId: appt.id,
      updates: {
        status: 'completed',
        outcome,
        deal_value: outcome === 'closed' ? parseFloat(dealValue) || null : null,
        loss_reason: outcome !== 'closed' ? lossReason : null,
        closer_notes: notes,
      },
    })
    if (outcome === 'closed') {
      supabase.functions.invoke('create-commission-payout', {
        body: { appointment_id: appt.id },
      }).catch(err => console.error('[AppointmentCard] create-commission-payout failed:', err))
    }
    if (outcome === 'no_show' || outcome === 'lost') {
      await supabase.functions.invoke('schedule-reminders', {
        body: { appointment_id: appt.id, cancel_all: true },
      })
    }
    if (outcome === 'lost' && appt.demo_client_id) {
      setLostLoading(true)
      try {
        await supabase.functions.invoke('cleanup-lost-demo', { body: { appointmentId: appt.id } })
      } catch (err) {
        console.error('[AppointmentCard] cleanup-lost-demo failed:', err)
      } finally {
        setLostLoading(false)
      }
    }
    setModalOpen(false)
  }

  async function handleSchedule() {
    if (!scheduledAt) return
    const iso = zonedTimeToUtcIso(scheduledAt, clientTz)
    await update.mutateAsync({
      appointmentId: appt.id,
      updates: { scheduled_at: iso, status: 'pending' },
    })
    await supabase.functions.invoke('schedule-reminders', {
      body: { appointment_id: appt.id, scheduled_at: iso, lead_phone: lead.phone, contact_name: lead.contact_name },
    })
  }

  if (!lead) {
    return (
      <div className="glass" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Appointment {appt.id?.slice(0, 8)} — lead not visible to this account
      </div>
    )
  }

  const currentSayLine = SAY_LINES[sayStep] || ''
  const canGoBack = sayStep > 0
  const canGoNext = sayStep < SAY_LINES.length - 1

  return (
    <>
      {/* ── Card row — click to open modal ── */}
      <div
        className="glass"
        style={{ overflow: 'hidden', marginBottom: 0, cursor: 'pointer' }}
        onClick={() => setModalOpen(true)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                {lead.business_name}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
              {lead.niche && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lead.niche}</span>}
              {lead.city && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                  <MapPin size={10} /> {lead.city}
                </span>
              )}
              {lead.google_rating != null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Star size={10} style={{ color: 'var(--warning)' }} fill="var(--warning)" />
                  {lead.google_rating}{lead.google_review_count != null ? ` · ${lead.google_review_count} reviews` : ''}
                </span>
              )}
              {lead.has_website != null && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text-muted)' }}>
                  <Globe size={10} /> {lead.has_website ? 'Has website' : 'No website'}
                </span>
              )}
              {appt.rep && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Set by {appt.rep.full_name}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {appt.scheduled_at && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Calendar size={11} />
                {formatInTimezone(appt.scheduled_at, viewerTz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <Badge label={appt.status} />
            <ChevronRight size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </div>
        </div>
      </div>

      {/* ── Detail Modal ── */}
      {modalOpen && createPortal(
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(8,8,16,0.85)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            width: '100%', maxWidth: 880, maxHeight: '88vh',
            display: 'flex', flexDirection: 'column',
            background: '#0E0E1A',
            border: '0.5px solid var(--border)',
            borderRadius: 14,
            overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lead.business_name}
                </p>
                {lead.niche && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>{lead.niche}</p>}
              </div>
              <Badge label={appt.status} />
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 8 }}>
                <X size={18} />
              </button>
            </div>

            {/* Two-column body */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

              {/* LEFT — contact / appointment / status / notes */}
              <div className="scrollbar-thin" style={{ flex: '0 0 52%', overflowY: 'auto', borderRight: '0.5px solid var(--border)' }}>

                {/* Contact info */}
                <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                      <Phone size={13} /> {lead.phone}
                    </a>
                  )}
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}>
                      <Mail size={13} /> {lead.email}
                    </a>
                  )}
                  {appt.rep && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Set by {appt.rep.full_name}</p>}
                </div>

                {/* Appointment time */}
                <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, margin: '0 0 4px' }}>
                        Appointment — {timezoneLabel(clientTz)}
                      </p>
                      <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                    </div>
                    <Button variant="secondary" size="sm" onClick={handleSchedule} disabled={!scheduledAt || update.isPending}>
                      <Bell size={13} /> Set
                    </Button>
                  </div>
                  {appt.scheduled_at && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
                      <Bell size={10} /> Reminders: 24h, 1h, 10min before
                    </p>
                  )}
                </div>

                {/* Status picker */}
                <div style={{ padding: '14px 18px', borderBottom: '0.5px solid var(--border)' }}>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, margin: '0 0 10px' }}>
                    Set Outcome
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {STATUS_OPTIONS.map(opt => {
                      const active = outcome === opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setOutcome(active ? '' : opt.value)}
                          style={{
                            padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                            fontSize: 12, fontWeight: 500,
                            background: active ? opt.dim : 'var(--bg-elevated)',
                            color: active ? opt.color : 'var(--text-muted)',
                            border: `0.5px solid ${active ? opt.border : 'var(--border)'}`,
                            transition: 'all 0.1s',
                          }}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                  {outcome === 'closed' && (
                    <Input type="number" value={dealValue} onChange={e => setDealValue(e.target.value)} placeholder="Deal value ($)" style={{ marginTop: 10, width: '100%' }} />
                  )}
                  {outcome && !['closed', 'missed', 'needs_rescheduling'].includes(outcome) && (
                    <Input value={lossReason} onChange={e => setLossReason(e.target.value)} placeholder="Loss reason…" style={{ marginTop: 10, width: '100%' }} />
                  )}
                </div>

                {/* Call notes */}
                <div style={{ padding: '14px 18px' }}>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Call notes…" />
                </div>
              </div>

              {/* RIGHT — SAY THIS stepper */}
              <div style={{ flex: '0 0 48%', display: 'flex', flexDirection: 'column', padding: '18px 18px 14px' }}>
                <p style={{ fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: '0 0 12px' }}>
                  Say This
                </p>

                {/* Say card — grows to fill available space */}
                <div style={{
                  flex: 1,
                  padding: '16px 18px',
                  borderRadius: 10,
                  background: 'var(--bg-elevated)',
                  border: '0.5px solid var(--accent-border)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  minHeight: 0,
                }}>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.65, margin: 0, fontStyle: 'italic', overflowY: 'auto' }}>
                    {currentSayLine}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '12px 0 0', fontFamily: 'var(--font-mono)' }}>
                    {sayStep + 1} / {SAY_LINES.length}
                  </p>
                </div>

                {/* Stepper controls */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <button
                    onClick={() => setSayStep(s => Math.max(0, s - 1))}
                    disabled={!canGoBack}
                    style={{ fontSize: 12, color: canGoBack ? 'var(--text-secondary)' : 'var(--border)', background: 'none', border: 'none', cursor: canGoBack ? 'pointer' : 'default', padding: 0 }}
                  >
                    ← Back
                  </button>
                  <button
                    onClick={() => setSayStep(0)}
                    style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Start Over
                  </button>
                  <div style={{ flex: 1 }} />
                  <Button size="sm" onClick={() => setSayStep(s => Math.min(SAY_LINES.length - 1, s + 1))} disabled={!canGoNext}>
                    Next →
                  </Button>
                </div>
              </div>
            </div>

            {/* Footer — Save gating */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12,
              padding: '12px 18px',
              borderTop: '0.5px solid var(--border)',
              flexShrink: 0,
            }}>
              {!outcome && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
                  Select a status to finish
                </p>
              )}
              <Button
                onClick={handleComplete}
                disabled={!outcome || update.isPending || lostLoading}
              >
                {update.isPending ? 'Saving…' : lostLoading ? 'Cleaning up…' : 'Save'}
              </Button>
            </div>

          </div>
        </div>,
        document.body
      )}
    </>
  )
}
