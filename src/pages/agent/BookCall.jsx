import { useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TriangleAlert, Phone, Calendar, Info } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useCarrierHours, useAddCarrier } from '../../hooks/useCarriers'
import { useAgentBookings, useBookCall } from '../../hooks/useAgentBookings'
import { StepHead, OvField, StateField, DayChoice, SlotGrid, BookingSummary, WeeklyUsage, BookedCard, CarrierInput, SlotSkeleton, BookSwitch } from '../../components/agent/AgentUI'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import ChangeBooking from './ChangeBooking'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { fmtBooking, clientSlotISO, slotState, openBookingIsos, dayIn, addDaysStr, dateLabel, dayGone, carrierDaySlots, firstOpenDay } from '../../lib/scheduling'
import { hoursSummary } from '../../lib/carriers'
import { stageOf, digits, useNow } from '../../lib/agentBookings'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, nextTier, formatReset, formatWeekly } from '../../lib/billing'

// Book a call (Prompt 665) — replaces the old 25-field New Submission form.
//
// The agent's whole job is the phone call: if the client's a yes, book them a
// time with Fulfillment. So the only ask before booking is who (name + phone)
// and, if the agent already knows it, which carrier it is. DOB,
// address, bank and beneficiaries are gone from this flow entirely —
// Fulfillment gathers what it needs on its own call (Brayden: "if we just
// have the client, then we don't need pretty much any information").
//
// The hand-off contract is unchanged: a policies row with
// fulfillment_assigned=true, stage 'Pending', scheduled_call_at set — exactly
// what the Fulfillment desk already reads.
//
// Prompt 715 — rebuilt on the v16 "ov" language (DESIGN.md v16): two step
// cards on the left, a live booking summary + weekly meter in a sticky right
// column at 1280px, and a bar fixed to the bottom on phones. Behaviour is
// unchanged. (Prompt 680 removed the day's-calls side panel and the
// read-to-the-client hint on the form; the script line lives only on the
// success screen.)
//
// Prompt 724 — step 1 also asks for the client's city and state, and every
// time on the page is the client's local time: the zone is worked out
// silently from city + state (resolveClientTimezone) and never shown. Slots
// within 30 minutes, and times the agent already has booked, are disabled
// (slotState). Both rules are UI-only. The far-out confirm is gone: a few
// days out is fine when it helps the client.
//
// Prompt 728 — the carrier they're leaving is required (a type-ahead over
// every US life carrier, CarrierInput) and its open hours set the bookable
// times: the Fulfillment call is a 3-way call with that carrier, so a slot is
// open only while the carrier takes calls, starting an hour before it closes
// at the latest (carrierDaySlots). Times still show in the client's zone.
// The pickers stay dimmed until city + state and the carrier's hours are in.

const BLANK = { first: '', last: '', phone: '', city: '', state: '', carrier: '' }

const pillBtn = { height: 36, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }

// Prompt 730 — Book a call has two modes: New booking (below, unchanged) and
// Change a booking (ChangeBooking.jsx), picked by the switch at the top. One
// route: ?change=<policy id> opens Change a booking with that client picked;
// ?change with no id opens it on step 1.
export default function BookCall() {
  const [params, setParams] = useSearchParams()
  const changing = params.has('change')
  const changeId = params.get('change') || null
  // The picked client lives in the URL too, so "Change client" and picking
  // one are just ?change= edits.
  const setChange = id => {
    const next = new URLSearchParams(params)
    if (id == null) next.delete('change')
    else next.set('change', id)
    setParams(next, { replace: true })
  }
  const setMode = mode => setChange(mode === 'change' ? '' : null)
  const switcher = <BookSwitch value={changing ? 'change' : 'new'} onChange={setMode} />
  return changing
    ? <ChangeBooking key={changeId || 'pick'} policyId={changeId} onPick={setChange} switcher={switcher} onNew={() => setMode('new')} />
    : <NewBooking switcher={switcher} />
}

