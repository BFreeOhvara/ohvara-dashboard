import { useMemo, useState } from 'react'
import { Check, Phone, PhoneForwarded, CalendarPlus, Save, TriangleAlert } from 'lucide-react'
import { OvField, OvSelect, LoadError } from '../agent/AgentUI'
import { useAgentRoster, useSaveQualifiedCall, useMarkLeadBooked } from '../../hooks/useVaDesk'
import { useCarriers, useCarrierHours } from '../../hooks/useCarriers'
import { useAgentBookings, useBookCall } from '../../hooks/useAgentBookings'
import { useWeeklyUsage } from '../../hooks/useBillingTiers'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import { US_STATES } from '../../lib/timezones'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { digits, stageOf, useNow } from '../../lib/agentBookings'
import { capState, formatReset } from '../../lib/billing'
import { dayIn, addDaysStr, dateLabel, dayGone, carrierDaySlots, clientSlotISO, slotState, openBookingIsos, fmtBooking } from '../../lib/scheduling'

// Prompt 797 — the VA call-qualify screen on /fulfillment/desk/qualify,
// built from the approved mockup (ohvara/leads/mockups/va-desk.html). The VA
// answers an inbound policy-help call, runs a four-item checklist (question
// type, carrier, state, urgency) and ends it one of three ways: Live transfer
// (records the agent and a status only — no voice, no text), Book on the
// agent's calendar (the carrier hours, taken times and weekly cap are the
// agent's own rules, same as BookCall) or Save lead. Transfer and Book unlock
// at 4 of 4. The VA qualifies and never sells: no quote or price here.
// The call timer is a static placeholder; there is no telephony.

const QUESTIONS = [
  { value: 'billing', label: 'Billing or payment' },
  { value: 'coverage', label: 'Coverage question' },
  { value: 'claim', label: 'Claim' },
  { value: 'beneficiary', label: 'Change beneficiary' },
  { value: 'cancel', label: 'Cancel or lapse' },
  { value: 'other', label: 'Other' },
]
const URGENCY = [
  { value: 'now', label: 'Today, right now' },
  { value: 'week', label: 'This week' },
  { value: 'asking', label: 'Just asking' },
]

const BLANK = { first: '', last: '', phone: '', city: '' }
const NO_ANSWERS = { type: '', carrierId: '', state: '', urgency: '' }
const NO_BOOKINGS = new Set()
const DAYS_SHOWN = 5
const STATE_OPTIONS = US_STATES.map(s => ({ value: s.code, label: s.name }))

const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

