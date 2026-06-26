import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Mail } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { supabase } from '../../lib/supabase'
import { CLOSER_SCRIPT } from '../../lib/closerScript'
import { CallPrepModal, Field } from '../shared/CallPrepModal'

const STATUS_OPTIONS = [
  { value: 'closed',             label: 'Closed',           color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  { value: 'lost',               label: 'Lost',             color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  { value: 'no_show',            label: 'No Show',          color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  { value: 'needs_rescheduling', label: 'Needs Reschedule', color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
]

const SAY_LINES = CLOSER_SCRIPT.flatMap(s => s.lines)

export function CallModal({ appt, onClose }) {
  const lead = appt.lead

  const [outcome, setOutcome]               = useState(appt.status || 'pending')
  const [outcomeTouched, setOutcomeTouched] = useState(false)
  const [dealValue, setDealValue]           = useState('')
  const [lossReason, setLossReason]         = useState('')
  const [notes, setNotes]                   = useState(appt.closer_notes || '')
  const [lostLoading, setLostLoading]       = useState(false)
  const [saving, setSaving]                 = useState(false)
  const [saveError, setSaveError]           = useState('')
  const [sayStep, setSayStep]               = useState(0)
  const update = useUpdateAppointment()

  async function handleComplete() {
    if (!outcomeTouched) return
    setSaving(true)
    setSaveError('')
    try {
      if (outcome === 'needs_rescheduling') {
        await update.mutateAsync({ appointmentId: appt.id, updates: { status: outcome, closer_notes: notes || undefined } })
        onClose()
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
        }).catch(err => console.error('[AppointmentCardModal] create-commission-payout failed:', err))
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
          console.error('[AppointmentCardModal] cleanup-lost-demo failed:', err)
        } finally {
          setLostLoading(false)
        }
      }
      onClose()
    } catch (err) {
      setSaveError(err.message || 'Failed to save')
      setSaving(false)
    }
  }

  const infoContent = (
    <>
      <Field icon={Phone} label="Phone"  value={lead.phone} mono />
      <Field icon={Mail}  label="Email"  value={lead.email} />
      <Field icon={null}  label="Set by" value={appt.rep?.full_name} />
    </>
  )

  const statusAddon = (
    <>
      {outcomeTouched && outcome === 'closed' && (
        <Input
          type="number" value={dealValue}
          onChange={e => setDealValue(e.target.value)}
          placeholder="Deal value ($)"
          style={{ marginBottom: 8, width: '100%' }}
        />
      )}
      {outcomeTouched && outcome && !['closed', 'needs_rescheduling'].includes(outcome) && (
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
      <CallPrepModal
        lead={lead}
        onClose={onClose}
        badge={<Badge label={appt.status || 'Pending'} />}
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
        scriptLines={SAY_LINES}
        scriptStep={sayStep}
        onScriptStepChange={setSayStep}
      />
    </div>,
    document.body
  )
}
