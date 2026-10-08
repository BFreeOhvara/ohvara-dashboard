import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TriangleAlert, Phone, Calendar, Info } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { useAgentBookings, useBookCall } from '../../hooks/useAgentBookings'
import { StepHead, OvField, DayChoice, SlotGrid, BookingSummary, WeeklyUsage, BookedCard } from '../../components/agent/AgentUI'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { SLOTS, slotToISO, localDateISO, isFarOut, fmtBooking } from '../../lib/scheduling'
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

const BLANK = { first: '', last: '', phone: '', carrier: '' }

// Today, unless today's last slot has already passed — then tomorrow.
function defaultDate() {
  const today = localDateISO(0)
  return new Date(slotToISO(today, SLOTS[SLOTS.length - 1])).getTime() > Date.now() ? today : localDateISO(1)
}

const slotPast = (date, slot) => new Date(slotToISO(date, slot)).getTime() <= Date.now()

// "Wednesday, Oct 7" / "Wed, Oct 7" for a YYYY-MM-DD date.
const dayLabel = (date, weekday) =>
  new Date(`${date}T00:00`).toLocaleDateString('en-US', { weekday, month: 'short', day: 'numeric' })

const pillBtn = { height: 36, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }

export default function BookCall() {
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
  const [date, setDate] = useState(defaultDate)
  const [slot, setSlot] = useState('')
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // 'farOut' | 'duplicate'
  const [done, setDone] = useState(null)

  const scheduledAt = slot ? slotToISO(date, slot) : null

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
    setConfirm(null)
  }
  const pickDate = d => {
    setDate(d)
    // a slot that's already past on the new day can't stay selected
    if (slot && slotPast(d, slot)) setSlot('')
    setConfirm(null)
  }
  const pickSlot = s => {
    setSlot(s)
    setErrors(e => { if (!e.has('slot')) return e; const n = new Set(e); n.delete('slot'); return n })
    setConfirm(null)
  }

  // This agent's open bookings — for the "already booked at this time" hint,
  // and the duplicate-client check.
  const open = useMemo(() => mine.filter(p => stageOf(p) !== 'cancelled'), [mine])
  const takenCounts = useMemo(() => {
    const m = {}
    for (const p of open) if (p.scheduled_call_at) {
      const k = new Date(p.scheduled_call_at).toISOString()
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [open])

  const phoneDigits = digits(form.phone)
  const duplicate = phoneDigits.length === 10 ? open.find(p => digits(p.client_phone) === phoneDigits) : null

  function submit() {
    setError('')
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (phoneDigits.length !== 10) missing.add('phone')
    if (!slot) missing.add('slot')
    if (missing.size) {
      setErrors(missing)
      setError(missing.has('phone') && form.phone
        ? 'Client phone needs all 10 digits.'
        : 'Fill in the highlighted fields and pick a time.')
      return
    }
    if (duplicate && confirm !== 'duplicate' && confirm !== 'duplicateOk') { setConfirm('duplicate'); return }
    if (isFarOut(scheduledAt) && confirm !== 'farOutOk') { setConfirm('farOut'); return }
    doBook()
  }

  function doBook() {
    const firstName = titleCase(form.first)
    const lastName = titleCase(form.last)
    book.mutate({
      agentId: profile.id,
      firstName, lastName,
      phone: form.phone.trim(),
      currentCarrier: form.carrier.trim(),
      scheduledAt,
    }, {
      onSuccess: policy => {
        setDone({ id: policy?.id, name: `${firstName} ${lastName}`, at: scheduledAt })
        setForm(BLANK); setSlot(''); setDate(defaultDate()); setConfirm(null); setErrors(new Set())
      },
      onError: err => setError(err.hint === 'weekly_cap'
        ? `${err.message} Upgrade your plan or wait until ${formatReset(usage?.week_end)}.`
        : err.message || 'Could not book this call'),
    })
  }

  if (done) {
    return (
      <BookedCard
        name={done.name} at={done.at} now={now}
        onAnother={() => setDone(null)}
        onPipeline={() => navigate(done.id ? `/agent/clients?open=${done.id}` : '/agent/clients')}
      />
    )
  }

  const busy = book.isPending
  const capped = !!cap?.blocking
  const showCap = cap && cap.cap != null

  const today = localDateISO(0)
  const tomorrow = localDateISO(1)
  const isOther = date !== today && date !== tomorrow
  const todayGone = new Date(slotToISO(today, SLOTS[SLOTS.length - 1])).getTime() <= now
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }
  const farOut = isFarOut(scheduledAt)

  const name = [titleCase(form.first.trim()), titleCase(form.last.trim())].filter(Boolean).join(' ')
  const summary = {
    name, phone: form.phone.trim(), carrier: form.carrier.trim(), scheduledAt, now,
    onBook: submit, busy, capped, error,
  }

  return (
    <div className="pb-[110px] sm:pb-0">
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
            <StepHead n={1} title="Who's the client" sub="Name and the number Fulfillment should call" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-[18px] sm:gap-4">
              <OvField label="First name" placeholder="First name" autoComplete="off"
                value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')} />
              <OvField label="Last name" placeholder="Last name" autoComplete="off"
                value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')} />
              <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
                className="col-span-2 sm:col-span-1"
                value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 sm:gap-4">
              <OvField label="Carrier they're leaving" optional placeholder="e.g. Mutual of Omaha" list="leaving-carriers"
                value={form.carrier} onChange={e => set('carrier', e.target.value)} />
              <datalist id="leaving-carriers">
                {carriers.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>

            {duplicate && (
              <Notice warn={confirm === 'duplicate'}>
                You already have {duplicate.client_first_name} {duplicate.client_last_name} booked with this number
                ({fmtBooking(duplicate.scheduled_call_at)}).
                {confirm === 'duplicate' && (
                  <span style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="ov-ghost" style={pillBtn}
                      onClick={() => { setConfirm('duplicateOk'); if (!isFarOut(scheduledAt)) doBook(); else setConfirm('farOut') }}>
                      Book anyway
                    </button>
                    <button type="button" className="ov-ghost" style={pillBtn} onClick={() => navigate('/agent/clients')}>View it</button>
                  </span>
                )}
              </Notice>
            )}
          </section>

          <section className="ov-card flex flex-col gap-4 sm:gap-[18px] px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7">
            <StepHead n={2} title="When should Fulfillment call" sub="Pick a day, then a time" />
            <div className="flex gap-[10px] sm:gap-3">
              <DayChoice
                label="Today" on={date === today} disabled={todayGone} onClick={() => pickDate(today)}
                long={todayGone ? 'No times left' : dayLabel(today, 'long')}
                short={todayGone ? null : dayLabel(today, 'short')}
              />
              <DayChoice
                label="Tomorrow" on={date === tomorrow} onClick={() => pickDate(tomorrow)}
                long={dayLabel(tomorrow, 'long')} short={dayLabel(tomorrow, 'short')}
              />
              <DayChoice
                className="hidden sm:flex" label="Another day" on={isOther} icon={Calendar} onClick={openPicker}
                long={isOther ? dayLabel(date, 'short') : 'Pick a date'}
              />
            </div>
            <button
              type="button" onClick={openPicker} aria-pressed={isOther}
              className={`ov-choice flex sm:hidden${isOther ? ' is-on' : ''}`}
              style={{
                height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 9,
                fontSize: 14.5, fontWeight: 600, color: isOther ? 'var(--ov-hi)' : 'var(--ov-mid)',
              }}
            >
              <Calendar size={17} strokeWidth={1.9} style={{ color: isOther ? 'var(--ov-pick)' : undefined }} />
              {isOther ? dayLabel(date, 'short') : 'Another day'}
            </button>
            <input
              ref={dateInput} type="date" value={date} min={today} tabIndex={-1} aria-label="Pick another day"
              onChange={e => e.target.value && pickDate(e.target.value)}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
            />

            <SlotGrid date={date} slot={slot} onSlot={pickSlot} takenCounts={takenCounts} error={errors.has('slot')} now={now} />

            <div className="ov-note" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
              <Info size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color: farOut ? 'var(--ov-warn)' : 'var(--ov-mute)' }} />
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ov-mute)' }}>
                <span style={{ fontWeight: 600, color: farOut ? 'var(--ov-warn)' : 'var(--ov-mid)' }}>Today or tomorrow is the norm.</span>{' '}
                Further out needs Fulfillment's OK. These times don't check Fulfillment's calendar yet; "booked" only counts your own calls.
              </p>
            </div>

            {confirm === 'farOut' && (
              <Notice warn>
                That's more than a day out — confirm Fulfillment is actually booked through then?
                <span style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="ov-ghost" style={pillBtn} onClick={() => { setConfirm('farOutOk'); doBook() }}>
                    Yes, book it
                  </button>
                  <button type="button" className="ov-ghost" style={pillBtn} onClick={() => setConfirm(null)}>Change time</button>
                </span>
              </Notice>
            )}
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

// Duplicate-client and far-out notices: a quiet note, or amber when it needs
// the agent to decide.
function Notice({ warn, children }) {
  return (
    <div className={`ov-note${warn ? ' is-warn' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14 }}>
      <TriangleAlert size={17} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1, color: 'var(--ov-warn)' }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.55, color: warn ? 'var(--ov-hi)' : 'var(--ov-mid)' }}>{children}</div>
    </div>
  )
}