export default function VaDesk() {
  const roster = useAgentRoster()
  const carriersQ = useCarriers()
  const save = useSaveQualifiedCall()
  const mark = useMarkLeadBooked()
  const book = useBookCall()
  const now = useNow(30e3)

  const [form, setForm] = useState(BLANK)
  const [ans, setAns] = useState(NO_ANSWERS)
  const [transferId, setTransferId] = useState('')
  const [bookId, setBookId] = useState('')
  const [pickedDate, setPickedDate] = useState(null)
  const [slot, setSlot] = useState('')
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [leadId, setLeadId] = useState(null) // set once the lead is saved, so a retried booking never makes a second lead
  const [done, setDone] = useState(null) // { kind: 'saved' | 'transfer' | 'booked', ... }

  const agents = roster.data || []
  const carriers = carriersQ.data || []
  const agentName = id => agents.find(a => a.id === id)?.full_name || 'the agent'
  const busy = save.isPending || book.isPending || mark.isPending

  const picked = ans.carrierId ? carriers.find(c => c.id === ans.carrierId) || null : null
  const { carrier: withHours, checking } = useCarrierHours(picked)
  const carrier = picked ? withHours : null
  const { tz } = useClientTimezone(form.city, ans.state)
  const ready = !!tz && !!carrier

  const answered = [ans.type, ans.carrierId, ans.state, ans.urgency].filter(Boolean).length
  const complete = answered === 4

  // The booking card: days that still have a time open, then that day's slots.
  const { data: mine = [] } = useAgentBookings(bookId || null, { enabled: !!bookId })
  const { data: usage } = useWeeklyUsage(bookId)
  const cap = capState(usage)
  const openIsoSet = useMemo(() => (bookId ? openBookingIsos(mine, { now, stageOf }) : NO_BOOKINGS), [mine, now, bookId])
  const today = dayIn(now, tz || undefined)
  const days = useMemo(() => {
    if (!ready) return []
    const out = []
    for (let i = 0; i < 14 && out.length < DAYS_SHOWN; i++) {
      const d = addDaysStr(today, i)
      const s = carrierDaySlots(d, tz, carrier)
      if (s.length && !dayGone(d, tz, now, s)) out.push(d)
    }
    return out
  }, [ready, today, tz, carrier, now])
  const date = pickedDate && days.includes(pickedDate) ? pickedDate : days[0] || null
  const daySlots = date ? carrierDaySlots(date, tz, carrier) : []
  const slotIsOpen = s => slotState(clientSlotISO(date, s, tz), { now, openIsoSet }) === 'open'
  const slotIso = slot && date && daySlots.includes(slot) && slotIsOpen(slot) ? clientSlotISO(date, slot, tz) : null
  const capBlocks = !!cap?.blocking

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
    setError('')
  }
  const setAnswer = (k, v) => { setAns(a => ({ ...a, [k]: v })); setError('') }
  const reset = () => {
    setForm(BLANK); setAns(NO_ANSWERS); setTransferId(''); setBookId(''); setPickedDate(null); setSlot('')
    setErrors(new Set()); setError(''); setLeadId(null); setDone(null)
  }

  // Name and a 10-digit phone are the least a lead needs; booking also needs the
  // caller's city (their local time sets the slots).
  function problems(needCity) {
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (digits(form.phone).length !== 10) missing.add('phone')
    if (needCity && !form.city.trim()) missing.add('city')
    setErrors(missing)
    if (missing.size) setError(missing.has('phone') && form.phone && missing.size === 1 ? 'Caller phone needs all 10 digits.' : 'Fill in the highlighted caller fields.')
    return missing.size > 0
  }

  const fullName = `${titleCase(form.first.trim())} ${titleCase(form.last.trim())}`
  const payload = (outcome, agentId = null) => ({
    first: titleCase(form.first.trim()), last: titleCase(form.last.trim()),
    phone: form.phone.trim(), city: titleCase(form.city.trim()), state: ans.state,
    answers: { policy_question: ans.type || null, carrier: picked?.name || null, state: ans.state || null, urgency: ans.urgency || null },
    outcome, agentId,
  })
  const fail = err => setError(err?.hint === 'weekly_cap'
    ? `${err.message} Pick another agent or transfer live${usage?.week_end ? `, or wait until ${formatReset(usage.week_end)}` : ''}.`
    : err?.message || 'Could not save this call')

  function onSave() {
    if (problems(false)) return
    save.mutate(payload('saved'), { onSuccess: () => setDone({ kind: 'saved', name: fullName }), onError: fail })
  }
  function onTransfer() {
    if (!complete || problems(false)) return
    if (!transferId) { setError('Pick an agent to transfer to.'); return }
    save.mutate(payload('transfer', transferId), { onSuccess: () => setDone({ kind: 'transfer', name: fullName, agent: agentName(transferId) }), onError: fail })
  }
  async function onBook() {
    if (!complete || problems(true)) return
    if (!bookId) { setError('Pick an agent to book with.'); return }
    if (!slotIso) { setError('Pick a day and a time.'); return }
    try {
      let id = leadId
      if (!id) { id = await save.mutateAsync(payload('saved')); setLeadId(id) }
      await book.mutateAsync({
        agentId: bookId, firstName: titleCase(form.first.trim()), lastName: titleCase(form.last.trim()),
        phone: form.phone.trim(), city: titleCase(form.city.trim()), state: ans.state, timezone: tz,
        carrierId: picked.id, currentCarrier: picked.name, scheduledAt: slotIso, smsConsent: false,
      })
      await mark.mutateAsync({ leadId: id, agentId: bookId }).catch(() => {})
      setDone({ kind: 'booked', name: fullName, agent: agentName(bookId), at: slotIso, tz })
    } catch (err) { fail(err) }
  }

  if (done) return <DoneCard done={done} onNext={reset} />

  const localTime = tz ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(now) : '—'
  const where = [titleCase(form.city.trim()), ans.state].filter(Boolean).join(', ') || '—'
  const stateLabel = STATE_OPTIONS.find(o => o.value === ans.state)?.label

  return (
    <div className="va-desk" style={{ maxWidth: 1100, margin: '0 auto', minWidth: 0 }}>
      {(roster.isError || carriersQ.isError) && (
        <LoadError what={roster.isError ? 'the agent list' : 'the carrier list'}
          onRetry={() => (roster.isError ? roster.refetch() : carriersQ.refetch())} style={{ marginBottom: 14 }} />
      )}
      <div className="va-grid">
        <div className="va-col">
          <div className="ov-hero" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="va-pill is-live"><i className="va-dot" />On call</span>
              <span className="va-pill">Google Ads · policy help</span>
              <span className="va-pill" style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }} title="Call timer is a placeholder">--:--</span>
            </div>
            <h1 style={{ margin: '12px 0 0', fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em', overflowWrap: 'anywhere' }}>
              {form.first.trim() || form.last.trim() ? fullName : 'Caller name'}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--ov-hero-soft)' }}>
              Inbound call. Qualify only, then hand off to a licensed agent.
            </p>
            <dl className="va-facts">
              <div><dt>Phone</dt><dd>{form.phone || '—'}</dd></div>
              <div><dt>Caller's local time</dt><dd>{localTime}</dd></div>
              <div><dt>City, state</dt><dd>{where}</dd></div>
              <div><dt>Ad campaign</dt><dd>Policy help</dd></div>
            </dl>
          </div>

          <section className="ov-card" style={{ padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)' }}>Caller</h2>
            <OvField label="First name" placeholder="First name" autoComplete="off"
              value={form.first} onChange={e => setField('first', e.target.value)} error={errors.has('first')} />
            <OvField label="Last name" placeholder="Last name" autoComplete="off"
              value={form.last} onChange={e => setField('last', e.target.value)} error={errors.has('last')} />
            <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
              value={form.phone} onChange={e => setField('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
            <OvField label="City" optional placeholder="Pensacola" autoComplete="off"
              value={form.city} onChange={e => setField('city', e.target.value)} error={errors.has('city')} />
          </section>

          <section className="ov-card" style={{ padding: '16px 16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)' }}>Qualify checklist</h2>
              <span style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--ov-mute)', fontVariantNumeric: 'tabular-nums' }}>{answered} of 4</span>
            </div>
            <div className="va-bar" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={answered} aria-label="Checklist progress">
              <i style={{ width: `${answered * 25}%` }} />
            </div>

            <Question label="Policy question type" done={!!ans.type}>
              <Chips options={QUESTIONS} value={ans.type} onChange={v => setAnswer('type', v)} />
            </Question>
            <Question label="Carrier" done={!!ans.carrierId}>
              <div style={{ marginTop: 8 }}>
                <OvSelect value={ans.carrierId} onChange={v => { setAnswer('carrierId', v); setSlot('') }}
                  options={carriers.map(c => ({ value: c.id, label: c.name }))}
                  placeholder={carriersQ.isLoading ? 'Loading carriers…' : 'Choose a carrier'} aria-label="Carrier" />
              </div>
            </Question>
            <Question label="State" done={!!ans.state}>
              <div style={{ marginTop: 8 }}>
                <OvSelect value={ans.state} onChange={v => { setAnswer('state', v); setSlot('') }}
                  options={STATE_OPTIONS} placeholder="Choose a state" aria-label="State" />
              </div>
            </Question>
            <Question label="Urgency" done={!!ans.urgency}>
              <Chips options={URGENCY} value={ans.urgency} onChange={v => setAnswer('urgency', v)} />
            </Question>
          </section>
        </div>

        <div className="va-col">
          <div style={{ color: 'var(--ov-mute)', fontSize: 12.5, margin: '0 4px -6px' }}>
            {complete ? 'Choose an outcome' : 'Choose an outcome (Live transfer and Book unlock when the checklist is 4 of 4)'}
          </div>

          <section className="ov-card" style={{ padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)' }}>Live transfer to agent</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>
              Records the agent and a status only. It doesn't call or text anyone.
            </p>
            {!agents.length && !roster.isLoading && (
              <p style={{ margin: '8px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>No agents available.</p>
            )}
            {agents.map(a => {
              const on = transferId === a.id
              return (
                <button key={a.id} type="button" aria-pressed={on} className={`va-agent ov-choice${on ? ' is-on' : ''}`}
                  onClick={() => { setTransferId(a.id); setError('') }}>
                  <span className="va-avatar" aria-hidden="true">{initials(a.full_name)}</span>
                  <span style={{ minWidth: 0, fontWeight: 600, fontSize: 14.5, overflowWrap: 'anywhere' }}>{a.full_name || 'Unnamed agent'}</span>
                </button>
              )
            })}
            <button type="button" className="va-go ov-solid mc-btn" disabled={!complete || busy || !transferId} onClick={onTransfer}>
              <PhoneForwarded size={17} strokeWidth={2.2} />
              {transferId ? `Transfer to ${agentName(transferId)}` : 'Pick an agent to transfer'}
            </button>
          </section>

          <section className="ov-card" style={{ padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)' }}>Book on agent calendar</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>
              {ready
                ? `Times are ${titleCase(form.city.trim())}'s local time. Slots follow ${carrier.name}'s call hours.`
                : checking ? `Checking ${picked.name}'s hours…`
                  : 'Pick the carrier and state, and add the caller’s city, to see times.'}
            </p>
            <div style={{ marginTop: 8 }}>
              <OvSelect value={bookId} onChange={v => { setBookId(v); setSlot(''); setError('') }}
                options={agents.map(a => ({ value: a.id, label: a.full_name || 'Unnamed agent' }))}
                placeholder={roster.isLoading ? 'Loading agents…' : 'Choose an agent'} aria-label="Agent to book with" />
            </div>
            {cap?.atCap && (
              <div className="va-cap" role="alert">
                {agentName(bookId)} is at the weekly booking cap ({cap.used} of {cap.cap}).{' '}
                {capBlocks ? 'Pick another agent or transfer live.' : 'The cap is not enforced yet, so booking still works.'}
              </div>
            )}
            <div aria-disabled={!ready || undefined} style={!ready ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
              <div className="va-days" role="group" aria-label="Day">
                {(days.length ? days : []).map(d => {
                  const on = d === date
                  const [wd] = dateLabel(d, 'short').split(',')
                  return (
                    <button key={d} type="button" aria-pressed={on} className={`ov-choice${on ? ' is-on' : ''}`}
                      onClick={() => { setPickedDate(d); setSlot('') }}>
                      <span>{wd}</span><b>{Number(d.slice(8))}</b>
                    </button>
                  )
                })}
              </div>
              <div className="va-slots" role="group" aria-label="Time">
                {daySlots.map(s => {
                  const open = slotIsOpen(s)
                  const on = open && s === slot
                  return (
                    <button key={s} type="button" aria-pressed={on} disabled={!open || capBlocks}
                      className={`ov-choice${on ? ' is-on' : ''}`} onClick={() => setSlot(s)}>{s}</button>
                  )
                })}
              </div>
            </div>
            <button type="button" className="va-go ov-solid mc-btn" disabled={!complete || busy || capBlocks} onClick={onBook}>
              <CalendarPlus size={17} strokeWidth={2.2} />
              {save.isPending || book.isPending ? 'Booking…' : slotIso ? `Book ${fmtBooking(slotIso, tz)}` : 'Book'}
            </button>
          </section>

          {error && (
            <div className="ov-note is-warn" role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 14, fontSize: 13.5, color: 'var(--ov-hi)' }}>
              <TriangleAlert size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-warn)' }} />{error}
            </div>
          )}

          <section className="ov-card" style={{ padding: 16 }}>
            <button type="button" className="va-go ov-ghost" style={{ marginTop: 0 }} disabled={busy} onClick={onSave}>
              <Save size={17} strokeWidth={2.2} />{save.isPending && !done ? 'Saving…' : 'Save lead'}
            </button>
            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ov-mute)' }}>
              Keeps the call as a lead without a transfer or booking{stateLabel ? ` (${stateLabel})` : ''}.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function Question({ label, done, children }) {
  return (
    <div className={`va-q${done ? ' is-done' : ''}`}>
      <div className="va-ql">
        <span className="va-tick" aria-hidden="true">{done && <Check size={12} strokeWidth={3} />}</span>
        {label}
      </div>
      {children}
    </div>
  )
}

function Chips({ options, value, onChange }) {
  return (
    <div className="va-chips" role="group">
      {options.map(o => {
        const on = value === o.value
        return (
          <button key={o.value} type="button" aria-pressed={on} className={`ov-choice${on ? ' is-on' : ''}`} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function DoneCard({ done, onNext }) {
  const line = done.kind === 'transfer' ? `Transfer to ${done.agent} marked as requested.`
    : done.kind === 'booked' ? `Booked on ${done.agent}'s calendar for ${fmtBooking(done.at, done.tz)}.`
      : 'Lead saved.'
  return (
    <section className="ov-card" style={{ maxWidth: 560, margin: '0 auto', padding: '28px 20px', borderRadius: 22, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <span className="ph-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
      <div>
        <div className="ph-row-title" style={{ fontSize: 18 }}>{done.name}</div>
        <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ov-mid)' }}>{line}</div>
      </div>
      <button type="button" className="mc-btn ov-solid" style={{ height: 48, borderRadius: 999, fontSize: 15, fontWeight: 600, padding: '0 28px', cursor: 'pointer' }} onClick={onNext}>Next call</button>
    </section>
  )
}
