import { useState } from 'react'
import { Check, ArrowLeft, Phone, PhoneForwarded, CalendarPlus, Save, TriangleAlert } from 'lucide-react'
import { OvField, OvSelect, StateField, LoadError } from '../agent/AgentUI'
import { NewBooking } from '../../pages/agent/BookCall'
import { useAgentRoster, useSaveQualifiedCall, useMarkLeadBooked } from '../../hooks/useVaDesk'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { digits } from '../../lib/agentBookings'

// Prompt 797 — the VA call-qualify screen on /fulfillment/desk. The VA answers
// an inbound policy-help call, asks the checklist, and ends it one of three
// ways: Save the lead, Live transfer (records the agent and a status only — no
// voice, no text), or Book on the agent's calendar (BookCall's NewBooking, so
// the carrier hours, taken times and weekly cap are the agent's own rules).
// The VA qualifies and never sells: there is no quote or price anywhere here.

const CHECKS = [
  { key: 'policyholder', label: 'Caller is the policyholder' },
  { key: 'active', label: 'Policy is active' },
  { key: 'carrier_known', label: 'Knows their carrier' },
  { key: 'wants_agent', label: 'Wants to talk to a licensed agent' },
]

const REASONS = [
  { value: 'premium', label: 'Premium question' },
  { value: 'beneficiary', label: 'Beneficiary change' },
  { value: 'coverage_review', label: 'Coverage review' },
  { value: 'replace', label: 'Cancel or replace' },
  { value: 'other', label: 'Something else' },
]

const BLANK = { first: '', last: '', phone: '', city: '', state: '' }
const NO_CHECKS = Object.fromEntries(CHECKS.map(c => [c.key, false]))

const label = { fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }
const btn = { height: 48, borderRadius: 999, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }

export default function VaDesk() {
  const roster = useAgentRoster()
  const save = useSaveQualifiedCall()
  const mark = useMarkLeadBooked()
  const [form, setForm] = useState(BLANK)
  const [checks, setChecks] = useState(NO_CHECKS)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [agentId, setAgentId] = useState('')
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [leadId, setLeadId] = useState(null)
  const [booking, setBooking] = useState(false)
  const [done, setDone] = useState(null) // { kind: 'saved' | 'transfer' | 'booked', ... }

  const agents = roster.data || []
  const agentName = agents.find(a => a.id === agentId)?.full_name || 'the agent'
  const busy = save.isPending || mark.isPending

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
    setError('')
  }
  const reset = () => {
    setForm(BLANK); setChecks(NO_CHECKS); setReason(''); setNotes(''); setAgentId('')
    setErrors(new Set()); setError(''); setLeadId(null); setBooking(false); setDone(null)
  }

  // Name and a 10-digit phone are the least a lead needs; an agent is needed to
  // transfer or book.
  function problems(needAgent) {
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (digits(form.phone).length !== 10) missing.add('phone')
    if (!form.state) missing.add('state')
    if (needAgent && !agentId) missing.add('agent')
    setErrors(missing)
    if (missing.size) {
      setError(missing.has('agent') && missing.size === 1
        ? 'Pick an agent first.'
        : missing.has('phone') && form.phone ? 'Caller phone needs all 10 digits.' : 'Fill in the highlighted fields.')
    }
    return missing.size > 0
  }

  const payload = outcome => ({
    first: titleCase(form.first.trim()), last: titleCase(form.last.trim()),
    phone: form.phone.trim(), city: titleCase(form.city.trim()), state: form.state,
    answers: { ...checks, reason: reason || null, notes: notes.trim() || null },
    outcome, agentId: agentId || null,
  })
  const fullName = `${titleCase(form.first.trim())} ${titleCase(form.last.trim())}`
  const fail = err => setError(err.message || 'Could not save this call')

  function onSave() {
    if (problems(false)) return
    save.mutate(payload('saved'), { onSuccess: () => setDone({ kind: 'saved', name: fullName }), onError: fail })
  }
  function onTransfer() {
    if (problems(true)) return
    save.mutate(payload('transfer'), { onSuccess: () => setDone({ kind: 'transfer', name: fullName, agent: agentName }), onError: fail })
  }
  function onBook() {
    if (problems(true)) return
    if (leadId) { setBooking(true); return }
    save.mutate(payload('saved'), { onSuccess: id => { setLeadId(id); setBooking(true) }, onError: fail })
  }
  function onBooked(b) {
    mark.mutate({ leadId, agentId }, { onSettled: () => setDone({ kind: 'booked', name: b.name, agent: agentName, at: b.at, tz: b.tz }) })
  }

  if (done) return <DoneCard done={done} onNext={reset} />

  if (booking) {
    return (
      <div className="va-desk">
        <button type="button" className="ov-ghost" style={{ ...btn, height: 40, padding: '0 16px', marginBottom: 12 }} onClick={() => setBooking(false)}>
          <ArrowLeft size={16} strokeWidth={2.2} />Back to the call
        </button>
        <p style={{ margin: '0 0 12px', fontSize: 13.5, color: 'var(--ov-mute)' }}>Booking {fullName} on {agentName}'s calendar. The lead is saved.</p>
        <NewBooking
          agentId={agentId} onBack={() => setBooking(false)} onBooked={onBooked}
          prefill={{ first: titleCase(form.first.trim()), last: titleCase(form.last.trim()), phone: form.phone, city: form.city, state: form.state }}
        />
      </div>
    )
  }

  return (
    <div className="va-desk" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560, margin: '0 auto', minWidth: 0 }}>
      {roster.isError && <LoadError what="the agent list" onRetry={() => roster.refetch()} />}

      <section className="ov-card" style={{ padding: '16px 16px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="ph-step-label">1 · The caller</div>
        <OvField label="First name" placeholder="First name" autoComplete="off"
          value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')} />
        <OvField label="Last name" placeholder="Last name" autoComplete="off"
          value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')} />
        <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
          value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
        <OvField label="City" optional placeholder="Pensacola" autoComplete="off"
          value={form.city} onChange={e => set('city', e.target.value)} />
        <StateField value={form.state} onChange={v => set('state', v)} error={errors.has('state')} />
      </section>

      <section className="ov-card" style={{ padding: '16px 16px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="ph-step-label">2 · Qualify</div>
        {CHECKS.map(c => {
          const on = checks[c.key]
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => setChecks(s => ({ ...s, [c.key]: !s[c.key] }))}
              className={`ov-choice${on ? ' is-on' : ''}`}
              style={{ minHeight: 48, borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', fontSize: 14.5, fontWeight: 600, color: on ? 'var(--ov-hi)' : 'var(--ov-mid)', cursor: 'pointer' }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--ov-line)', color: 'var(--ov-pick)' }}>
                {on && <Check size={14} strokeWidth={3} />}
              </span>
              {c.label}
            </button>
          )
        })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>Why they called</span>
          <OvSelect value={reason} onChange={setReason} options={REASONS} placeholder="Choose a reason" aria-label="Why they called" />
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={label}>Notes <span style={{ fontWeight: 500, color: 'var(--ov-mute)' }}>optional</span></span>
          <span className="ov-input" style={{ height: 'auto', padding: '12px 14px' }}>
            <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
              style={{ background: 'transparent', border: 0, outline: 0, color: 'inherit', font: 'inherit', resize: 'vertical', width: '100%', minWidth: 0 }} />
          </span>
        </label>
      </section>

      <section className="ov-card" style={{ padding: '16px 16px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="ph-step-label">3 · Where it goes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span id="va-agent" style={label}>Agent</span>
          <OvSelect value={agentId} onChange={v => { setAgentId(v); setError(''); setErrors(e => { const n = new Set(e); n.delete('agent'); return n }) }}
            options={agents.map(a => ({ value: a.id, label: a.full_name || 'Unnamed agent' }))}
            placeholder={roster.isLoading ? 'Loading agents…' : agents.length ? 'Choose an agent' : 'No agents available'}
            error={errors.has('agent')} aria-labelledby="va-agent" />
        </div>

        {error && (
          <div className="ov-note is-warn" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 14, fontSize: 13.5, color: 'var(--ov-hi)' }}>
            <TriangleAlert size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-warn)' }} />{error}
          </div>
        )}

        <button type="button" className="mc-btn ov-solid" style={btn} disabled={busy} onClick={onBook}>
          <CalendarPlus size={17} strokeWidth={2.2} />{save.isPending ? 'Saving…' : 'Book on agent calendar'}
        </button>
        <button type="button" className="ov-ghost" style={btn} disabled={busy} onClick={onTransfer}>
          <PhoneForwarded size={17} strokeWidth={2.2} />Live transfer
        </button>
        <button type="button" className="ov-ghost" style={btn} disabled={busy} onClick={onSave}>
          <Save size={17} strokeWidth={2.2} />Save lead
        </button>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
          Live transfer only records the agent you picked. It doesn't call or text anyone.
        </p>
      </section>
    </div>
  )
}

function DoneCard({ done, onNext }) {
  const line = done.kind === 'transfer' ? `Transfer to ${done.agent} marked as requested.`
    : done.kind === 'booked' ? `Booked on ${done.agent}'s calendar.`
      : 'Lead saved.'
  return (
    <section className="ov-card" style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px', borderRadius: 22, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <span className="ph-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      <div>
        <div className="ph-row-title" style={{ fontSize: 18 }}>{done.name}</div>
        <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ov-mid)' }}>{line}</div>
      </div>
      <button type="button" className="mc-btn ov-solid" style={{ ...btn, padding: '0 28px' }} onClick={onNext}>Next call</button>
    </section>
  )
}