function NewBooking({ switcher }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const { data: carriers = [] } = useCarriers()
  const { data: mine = [] } = useAgentBookings(profile?.id)
  const book = useBookCall()
  // Prompt 692 — weekly submission cap. The database refuses a booking past
  // it (when billing is enforced); this shows the count and the way up first.
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage } = useWeeklyUsage(profile?.id)
  const cap = capState(usage)
  const upgrade = cap ? nextTier(tiers, usage.tier) : null
  const dateInput = useRef(null)

  const [form, setForm] = useState(BLANK)
  const [carrierId, setCarrierId] = useState(null) // the picked carriers row
  const [pickedDate, setPickedDate] = useState(null) // the client's calendar day; null = the default
  const [slot, setSlot] = useState('')
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // 'duplicate' | 'duplicateOk'
  const [done, setDone] = useState(null)
  const addCarrier = useAddCarrier()

  const { tz, resolving } = useClientTimezone(form.city, form.state)
  const picked = carrierId ? carriers.find(c => c.id === carrierId) || null : null
  // The carrier with its hours: cached at once, else looked up (checking).
  const { carrier: withHours, checking } = useCarrierHours(picked)
  const carrier = picked ? withHours : null
  const ready = !!tz && !!carrier
  // Until the zone is known the (dimmed) day cards show the agent's own days.
  const today = dayIn(now, tz || undefined)
  const tomorrow = addDaysStr(today, 1)
  // A picked day now in the client's past falls back to the first day the
  // carrier still has a time open.
  const date = !ready ? null : pickedDate && pickedDate >= today ? pickedDate : firstOpenDay(today, tz, carrier, now)
  const slotsOn = d => (ready && d ? carrierDaySlots(d, tz, carrier) : [])
  const daySlots = slotsOn(date)

  // This agent's open bookings: the times they've already taken, and the
  // duplicate-client check.
  const open = useMemo(() => mine.filter(p => stageOf(p) !== 'cancelled'), [mine])
  const openIsoSet = useMemo(() => openBookingIsos(mine, { now, stageOf }), [mine, now])

  // The picked slot is a wall-clock time ("2:00 PM"), so a new zone keeps it
  // at 2:00 PM for the client. If that, or the clock moving on, makes it too
  // soon or taken, it no longer counts as picked.
  const slotIso = slot && date && daySlots.includes(slot) ? clientSlotISO(date, slot, tz) : null
  const slotOpen = !!slotIso && slotState(slotIso, { now, openIsoSet }) === 'open'
  const scheduledAt = slotOpen ? slotIso : null

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
    setConfirm(null)
  }
  // Typing in the carrier box un-picks the carrier; picking one fills the box.
  const typeCarrier = v => { set('carrier', v); setCarrierId(null) }
  const pickCarrier = c => { set('carrier', c.name); setCarrierId(c.id) }
  const keepTypedCarrier = name => addCarrier.mutate(name, {
    onSuccess: row => row?.id && pickCarrier(row),
    onError: err => setError(err.message || 'Could not add that carrier'),
  })
  const pickDate = d => { setPickedDate(d); setConfirm(null) }
  const pickSlot = s => {
    setSlot(s)
    setErrors(e => { if (!e.has('slot')) return e; const n = new Set(e); n.delete('slot'); return n })
    setConfirm(null)
  }

  const phoneDigits = digits(form.phone)
  const duplicate = phoneDigits.length === 10 ? open.find(p => digits(p.client_phone) === phoneDigits) : null

  function submit() {
    setError('')
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (phoneDigits.length !== 10) missing.add('phone')
    if (!form.city.trim()) missing.add('city')
    if (!form.state) missing.add('state')
    if (!picked) missing.add('carrier')
    if (!slotOpen) missing.add('slot')
    if (missing.size) {
      setErrors(missing)
      setError(missing.has('phone') && form.phone
        ? 'Client phone needs all 10 digits.'
        : missing.has('carrier') && form.carrier.trim()
          ? 'Pick the carrier from the list, or choose "Use" to keep what you typed.'
          : 'Fill in the highlighted fields and pick a time.')
      return
    }
    if (duplicate && confirm !== 'duplicateOk') { setConfirm('duplicate'); return }
    doBook()
  }

  function doBook() {
    const firstName = titleCase(form.first)
    const lastName = titleCase(form.last)
    const city = titleCase(form.city.trim())
    book.mutate({
      agentId: profile.id,
      firstName, lastName,
      phone: form.phone.trim(),
      city, state: form.state, timezone: tz,
      carrierId: picked.id,
      currentCarrier: picked.name,
      scheduledAt,
    }, {
      onSuccess: policy => {
        setDone({ id: policy?.id, name: `${firstName} ${lastName}`, at: scheduledAt, tz, location: `${city}, ${form.state}` })
        setForm(BLANK); setCarrierId(null); setSlot(''); setPickedDate(null); setConfirm(null); setErrors(new Set())
      },
      onError: err => setError(err.hint === 'weekly_cap'
        ? `${err.message} Upgrade your plan or wait until ${formatReset(usage?.week_end)}.`
        : err.message || 'Could not book this call'),
    })
  }

  if (done) {
    return (
      <BookedCard
        name={done.name} at={done.at} now={now} tz={done.tz} location={done.location}
        onAnother={() => setDone(null)}
        onPipeline={() => navigate(done.id ? `/agent/clients?open=${done.id}` : '/agent/clients')}
      />
    )
  }

  const busy = book.isPending
  const capped = !!cap?.blocking
  const showCap = cap && cap.cap != null

  const isOther = !!date && date !== today && date !== tomorrow
  // A day with no time left (or the carrier closed) is a plain disabled card.
  const todayGone = ready && dayGone(today, tz, now, slotsOn(today))
  const tomorrowGone = ready && dayGone(tomorrow, tz, now, slotsOn(tomorrow))
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }

  const name = [titleCase(form.first.trim()), titleCase(form.last.trim())].filter(Boolean).join(' ')
  const location = form.city.trim() && form.state ? `${titleCase(form.city.trim())}, ${form.state}` : ''
  const summary = {
    name, phone: form.phone.trim(), carrier: picked?.name || '', location, tz,
    scheduledAt, now,
    onBook: submit, busy, capped, error,
  }
  // Until city and state are in (and a split state's lookup is back) and the
  // carrier's hours are known, the pickers are dimmed: there's no time to show.
  const dim = !ready
  const city = form.city.trim() ? titleCase(form.city.trim()) : ''
  const hoursLine = !ready ? null : carrier.hours_status === 'fallback'
    ? `We couldn't find ${carrier.name}'s hours, so we're using 9–5 Eastern. Fulfillment will confirm.`
    : `${carrier.name} takes calls ${hoursSummary(carrier.hours, carrier.hours_tz)} · times shown are ${city}'s local time.`
  const closedText = ready ? `${carrier.name} doesn't take calls that day. Pick another day.` : null
  const fields = 'grid grid-cols-1 sm:grid-cols-3 gap-y-[18px] sm:gap-4'

  return (
    <div className="pb-[110px] sm:pb-0">
      {switcher}
      {showCap && (
        <div className="flex sm:hidden" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
          <WeeklyUsage cap={cap} pill />
        </div>
      )}

      <div className="ov-book">
        <div className="flex flex-col gap-[14px] sm:gap-5" style={{ minWidth: 0 }}>
          {capped && (
            <div className="ov-attn" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px' }}>
              <TriangleAlert size={18} strokeWidth={2} style={{ color: 'var(--ov-warn)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, flex: '1 1 260px', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mid)' }}>
                  You've used all {cap.cap} submissions on the {cap.tierName} plan this week.{' '}
                  {upgrade
                    ? <>Upgrade to {upgrade.name} ({formatWeekly(upgrade.weekly_cents)}/week, {upgrade.weekly_cap ?? 'unlimited'} a week) to keep booking, or wait until {formatReset(usage.week_end)}.</>
                    : <>The cap resets {formatReset(usage.week_end)}.</>}
                </p>
                {upgrade && (
                  <button type="button" className="ov-ghost" onClick={() => navigate('/agent/billing')} style={pillBtn}>Upgrade</button>
                )}
              </div>
            </div>
          )}

          <section className="ov-card flex flex-col gap-[18px] sm:gap-5 px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead n={1} title="Who's the client" sub="Name, number and where they live" />
            <div className={fields}>
              <OvField label="First name" placeholder="First name" autoComplete="off"
                value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')} />
              <OvField label="Last name" placeholder="Last name" autoComplete="off"
                value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')} />
              <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
                value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
            </div>
            <div className={fields}>
              <OvField label="City" placeholder="Pensacola" autoComplete="off"
                value={form.city} onChange={e => set('city', e.target.value)} error={errors.has('city')} />
              <StateField value={form.state} onChange={v => set('state', v)} error={errors.has('state')} />
              <CarrierInput
                carriers={carriers} text={form.carrier} picked={picked} error={errors.has('carrier')}
                onText={typeCarrier} onPick={pickCarrier} onUseText={keepTypedCarrier} adding={addCarrier.isPending}
              />
            </div>

            {duplicate && (
              <Notice warn={confirm === 'duplicate'}>
                You already have {duplicate.client_first_name} {duplicate.client_last_name} booked with this number
                ({fmtBooking(duplicate.scheduled_call_at, duplicate.client_timezone)}).
                {confirm === 'duplicate' && (
                  <span style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="ov-ghost" style={pillBtn} onClick={() => { setConfirm('duplicateOk'); doBook() }}>
                      Book anyway
                    </button>
                    <button type="button" className="ov-ghost" style={pillBtn} onClick={() => navigate('/agent/clients')}>View it</button>
                  </span>
                )}
              </Notice>
            )}
          </section>

          <section className="ov-card flex flex-col gap-4 sm:gap-[18px] px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead n={2} title="When should Fulfillment call" sub="Pick a day, then a time. Times are the client's local time." />
            {dim && !checking && (
              <div className="ov-note" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
                <Info size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ov-mute)' }} />
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mid)' }}>
                  Add the client's city, state and carrier first, then pick a day and time.
                </p>
              </div>
            )}
            {checking && (
              <p role="status" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mid)' }}>
                Checking {picked.name}'s hours…
              </p>
            )}
            {hoursLine && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)' }}>{hoursLine}</p>
            )}
            <div
              aria-disabled={dim || undefined} aria-busy={resolving || checking || undefined}
              className="flex flex-col gap-4 sm:gap-[18px]"
              style={dim ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
            >
              <div className="flex gap-[10px] sm:gap-3">
                <DayChoice
                  label="Today" on={!!date && date === today} disabled={dim || todayGone} onClick={() => pickDate(today)}
                  long={dateLabel(today, 'long')} short={dateLabel(today, 'short')}
                />
                <DayChoice
                  label="Tomorrow" on={!!date && date === tomorrow} disabled={dim || tomorrowGone} onClick={() => pickDate(tomorrow)}
                  long={dateLabel(tomorrow, 'long')} short={dateLabel(tomorrow, 'short')}
                />
                <DayChoice
                  className="hidden sm:flex" label="Another day" on={isOther} disabled={dim} icon={Calendar} onClick={openPicker}
                  long={isOther ? dateLabel(date, 'short') : 'Pick a date'}
                />
              </div>
              <button
                type="button" onClick={openPicker} aria-pressed={isOther} disabled={dim}
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

              {/* Before the zone and the carrier's hours are known the grid is a
                  dimmed placeholder (the agent's own day); skeletons while checking. */}
              {checking ? <SlotSkeleton /> : (
                <SlotGrid
                  date={date || today} slot={slotOpen ? slot : ''} onSlot={pickSlot} error={errors.has('slot')} now={now}
                  tz={tz} openIsoSet={ready ? openIsoSet : NO_BOOKINGS}
                  {...(ready ? { slots: daySlots, emptyText: closedText } : null)}
                />
              )}
            </div>

            <div className="ov-note" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
              <Info size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ov-mute)' }} />
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)' }}>
                <span style={{ fontWeight: 600, color: 'var(--ov-mid)' }}>Today or tomorrow works best for most clients.</span>{' '}
                Times follow the carrier's hours, since Fulfillment calls with them on the line. Calls need 30 minutes' notice, and a time you've already booked is taken.
              </p>
            </div>
          </section>
        </div>

        <div className="ov-book-side hidden sm:flex" style={{ flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <BookingSummary {...summary} />
          {showCap && <WeeklyUsage cap={cap} resets={formatReset(usage.week_end)} />}
        </div>
      </div>

      <BookingSummary {...summary} bar />
    </div>
  )
}

const NO_BOOKINGS = new Set()

// Duplicate-client notice: a quiet note, or amber when it needs the agent to
// decide.
function Notice({ warn, children }) {
  return (
    <div className={`ov-note${warn ? ' is-warn' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
      <TriangleAlert size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ov-warn)' }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.55, color: warn ? 'var(--ov-hi)' : 'var(--ov-mid)' }}>{children}</div>
    </div>
  )
}
