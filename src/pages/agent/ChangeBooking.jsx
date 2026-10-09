import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Calendar, Info, Search, Check, CircleCheck, TriangleAlert, PencilLine, ArrowRight, ArrowLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useCarrierHours, useAddCarrier } from '../../hooks/useCarriers'
import { useAgentBookings, useChangeBooking } from '../../hooks/useAgentBookings'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import { useWeeklyUsage } from '../../hooks/useBillingTiers'
import {
  StepHead, OvField, StateField, CarrierInput, ChangedMark, DayChoice, SlotGrid, SlotSkeleton, WeeklyUsage,
  ClientAvatar, BookError, StatusAvatar, StatusPill,
} from '../../components/agent/AgentUI'
import { formatPhoneInput, titleCase, fullName } from '../../lib/policyFormat'
import {
  callWhen, callAt, clientSlotISO, slotState, openBookingIsos, dayIn, addDaysStr, dateLabel, dayGone, carrierDaySlots, firstOpenDay, callMisfit,
} from '../../lib/scheduling'
import { bookingCarrier, hoursSummary } from '../../lib/carriers'
import { stageOf, agentStageOf, tabOf, isLive, digits, useNow, placeOf } from '../../lib/agentBookings'
import { capState } from '../../lib/billing'
import { DISPLAY } from '../../lib/exportStyles'

// Change a booking (Prompt 730) — the second mode of Book a call. The agent
// finds a client they've booked (type-ahead over their own bookings), checks
// the saved details and fixes what's wrong, and keeps the call time or picks a
// new one. Saving applies at once (agent_change_booking, migration 134): one
// update to the same booking, so it never uses one of the week's bookings.
//
// Who can be changed: Booked (not on a call), No answer and Needs attention →
// Call and rebook. Cancelled, live and Confirm-number clients are left out of
// the search entirely (Prompt 732). A Booked call Fulfillment has already worked can have its details
// fixed but not its time (the database refuses it, same rule as the old move).
// A No answer / Needs attention lead has to get a new time: saving re-books it.
//
// Same fields, rules and pieces as New booking: the client's zone is worked
// out from city + state and never shown, the carrier's hours set the slots,
// and 30 minutes' notice / your other bookings still grey slots out.

const EMPTY = { first: '', last: '', phone: '', city: '', state: '', carrier: '', carrierId: null }
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const MATCHES = 6

// A saved phone in the (602) 555-0184 mask; a leading US 1 is dropped.
function phoneOf(raw) {
  let d = digits(raw)
  if (d.length === 11 && d[0] === '1') d = d.slice(1)
  return formatPhoneInput(d)
}

// What the booking has saved, as form values.
function savedOf(p, carriers) {
  if (!p) return EMPTY
  const c = bookingCarrier(carriers, p)
  return {
    first: (p.client_first_name || '').trim(),
    last: (p.client_last_name || '').trim(),
    phone: phoneOf(p.client_phone),
    city: (p.client_city || '').trim(),
    state: p.state || '',
    carrier: c?.name || p.carrier_name || p.current_carrier || '',
    carrierId: c?.id || null,
  }
}

// Why a booking can't be changed here, or null.
function blockOf(p) {
  if (stageOf(p) === 'cancelled') return "Can't be changed"
  if (isLive(p)) return 'On a call right now'
  if (agentStageOf(p) === 'confirmNumber') return 'Confirm their number first'
  return null
}

// Prompt 732 — the type-ahead lists only clients whose booking can be changed:
// Booked, No answer, or Needs attention → Call and rebook, by the same tabOf()
// My Pipeline's tabs use. Cancelled, on-a-call-now and Confirm the number are
// left out of the list entirely (blockOf still explains a deep link to one).
function isChangeable(p) {
  if (isLive(p)) return false
  const t = tabOf(p)
  return t === 'booked' || t === 'noAnswer' || (t === 'needs' && agentStageOf(p) === 'needsAttention')
}

