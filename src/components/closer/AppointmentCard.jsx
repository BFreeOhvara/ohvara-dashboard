import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  MapPin, Phone, Mail, Calendar, Star, Globe, ChevronRight,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { formatInTimezone, DEFAULT_TIMEZONE } from '../../lib/timezones'
import { CLOSER_SCRIPT } from '../../lib/closerScript'
import { CallPrepModal, Field } from '../shared/CallPrepModal'

// Closer-specific status options
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
  const viewerTz = profile?.timezone || DEFAULT_TIMEZONE

  const [modalOpen, setModalOpen]       = useState(false)
  const [outcome, setOutcome]           = useState('')
  const [outcomeTouched, setOutcomeTouched] = useState(false)
  const [dealValue, setDealValue]       = useState('')
  const [lossReason, setLossReason]     = useState('')
  const [notes, setNotes]               = useState(appt.closer_notes || '')
  const [lostLoading, setLostLoading]   = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState('')
  const [sayStep, setSayStep]           = useState(0)
  const update = useUpdateAppointment()

  async function handleComplete() {
    if (!outcomeTouched) return
    setSaving(true)
    setSaveError('')
    try {
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
    } catch (err) {
      setSaveError(err.message || 'Failed to save')
      setSaving(false)
    }
  }

  if (!lead) {
    return (
      <div className="glass" style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Appointment {appt.id?.slice(0, 8)} — lead not visible to this account
      </div>
    )
  }

  const canGoBack  = sayStep > 0
  const canGoNext  = sayStep < SAY_LINES.length - 1
  const rawLine    = SAY_LINES[sayStep] || ''
  const isAsk      = rawLine.startsWith('[ASK]')
  const displayLine = isAsk ? rawLine.replace(/^\[ASK\]\s*/, '') : rawLine

  // Left column slots for CallPrepModal
  const infoContent = (
    <>
      <Field icon={Phone} label="Phone" value={lead.phone} mono />
      <Field icon={Mail}  label="Email" value={lead.email} />
      <Field icon={null}  label="Set by" value={appt.rep?.full_name} />
    </>
  )

  const statusAddon = (
    <>
      {outcome === 'closed' && (
        <Input
          type="number" value={dealValue}
          onChange={e => setDealValue(e.target.value)}
          placeholder="Deal value ($)"
          style={{ marginBottom: 8, width: '100%' }}
        />
      )}
      {outcome && !['closed', 'missed', 'needs_rescheduling'].includes(outcome) && (
        <Input
          value={lossReason}
          onChange={e => setLossReason(e.target.value)}
          placeholder="Loss reason…"
          style={{ marginBottom: 8, width: '100%' }}
        />
      )}
    </>
  )

  const callSection = lead.phone ? (
    <a
      href={`tel:${lead.phone.replace(/\D/g, '')}`}
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
  ) : null

  // SAY THIS right column
  const sayThisPanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '16px 18px' }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontWeight: 600, margin: '0 0 10px' }}>
        Say This
      </p>
      <div style={{
        flex: 1, padding: '16px 18px', borderRadius: 10,
        background: 'var(--bg-elevated)', border: '0.5px solid var(--accent-border)',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        minHeight: 0,
      }}>
        {isAsk && (
          <span style={{
            display: 'inline-block', marginBottom: 8,
            padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
            background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
            color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase',
            fontStyle: 'normal',
          }}>
            Ask
          </span>
        )}
        <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.65, margin: 0, fontStyle: 'italic', overflowY: 'auto' }}>
          {displayLine}
        </p>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '12px 0 0', fontFamily: 'var(--font-mono)' }}>
          {sayStep + 1} / {SAY_LINES.length}
        </p>
      </div>
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
  )

  return (
    <>
      {/* Card row */}
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

      {/* Detail modal */}
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
          <CallPrepModal
            lead={lead}
            onClose={() => setModalOpen(false)}
            badge={<Badge label={appt.status} />}
            subtitle={`${lead.niche || 'Close prep'} · ${lead.city || 'everything you need in one place'}`}
            infoContent={infoContent}
            statusOptions={STATUS_OPTIONS}
            status={outcome}
            statusTouched={outcomeTouched}
            onStatusSelect={v => { setOutcome(v); setOutcomeTouched(true) }}
            statusAddon={statusAddon}
            notes={notes}
            onNotesChange={e => setNotes(e.target.value)}
            callSection={callSection}
            footerHint="Select a status to finish — X discards changes"
            footerError={saveError}
            onDone={handleComplete}
            isDoneDisabled={saving || !outcomeTouched || lostLoading}
            doneLabel={saving ? 'Saving…' : lostLoading ? 'Cleaning up…' : 'Done'}
          >
            {sayThisPanel}
          </CallPrepModal>
        </div>,
        document.body
      )}
    </>
  )
}
