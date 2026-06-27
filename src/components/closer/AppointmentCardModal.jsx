import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Mail, StickyNote } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Input } from '../ui/Input'
import { useUpdateAppointment } from '../../hooks/useAppointments'
import { supabase } from '../../lib/supabase'
import { CLOSER_SCRIPT } from '../../lib/closerScript'
import { CallPrepModal, Field } from '../shared/CallPrepModal'

const STATUS_OPTIONS = [
  { value: 'pending',            label: 'Pending',          color: 'var(--warning)', dim: 'var(--warning-dim)', border: 'rgba(245,158,11,0.20)' },
  { value: 'closed',             label: 'Closed',           color: 'var(--success)', dim: 'var(--success-dim)', border: 'rgba(34,197,94,0.20)' },
  { value: 'lost',               label: 'Lost',             color: 'var(--danger)',  dim: 'var(--danger-dim)',  border: 'rgba(239,68,68,0.20)' },
  { value: 'no_show',            label: 'No Show',          color: '#94A3B8',        dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)' },
  { value: 'needs_rescheduling', label: 'Needs Reschedule', color: 'var(--info)',    dim: 'var(--info-dim)',    border: 'rgba(56,189,248,0.20)' },
]

// Each line carries its section color so the SAY THIS stepper can tint accordingly.
const SAY_LINES = CLOSER_SCRIPT.flatMap(s => s.lines.map(l => ({ text: l, color: s.color })))

// Fixed stack — every client gets the same core agents.
const NICHE_TO_AGENT = {
  'hvac':             'AI Receptionist',
  'electrical':       'AI Receptionist',
  'roofing':          'AI Receptionist',
  'landscaping':      'AI Receptionist',
  'pressure washing': 'AI Receptionist',
  'veterinary':       'AI Receptionist',
  'towing':           'AI Dispatcher',
  'trucking':         'AI Dispatcher',
  'hotshot':          'AI Dispatcher',
}

function getFrontRunner(niche) {
  if (!niche) return 'AI Receptionist'
  return NICHE_TO_AGENT[niche.toLowerCase()] || 'AI Receptionist'
}

const FIXED_SUB_AGENTS = [
  'Review Generation',
  'Lead Follow-Up',
  'Appointment Reminders',
  'Appointment Cancellation',
  'SMS Marketing',
]

// Price formula — mirrors edge function logic.
function calcMonthly(missed, ticket) {
  const m = parseFloat(missed)
  const t = parseFloat(ticket)
  if (!m || !t || m <= 0 || t <= 0) return null
  const raw = Math.max(399, Math.min(1999, m * 4.33 * t * 0.15))
  return Math.round((raw + 1) / 100) * 100 - 1
}


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

  // Stack checkboxes
  const [noWebsite, setNoWebsite] = useState(!lead.has_website)
  const [noChatbot, setNoChatbot] = useState(false)

  // Close section
  const [callsMissed, setCallsMissed] = useState(lead.calls_missed_per_week != null ? String(lead.calls_missed_per_week) : '')
  const [avgTicket,   setAvgTicket]   = useState(lead.avg_ticket != null ? String(lead.avg_ticket) : '')
  const [linkCopied,  setLinkCopied]  = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)

  const update = useUpdateAppointment()
  const monthlyPrice = calcMonthly(callsMissed, avgTicket)

  async function handleComplete() {
    if (!outcomeTouched) return
    setSaving(true)
    setSaveError('')
    try {
      if (outcome === 'needs_rescheduling' || outcome === 'pending') {
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

  async function generatePaymentLink() {
    if (!monthlyPrice) return
    setLinkLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-payment-link', {
        body: { monthlyPrice, businessName: lead.business_name },
      })
      if (error) throw error
      const url = data?.url
      if (url) {
        await navigator.clipboard.writeText(url)
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2000)
      }
    } catch (err) {
      console.error('[AppointmentCardModal] generatePaymentLink failed:', err)
    } finally {
      setLinkLoading(false)
    }
  }

  const frontRunner = getFrontRunner(lead.niche)

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
      {/* SETTER NOTES — rep's notes from the lead record, read-only, above closer's own CALL NOTES */}
      {lead.notes ? (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <StickyNote size={10} /> Setter Notes
          </p>
          <p style={{
            fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5,
            padding: '8px 10px',
            background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
            borderRadius: 8,
          }}>
            {lead.notes}
          </p>
        </div>
      ) : null}
    </>
  )

  const callSection = (
    <>
      {/* THE STACK */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          The Stack
        </p>
        <div style={{
          background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
          borderRadius: 8, padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {/* Front-runner — bold, auto-derived */}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
            ★ {frontRunner}
          </div>
          {/* Fixed sub-agents */}
          {FIXED_SUB_AGENTS.map(name => (
            <div key={name} style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--success)', fontSize: 10 }}>✓</span> {name}
            </div>
          ))}
          {/* Website checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: noWebsite ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={noWebsite}
              onChange={e => setNoWebsite(e.target.checked)}
              style={{ accentColor: 'var(--accent)', width: 13, height: 13 }}
            />
            Website (no website?)
          </label>
          {/* Chatbot checkbox — only relevant if website exists */}
          {!noWebsite && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: noChatbot ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={noChatbot}
                onChange={e => setNoChatbot(e.target.checked)}
                style={{ accentColor: 'var(--accent)', width: 13, height: 13 }}
              />
              AI Chatbot (no chatbot?)
            </label>
          )}
        </div>
      </div>

      {/* CLOSE — price calc + Stripe links */}
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Close
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Input
            type="number"
            value={callsMissed}
            onChange={e => setCallsMissed(e.target.value)}
            placeholder="Calls missed/week"
            style={{ flex: 1 }}
          />
          <Input
            type="number"
            value={avgTicket}
            onChange={e => setAvgTicket(e.target.value)}
            placeholder="Avg ticket $"
            style={{ flex: 1 }}
          />
        </div>
        {monthlyPrice != null && (
          <p style={{
            fontSize: 20, fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent)',
            margin: '0 0 8px',
            textAlign: 'center',
          }}>
            ${monthlyPrice.toLocaleString()}/mo
          </p>
        )}
        <button
          onClick={generatePaymentLink}
          disabled={!monthlyPrice || linkLoading}
          style={{
            width: '100%', height: 36, borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: monthlyPrice ? 'var(--accent-dim)' : 'var(--bg-elevated)',
            border: `0.5px solid ${monthlyPrice ? 'var(--accent-border)' : 'var(--border)'}`,
            color: linkCopied ? 'var(--success)' : monthlyPrice ? 'var(--accent)' : 'var(--text-muted)',
            cursor: (!monthlyPrice || linkLoading) ? 'not-allowed' : 'pointer',
            opacity: !monthlyPrice ? 0.5 : 1,
          }}
        >
          {linkLoading ? 'Generating…' : linkCopied ? 'Copied!' : 'Generate Payment Link'}
        </button>
      </div>

      {/* Call button */}
      {lead.phone ? (
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
      ) : null}
    </>
  )

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