// First name, last name or full name starts with the query; or, for a query
// of digits, the phone contains them.
function matchBookings(rows, query) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return []
  const qd = digits(q)
  const phoneQuery = qd.length >= 2 && /^[\d\s()+.-]+$/.test(q)
  return rows
    .filter(p => {
      const first = (p.client_first_name || '').trim().toLowerCase()
      const last = (p.client_last_name || '').trim().toLowerCase()
      if (phoneQuery) return digits(p.client_phone).includes(qd)
      return first.startsWith(q) || last.startsWith(q) || `${first} ${last}`.startsWith(q)
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { numeric: true }))
    .slice(0, MATCHES)
}

export default function ChangeBooking({ policyId, onPick, switcher, onNew }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const { data: rows = [], isLoading } = useAgentBookings(isAdmin ? null : profile?.id)
  const [done, setDone] = useState(null)

  const p = policyId ? rows.find(r => r.id === policyId) || null : null
  const blocked = p ? blockOf(p) : null
  const target = p && !blocked ? p : null

  if (done) {
    return (
      <SavedCard
        {...done}
        onPipeline={() => navigate(`/agent/clients?open=${done.id}`)}
        onAnother={() => { setDone(null); onPick('') }}
      />
    )
  }

  let pickNote = null
  if (policyId && p && blocked) pickNote = `${fullName(p)}: ${blocked.toLowerCase()}.`
  else if (policyId && !p && !isLoading) pickNote = "We couldn't find that booking. Search for the client instead."

  return (
    <ChangeForm
      key={target?.id || 'none'} p={target} rows={rows} isAdmin={isAdmin} profileId={profile?.id}
      switcher={switcher} onNew={onNew} onPick={onPick} pickNote={pickNote} loading={isLoading && !!policyId}
      onSaved={setDone}
    />
  )
}

function ChangeForm({ p, rows, profileId, switcher, onNew, onPick, pickNote, loading, onSaved }) {
  const now = useNow(30e3)
  const { data: carriers = [] } = useCarriers()
  const { data: usage } = useWeeklyUsage(profileId)
  const cap = capState(usage)
  const change = useChangeBooking()
  const addCarrier = useAddCarrier()
  const dateInput = useRef(null)

  // The form is the saved values with the agent's edits on top, so putting
  // a value back clears its "Changed" marker by itself.
  const saved = useMemo(() => savedOf(p, carriers), [p, carriers])
  const [edits, setEdits] = useState({})
  const form = { ...saved, ...edits }
  const [modeChoice, setModeChoice] = useState('keep')
  const [pickedDate, setPickedDate] = useState(null)
  const [slot, setSlot] = useState('')
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')

  const clearErr = k => setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
  const set = (k, v) => { setEdits(e => ({ ...e, [k]: v })); clearErr(k); setError('') }
  const typeCarrier = v => { setEdits(e => ({ ...e, carrier: v, carrierId: null })); clearErr('carrier') }
  const pickCarrier = c => { setEdits(e => ({ ...e, carrier: c.name, carrierId: c.id })); clearErr('carrier') }
  const keepTypedCarrier = name => addCarrier.mutate(name, {
    onSuccess: row => row?.id && pickCarrier(row),
    onError: err => setError(err.message || 'Could not add that carrier'),
  })

  // ── what changed ──
  const changed = {
    first: form.first.trim() !== saved.first,
    last: form.last.trim() !== saved.last,
    phone: digits(form.phone) !== digits(saved.phone),
    city: form.city.trim() !== saved.city,
    state: form.state !== saved.state,
    carrier: form.carrierId !== saved.carrierId || (!form.carrierId && form.carrier.trim() !== saved.carrier),
  }
  const detailsChanged = !!p && Object.values(changed).some(Boolean)

  // ── zone + carrier hours ──
  const { tz: typedTz, resolving } = useClientTimezone(form.city, form.state)
  const placeChanged = changed.city || changed.state
  const tz = p && !placeChanged && p.client_timezone ? p.client_timezone : typedTz
  const picked = form.carrierId ? carriers.find(c => c.id === form.carrierId) || null : null
  const { carrier: withHours, checking } = useCarrierHours(p ? picked : null)
  const carrier = picked ? withHours : null
  const ready = !!p && !!tz && !!carrier

  // ── the call time ──
  const rebook = !!p && stageOf(p) === 'noAnswer'
  const currentIso = p?.scheduled_call_at || null
  const currentPast = !currentIso || new Date(currentIso).getTime() <= now
  const canMove = !!p && (rebook || ((p.call_attempts || 0) === 0 && p.fulfillment_stage === 'Pending'))
  // A new carrier or a new place re-checks the time they already have.
  const recheck = !!p && (changed.carrier || (tz || null) !== (p.client_timezone || null))
  const checkingTime = recheck && !ready && (resolving || checking)
  const misfit = recheck && ready ? callMisfit(currentIso, tz, carrier) : null
  const city = form.city.trim() ? titleCase(form.city.trim()) : 'the client'
  const keepReason = !p || rebook ? null
    : currentPast ? 'That time has already passed. Pick a new time.'
      : misfit === 'carrier' ? `${carrier.name} doesn't take calls then. Pick a new time.`
        : misfit === 'clock' ? `That's outside ${city}'s calling hours. Pick a new time.`
          : null
  const keepOk = !!p && !rebook && !keepReason
  const mode = !p ? 'keep' : rebook ? 'new' : !canMove ? 'keep' : keepOk ? modeChoice : 'new'

  const today = dayIn(now, tz || undefined)
  const tomorrow = addDaysStr(today, 1)
  const slotsOn = d => (ready && d ? carrierDaySlots(d, tz, carrier) : [])
  const currentDay = currentIso && !currentPast && tz ? dayIn(new Date(currentIso).getTime(), tz) : null
  const defaultDay = !ready ? null
    : currentDay && !dayGone(currentDay, tz, now, slotsOn(currentDay)) ? currentDay
      : firstOpenDay(today, tz, carrier, now)
  const date = !ready ? null : pickedDate && pickedDate >= today ? pickedDate : defaultDay
  const daySlots = slotsOn(date)
  const agentRows = useMemo(() => (p ? rows.filter(r => r.agent_id === p.agent_id) : []), [rows, p])
  const openIsoSet = useMemo(() => openBookingIsos(agentRows, { now, exceptId: p?.id, stageOf }), [agentRows, now, p?.id])
  const slotIso = slot && date && daySlots.includes(slot) ? clientSlotISO(date, slot, tz) : null
  const slotOpen = !!slotIso && slotState(slotIso, { now, openIsoSet }) === 'open'
  const newAt = mode === 'new' && slotOpen ? slotIso : null
  const timeChanged = !!newAt && (rebook || new Date(newAt).getTime() !== new Date(currentIso).getTime())
  const anyChange = rebook ? timeChanged : detailsChanged || timeChanged

  const pickDate = d => { setPickedDate(d); setSlot('') }
  const pickSlot = s => { setSlot(s); clearErr('slot'); setError('') }
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }

  // ── save ──
  function save() {
    setError('')
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (digits(form.phone).length !== 10) missing.add('phone')
    if (!form.city.trim()) missing.add('city')
    if (!form.state) missing.add('state')
    if (!picked) missing.add('carrier')
    if (mode === 'new' && !newAt) missing.add('slot')
    if (missing.size) {
      setErrors(missing)
      setError(missing.has('phone') && form.phone
        ? 'Client phone needs all 10 digits.'
        : missing.has('carrier') && form.carrier.trim()
          ? 'Pick the carrier from the list, or choose "Use" to keep what you typed.'
          : missing.has('slot') && missing.size === 1 ? 'Pick a new time.' : 'Fill in the highlighted fields.')
      return
    }
    if (!tz || checkingTime) { setError('Still working out their local time. Try again in a moment.'); return }
    // Untouched fields go back exactly as saved, so only real edits count.
    const firstName = changed.first ? titleCase(form.first) : p.client_first_name
    const lastName = changed.last ? titleCase(form.last) : p.client_last_name
    const cityOut = changed.city ? titleCase(form.city.trim()) : p.client_city
    change.mutate({
      id: p.id, firstName, lastName,
      phone: changed.phone ? form.phone.trim() : p.client_phone,
      city: cityOut, state: form.state, timezone: tz, carrierId: picked.id,
      scheduledAt: timeChanged ? newAt : null,
    }, {
      onSuccess: () => onSaved({
        id: p.id, name: `${firstName} ${lastName}`.trim(), at: timeChanged ? newAt : currentIso, tz, rebook,
      }),
      onError: err => setError(err.message || 'Could not save the change'),
    })
  }

  // ── summary rows: only what differs ──
  const name = [form.first.trim(), form.last.trim()].filter(Boolean).join(' ')
  const savedName = [saved.first, saved.last].filter(Boolean).join(' ')
  const savedPlace = p ? placeOf(p) : ''
  const place = form.city.trim() && form.state ? `${titleCase(form.city.trim())}, ${form.state}` : ''
  const diffs = []
  if (changed.first || changed.last) diffs.push({ label: 'Name', from: savedName, to: name })
  if (changed.phone) diffs.push({ label: 'Phone', from: saved.phone, to: form.phone })
  if (placeChanged) diffs.push({ label: 'Where they live', from: savedPlace, to: place })
  if (changed.carrier) diffs.push({ label: "Carrier they're leaving", from: saved.carrier, to: picked?.name || form.carrier.trim() })
  if (timeChanged) diffs.push({ label: 'Call time', from: callWhen(currentIso, tz), to: callWhen(newAt, tz) })
  const timeLine = !p || timeChanged ? null
    : mode === 'keep' && currentIso ? `Stays ${callWhen(currentIso, tz || p.client_timezone)}`
      : 'Pick a new time'

  const busy = change.isPending
  const saveLabel = busy ? 'Saving…' : rebook ? 'Save and re-book' : 'Save changes'
  const summary = {
    p, name, phone: form.phone.trim(), place, diffs, timeLine,
    onSave: save, busy, disabled: !p || !anyChange || busy || checkingTime, saveLabel, error,
  }

  // ── step 2 notes ──
  const was = (k, v) => (changed[k] ? <ChangedMark was={v} /> : null)
  const hoursLine = !ready ? null : carrier.hours_status === 'fallback'
    ? `We couldn't find ${carrier.name}'s hours, so we're using 9–5 Eastern. Fulfillment will confirm.`
    : `${carrier.name} takes calls ${hoursSummary(carrier.hours, carrier.hours_tz)} · times shown are ${city}'s local time.`
  const fields = 'grid grid-cols-1 sm:grid-cols-3 gap-y-[18px] sm:gap-4'
  const dimStyle = { opacity: 0.5, pointerEvents: 'none' }

  // ── step 3 ──
  const isOther = !!date && date !== today && date !== tomorrow
  const todayGone = ready && dayGone(today, tz, now, slotsOn(today))
  const tomorrowGone = ready && dayGone(tomorrow, tz, now, slotsOn(tomorrow))
  const closedText = ready ? `${carrier.name} doesn't take calls that day. Pick another day.` : null
  const currentText = currentIso ? callWhen(currentIso, tz || p?.client_timezone) : '—'

  return (
    <div className="pb-[110px] sm:pb-0">
      {switcher}
      <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--ov-mute)' }}>
        Fix a client's details or move their call. Changes never use a booking.
      </p>

      <div className="ov-book">
        <div className="flex flex-col gap-[14px] sm:gap-5" style={{ minWidth: 0 }}>
          <section className="ov-card flex flex-col gap-[18px] sm:gap-5 px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead n={1} title="Which client?" sub="Type a name or phone number. It searches everyone you've booked." />
            {p ? (
              <PickedClient p={p} onChange={() => onPick('')} />
            ) : loading ? (
              <p role="status" style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mid)' }}>Loading your bookings…</p>
            ) : (
              <ClientPicker rows={rows} now={now} onPick={r => onPick(r.id)} onNew={onNew} note={pickNote} />
            )}
          </section>

          <section className="ov-card flex flex-col gap-[18px] sm:gap-5 px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead n={2} title="Check their details" sub="Fix anything that's wrong. Whatever you leave stays as it is." />
            <div aria-disabled={!p || undefined} className="flex flex-col gap-[18px] sm:gap-5" style={p ? undefined : dimStyle}>
              <div className={fields}>
                <OvField label="First name" placeholder="First name" autoComplete="off" disabled={!p}
                  value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')}
                  changed={changed.first} note={was('first', saved.first)} />
                <OvField label="Last name" placeholder="Last name" autoComplete="off" disabled={!p}
                  value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')}
                  changed={changed.last} note={was('last', saved.last)} />
                <OvField label="Phone" icon={Phone} placeholder="Phone" inputMode="tel" autoComplete="off" disabled={!p}
                  value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')}
                  changed={changed.phone} note={was('phone', saved.phone)} />
              </div>
              <div className={fields}>
                <OvField label="City" placeholder="City" autoComplete="off" disabled={!p}
                  value={form.city} onChange={e => set('city', e.target.value)} error={errors.has('city')}
                  changed={changed.city} note={was('city', saved.city)} />
                <StateField value={form.state} onChange={v => set('state', v)} error={errors.has('state')}
                  changed={changed.state} note={was('state', saved.state)} />
                <CarrierInput
                  carriers={carriers} text={form.carrier} picked={picked} error={errors.has('carrier')}
                  onText={typeCarrier} onPick={pickCarrier} onUseText={keepTypedCarrier} adding={addCarrier.isPending}
                  changed={changed.carrier} note={was('carrier', saved.carrier)}
                />
              </div>
              {p && checking && (
                <p role="status" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mid)' }}>Checking {picked.name}'s hours…</p>
              )}
              {hoursLine && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)' }}>{hoursLine}</p>}
            </div>
          </section>

          <section className="ov-card flex flex-col gap-4 sm:gap-[18px] px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead
              n={3} title="Call time"
              sub={rebook ? "They missed the last call, so pick a new time. Times are the client's local time." : "Keep it, or pick a new one. Times are the client's local time."}
            />
            <div className="flex flex-col gap-4 sm:gap-[18px]" aria-disabled={!p || undefined} style={p ? undefined : dimStyle}>
              {rebook ? (
                <Note icon={TriangleAlert} tone="warn">
                  The last call ({currentText}) wasn't answered. Saving books this new time and puts them back on Booked.
                </Note>
              ) : (
                <div className="flex flex-col sm:flex-row gap-[10px] sm:gap-3">
                  <DayChoice
                    label="Keep the current time" long={currentText} on={!!p && mode === 'keep'}
                    disabled={!p || (canMove && !keepOk)} onClick={() => setModeChoice('keep')}
                  />
                  <DayChoice
                    label="Pick a new time" long="Another day or time" on={!!p && mode === 'new'}
                    disabled={!p || !canMove} onClick={() => setModeChoice('new')}
                  />
                </div>
              )}

              {p && !rebook && !canMove && (
                <Note icon={Info}>Fulfillment has already called this one, so the time stays. Message them if it needs to move.</Note>
              )}
              {p && canMove && keepReason && <Note icon={TriangleAlert} tone="warn">{keepReason}</Note>}
              {p && checkingTime && <p role="status" style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mid)' }}>Checking the time still works…</p>}
              {p && mode === 'keep' && recheck && ready && !keepReason && (
                <Note icon={CircleCheck} tone="ok">
                  {new Date(currentIso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })} still works with {carrier.name}'s hours.
                </Note>
              )}

              {p && mode === 'new' && (
                <>
                  {!rebook && <div style={{ height: 1, background: 'var(--ov-stub)' }} />}
                  <div aria-busy={resolving || checking || undefined} className="flex flex-col gap-4 sm:gap-[18px]" style={ready ? undefined : dimStyle}>
                    <div className="flex gap-[10px] sm:gap-3">
                      <DayChoice
                        label="Today" on={!!date && date === today} disabled={!ready || todayGone} onClick={() => pickDate(today)}
                        long={dateLabel(today, 'long')} short={dateLabel(today, 'short')}
                      />
                      <DayChoice
                        label="Tomorrow" on={!!date && date === tomorrow} disabled={!ready || tomorrowGone} onClick={() => pickDate(tomorrow)}
                        long={dateLabel(tomorrow, 'long')} short={dateLabel(tomorrow, 'short')}
                      />
                      <DayChoice
                        className="hidden sm:flex" label="Another day" on={isOther} disabled={!ready} icon={Calendar} onClick={openPicker}
                        long={isOther ? dateLabel(date, 'short') : 'Pick a date'}
                      />
                    </div>
                    <button
                      type="button" onClick={openPicker} aria-pressed={isOther} disabled={!ready}
                      className={`ov-choice flex sm:hidden${isOther ? ' is-on' : ''}`}
                      style={{
                        height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 9,
                        fontSize: 14.5, fontWeight: 600, color: isOther ? 'var(--ov-hi)' : 'var(--ov-mid)',
                      }}
                    >
                      <Calendar size={17} strokeWidth={1.9} style={{ color: isOther ? 'var(--ov-pick)' : undefined }} />
                      {isOther ? dateLabel(date, 'short') : 'Another day'}
                    </button>
                    <input
                      ref={dateInput} type="date" value={date || ''} min={today} tabIndex={-1} aria-label="Pick another day"
                      onChange={e => e.target.value && pickDate(e.target.value)}
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
                    />
                    {checking ? <SlotSkeleton /> : ready ? (
                      <SlotGrid
                        date={date} slot={slotOpen ? slot : ''} onSlot={pickSlot} error={errors.has('slot')} now={now}
                        tz={tz} openIsoSet={openIsoSet} slots={daySlots} emptyText={closedText} currentIso={currentPast ? null : currentIso}
                      />
                    ) : (
                      <Note icon={Info}>Add their city, state and carrier first, then pick a day and time.</Note>
                    )}
                  </div>
                  <Note icon={Info}>
                    {rebook ? '' : 'The dashed one is their current time. '}A time you've already booked for someone else is taken, and calls need 30 minutes' notice.
                  </Note>
                </>
              )}
            </div>
          </section>
        </div>

        <div className="ov-book-side hidden sm:flex" style={{ flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <ChangeSummary {...summary} />
          <UsageNote cap={cap} />
        </div>
      </div>

      <ChangeSummary {...summary} bar />
    </div>
  )
}

// A quiet note; `warn` amber, `ok` green.
function Note({ icon: Icon, tone, children }) {
  const color = tone === 'warn' ? 'var(--ov-warn)' : tone === 'ok' ? 'var(--ov-st-cancelled)' : 'var(--ov-mute)'
  return (
    <div className={`ov-note${tone === 'warn' ? ' is-warn' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
      <Icon size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color }} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: tone === 'ok' ? 'var(--ov-st-cancelled)' : 'var(--ov-mid)' }}>{children}</p>
    </div>
  )
}

// Step 1: the type-ahead over the agent's bookings.
function ClientPicker({ rows, now, onPick, onNew, note }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const matches = useMemo(() => matchBookings(rows.filter(isChangeable), query), [rows, query])
  const at = Math.min(active, Math.max(matches.length - 1, 0))
  const listId = 'change-client-list'

  const choose = r => { if (r) onPick(r) }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setActive(Math.min(at + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setActive(Math.max(at - 1, 0)) }
    else if (e.key === 'Enter' && matches.length) { e.preventDefault(); choose(matches[at]) }
    else if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); setActive(0) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label htmlFor="change-client" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-mid)' }}>Client</label>
      <span className="ov-input">
        <Search size={17} strokeWidth={1.9} style={{ flexShrink: 0 }} />
        <input
          id="change-client" value={query} autoFocus autoComplete="off" spellCheck={false} placeholder="Name or phone number"
          role="combobox" aria-expanded={matches.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={matches.length ? `${listId}-${at}` : undefined}
          onChange={e => { setQuery(e.target.value); setActive(0) }} onKeyDown={onKeyDown}
        />
      </span>
      {note && <Note icon={Info}>{note}</Note>}
      {!query.trim() ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ov-mute)' }}>Type a name or phone number.</p>
      ) : !matches.length ? (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
          No client matches. To add a new one, use{' '}
          <button type="button" onClick={onNew} style={{ padding: 0, border: 'none', background: 'none', font: 'inherit', fontWeight: 600, color: 'var(--ov-pick)', cursor: 'pointer' }}>
            New booking
          </button>.
        </p>
      ) : (
        <div className="ov-note" style={{ borderRadius: 14, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div id={listId} role="listbox" aria-label="Clients" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {matches.map((r, i) => {
              return (
                <div
                  key={r.id} id={`${listId}-${i}`} role="option" aria-selected={i === at}
                  className={`ov-pickrow${i === at ? ' is-active' : ''}`}
                  onMouseDown={e => { e.preventDefault(); choose(r) }} onMouseEnter={() => setActive(i)}
                >
                  <StatusAvatar name={fullName(r)} tab={tabOf(r)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)', ...ellipsis }}>{fullName(r)}</div>
                    <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis }}>
                      {[placeOf(r), r.client_phone].filter(Boolean).join(' · ') || 'No details yet'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, maxWidth: '45%' }}>
                    <StatusPill tab={tabOf(r)} />
                    <span style={{ fontSize: 12.5, color: 'var(--ov-mute)', ...ellipsis, maxWidth: '100%' }}>
                      {r.scheduled_call_at && new Date(r.scheduled_call_at).getTime() > now ? callWhen(r.scheduled_call_at, r.client_timezone) : 'Needs a new time'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="hidden sm:flex" style={{ justifyContent: 'space-between', gap: 12, padding: '6px 10px 4px', fontSize: 12, color: 'var(--ov-mute)' }}>
            <span>{matches.length} {matches.length === 1 ? 'match' : 'matches'}</span>
            <span>↑ ↓ to move · Enter to pick</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Step 1 once a client is picked: one line, with a way back.
function PickedClient({ p, onChange }) {
  const tz = p.client_timezone || undefined
  const sub = [
    `Booked ${new Date(p.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
    p.scheduled_call_at ? `Fulfillment calls ${callAt(p.scheduled_call_at, tz)}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="ov-note" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, flexWrap: 'wrap' }}>
      <StatusAvatar name={fullName(p)} tab={tabOf(p)} size={40} />
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: 'var(--ov-hi)', minWidth: 0, overflowWrap: 'anywhere' }}>
            <span className="sr-only">Picked: </span>{fullName(p)}
          </span>
          <StatusPill tab={tabOf(p)} />
        </div>
        <div style={{ marginTop: 3, fontSize: 13, color: 'var(--ov-mute)' }}>{sub}</div>
      </div>
      <button type="button" className="ov-ghost w-full sm:w-auto" onClick={onChange}
        style={{ height: 38, padding: '0 16px', borderRadius: 999, fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0 }}>
        Change client
      </button>
    </div>
  )
}

function SaveButton({ onSave, busy, disabled, label }) {
  return (
    <button type="button" onClick={onSave} disabled={disabled} className="ov-hero-btn"
      style={{ width: '100%', height: 52, fontSize: 16, flexShrink: 0, ...(disabled ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}>
      {busy ? null : <Check size={18} strokeWidth={2.2} />}
      {label}
    </button>
  )
}

// The right-hand summary (and, with `bar`, the phone's bottom bar): who, and
// only what differs from what's saved.
function ChangeSummary({ p, name, phone, place, diffs, timeLine, onSave, busy, disabled, saveLabel, error, bar }) {
  const soft = 'var(--ov-hero-soft)'
  if (bar) {
    const line = !p ? 'Pick a client to start'
      : diffs.length ? `${diffs.length} ${diffs.length === 1 ? 'change' : 'changes'}: ${diffs.map(d => d.label.toLowerCase()).join(', ')}`
        : 'Nothing changed yet'
    return (
      <div className="ov-hero flex flex-col sm:hidden" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, borderRadius: '22px 22px 0 0',
        padding: '16px 16px calc(20px + env(safe-area-inset-bottom))', gap: 14,
      }}>
        {error && <BookError>{error}</BookError>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 600, color: '#fff', ...ellipsis }}>{p ? name || 'Client' : 'Change a booking'}</div>
          <div style={{ fontSize: 13, color: soft, ...ellipsis }}>{line}</div>
        </div>
        <SaveButton onSave={onSave} busy={busy} disabled={disabled} label={saveLabel} />
      </div>
    )
  }
  return (
    <div className="ov-hero" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '26px 26px 24px' }}>
      <span className="ov-hero-chip" style={{ alignSelf: 'flex-start' }}>
        <PencilLine size={14} strokeWidth={2} />Change a booking
      </span>
      {!p ? (
        <div>
          <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, color: '#fff' }}>Pick a client</div>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, color: soft }}>
            Their details and call time show up here, with whatever you change.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <ClientAvatar name={name} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, color: '#fff', overflowWrap: 'anywhere' }}>
                {name || 'Client'}
              </div>
              <div style={{ marginTop: 3, fontSize: 14, color: soft }}>{[phone, place].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.14)' }}>What changes</div>
            {diffs.length ? diffs.map(d => (
              <div key={d.label} style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
                <div style={{ fontSize: 12.5, color: soft }}>{d.label}</div>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 14.5 }}>
                  <span style={{ color: soft, textDecoration: 'line-through', overflowWrap: 'anywhere' }}>{d.from || 'blank'}</span>
                  <ArrowRight size={14} strokeWidth={2} style={{ color: soft, flexShrink: 0 }} />
                  <span style={{ color: '#fff', fontWeight: 600, overflowWrap: 'anywhere' }}>{d.to || 'blank'}</span>
                </div>
              </div>
            )) : (
              <p style={{ margin: '12px 0 0', fontSize: 14, color: soft }}>Nothing changed yet</p>
            )}
            {timeLine && (
              <div style={{ paddingTop: 12 }}>
                <div style={{ fontSize: 12.5, color: soft }}>Call time</div>
                <div style={{ marginTop: 4, fontSize: 14.5, color: soft }}>{timeLine}</div>
              </div>
            )}
          </div>
        </>
      )}
      <SaveButton onSave={onSave} busy={busy} disabled={disabled} label={saveLabel} />
      {error && <BookError>{error}</BookError>}
    </div>
  )
}

// The weekly meter, saying a change never uses a booking.
function UsageNote({ cap }) {
  const line = cap?.cap != null
    ? `Changing a booking never uses one. It stays ${cap.used} of ${cap.cap}.`
    : 'Changing a booking never uses one.'
  const note = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-mute)' }}>
      <CircleCheck size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />{line}
    </div>
  )
  if (cap?.cap != null) return <WeeklyUsage cap={cap} note={note} />
  return <div className="ov-card" style={{ padding: '18px 22px' }}>{note}</div>
}

// Saved: in place of the form.
function SavedCard({ name, at, tz, rebook, onPipeline, onAnother }) {
  return (
    <div className="pt-6 sm:pt-[72px]" style={{ maxWidth: 620, margin: '0 auto' }}>
      <section className="ov-hero px-5 pt-10 pb-8 sm:px-11 sm:pt-12 sm:pb-10"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <span style={{
          width: 76, height: 76, borderRadius: '50%', background: 'rgba(52,224,196,0.16)', border: '1px solid rgba(52,224,196,0.45)',
          boxShadow: '0 0 0 10px rgba(52,224,196,0.07), 0 0 60px rgba(52,224,196,0.35)', color: '#34E0C4',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={34} strokeWidth={2.4} />
        </span>
        <span className="ov-hero-chip" style={{ marginTop: 26 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34E0C4' }} />{rebook ? 'Re-booked' : 'Booking changed'}
        </span>
        <h1 className="text-[32px] sm:text-[40px]" style={{ margin: '18px 0 0', fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em', color: '#fff' }}>
          {name}
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 16, color: 'var(--ov-hero-soft)' }}>Saved. Fulfillment sees the change now.</p>
        {at && (
          <p style={{ margin: '6px 0 0', fontFamily: DISPLAY, fontSize: 19, fontWeight: 500, color: '#fff' }}>
            Fulfillment calls {callAt(at, tz)}
          </p>
        )}
        <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button type="button" onClick={onPipeline} className="ov-hero-btn" style={{ height: 50, padding: '0 26px', fontSize: 15 }}>
            <ArrowLeft size={17} strokeWidth={2.1} /> Back to My Pipeline
          </button>
          <button type="button" onClick={onAnother} style={{
            height: 50, boxSizing: 'border-box', padding: '0 24px', borderRadius: 999, fontSize: 15, fontWeight: 600, color: '#fff',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)',
            display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          }}>
            <PencilLine size={16} strokeWidth={2} /> Change another
          </button>
        </div>
      </section>
    </div>
  )
}
