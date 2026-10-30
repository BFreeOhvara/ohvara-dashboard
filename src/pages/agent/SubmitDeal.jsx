import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TriangleAlert, Phone, Hash, Check, Sun, Clock, Moon, MapPin, History, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers, useAddCarrier } from '../../hooks/useCarriers'
import { useCallPicker } from '../../hooks/useCallPicker'
import { useAgentBookings, useSubmitDeal } from '../../hooks/useAgentBookings'
import { StepHead, OvField, StateField, WeeklyUsage, BookedCard, CarrierInput, BookError, ClientAvatar, LoadError } from '../../components/agent/AgentUI'
import { CancelStep, Notice } from './BookCall'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { fmtBooking } from '../../lib/scheduling'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import { digits, useNow } from '../../lib/agentBookings'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, nextTier, formatReset, formatWeekly } from '../../lib/billing'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { PhoneCancelStep, PhoneBar } from '../../components/agent/phone/PhoneBook'
import { PhoneSubHead } from '../../components/layout/PhoneShell'
import { dayTime } from '../../components/agent/phone/phoneBits'
import { isNativeApp } from '../../lib/native'
import TextConsent from '../../components/agent/TextConsent'

// New deal flow (migration 187): the agent closed a deal, now they submit it.
//
//   Step 1  the client (name, phone, city, state), the NEW carrier, the policy
//           number if there is one yet, and the text consent.
//   Step 2  "Did this replace an old policy?" and the best time for the
//           review call. Both are asked on both branches.
//   Step 3  Yes only: the old-policy cancellation step, which is Book a call's
//           day and time step (useCallPicker + CancelStep, extracted from
//           BookCall, not copied). The OLD carrier's hours set the slots.
//
// One RPC (agent_submit_deal) writes it and counts as one of the week's
// submissions. Yes books a Fulfillment call; No books none and never reaches a
// rep. Moving from Yes to No keeps the old carrier and time in state but sends
// neither, so Yes brings them back. Shown only when submit_live is on (the
// shell decides).

const BLANK = { first: '', last: '', phone: '', city: '', state: '', newCarrier: '', policyNumber: '', oldCarrier: '' }
const STEP1_KEYS = ['first', 'last', 'phone', 'city', 'state', 'carrier']
const BEST = [
  { value: 'morning', label: 'Morning', hint: 'Before noon', icon: Sun },
  { value: 'afternoon', label: 'Afternoon', hint: 'Noon to 5 PM', icon: Clock },
  { value: 'evening', label: 'Evening', hint: 'After 5 PM', icon: Moon },
]
const bestLabel = v => BEST.find(b => b.value === v)?.label || ''
const pillBtn = { height: 36, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'pointer' }
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const rule = { height: 1, background: 'var(--ov-line)' }
const MSG = {
  no_servicing: 'Servicing isn’t on your account. You have Leads only, so this deal can’t be submitted.',
  not_live: 'Submit is not open yet.',
}

export default function SubmitDeal({ onBack }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const phone = usePhoneLayout()
  const now = useNow(30e3)
  const goBack = onBack || (() => navigate(-1))
  const { data: carriers = [], isError: carriersFailed, refetch: refetchCarriers } = useCarriers()
  const { data: mine = [] } = useAgentBookings(profile?.id)
  const submitDeal = useSubmitDeal()
  const addCarrier = useAddCarrier()
  // The weekly cap (migration 187 counts a deal like a booking). The database
  // refuses a deal past it; this shows the count and the way up first.
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage } = useWeeklyUsage(profile?.id)
  const cap = capState(usage)
  const upgrade = cap ? nextTier(tiers, usage.tier) : null
  const resets = formatReset(usage?.week_end, profile?.timezone)

  const [form, setForm] = useState(BLANK)
  const [newId, setNewId] = useState(null) // the picked carriers row for the new policy
  const [oldId, setOldId] = useState(null) // the picked carriers row being left
  const [replaced, setReplaced] = useState(null) // true | false | null = not answered
  const [best, setBest] = useState(null)
  const [textsOk, setTextsOk] = useState(false)
  const [errors, setErrors] = useState(new Set())
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null) // 'duplicate' | 'duplicateOk'
  const [step1Open, setStep1Open] = useState(true)
  const [addingFor, setAddingFor] = useState(null) // 'new' | 'old'
  const [done, setDone] = useState(null)

  const { tz, resolving } = useClientTimezone(form.city, form.state)
  const newPicked = newId ? carriers.find(c => c.id === newId) || null : null
  const oldPicked = oldId ? carriers.find(c => c.id === oldId) || null : null
  const city = form.city.trim() ? titleCase(form.city.trim()) : ''
  const myTz = profile?.timezone || DEFAULT_TIMEZONE
  const pick = useCallPicker({ picked: oldPicked, tz, now, mine, city, viewerTz: myTz })
  const { open, scheduledAt } = pick

  const clear = k => setErrors(e => { if (!e.has(k)) return e; const n = new Set(e); n.delete(k); return n })
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); clear(k); setConfirm(null) }
  const setNew = (text, id) => { set('newCarrier', text); setNewId(id); clear('carrier') }
  const setOld = (text, id) => { set('oldCarrier', text); setOldId(id); clear('old') }
  const keepTyped = which => name => {
    setAddingFor(which)
    addCarrier.mutate(name, {
      onSuccess: row => row?.id && (which === 'new' ? setNew(row.name, row.id) : setOld(row.name, row.id)),
      onError: err => setError(err.message || 'Could not add that carrier'),
    })
  }
  const answer = v => { setReplaced(v); clear('replaced'); setConfirm(null) }
  const chooseBest = v => { setBest(v); clear('best') }
  const pickDate = d => { pick.setPickedDate(d); setConfirm(null) }
  const pickSlot = s => { pick.setSlot(s); clear('slot'); setConfirm(null) }

  const phoneDigits = digits(form.phone)
  const duplicate = phoneDigits.length === 10 ? open.find(p => digits(p.client_phone) === phoneDigits) : null
  const dupName = duplicate ? `${duplicate.client_first_name} ${duplicate.client_last_name}` : ''
  const dupText = duplicate && (duplicate.scheduled_call_at
    ? `You already have ${dupName} booked with this number (${fmtBooking(duplicate.scheduled_call_at, duplicate.client_timezone)}).`
    : `You already submitted ${dupName} with this number.`)

  const step1Done = !!(form.first.trim() && form.last.trim() && phoneDigits.length === 10 && form.city.trim() && form.state && newPicked)

  function submit() {
    setError('')
    const missing = new Set()
    if (!form.first.trim()) missing.add('first')
    if (!form.last.trim()) missing.add('last')
    if (phoneDigits.length !== 10) missing.add('phone')
    if (!form.city.trim()) missing.add('city')
    if (!form.state) missing.add('state')
    if (!newPicked) missing.add('carrier')
    if (replaced === null) missing.add('replaced')
    if (best === null) missing.add('best')
    if (replaced === true && !oldPicked) missing.add('old')
    if (replaced === true && !scheduledAt) missing.add('slot')
    if (missing.size) {
      setErrors(missing)
      if (STEP1_KEYS.some(k => missing.has(k))) setStep1Open(true)
      const onlyCall = [...missing].every(k => k === 'old' || k === 'slot')
      setError(missing.has('phone') && form.phone
        ? 'Client phone needs all 10 digits.'
        : (missing.has('carrier') && form.newCarrier.trim()) || (missing.has('old') && form.oldCarrier.trim())
          ? 'Pick a carrier from the list.'
          : onlyCall ? 'Fill in the highlighted fields and pick a time.' : 'Fill in the highlighted fields and answer step 2.')
      return
    }
    if (!tz) {
      setError(resolving
        ? 'Still working out the client’s time zone. Try again in a moment.'
        : 'We couldn’t find a time zone for that city and state. Check the city.')
      return
    }
    if (duplicate && confirm !== 'duplicateOk') { setConfirm('duplicate'); return }
    doSubmit()
  }

  function doSubmit() {
    const firstName = titleCase(form.first)
    const lastName = titleCase(form.last)
    const place = `${titleCase(form.city.trim())}, ${form.state}`
    const used = cap ? cap.used + 1 : null
    submitDeal.mutate({
      firstName, lastName, phone: form.phone.trim(), city: titleCase(form.city.trim()), state: form.state, timezone: tz,
      newCarrierId: newPicked.id, policyNumber: form.policyNumber.trim(),
      replaced, oldCarrierId: oldPicked?.id, scheduledAt, bestTime: best, smsConsent: textsOk,
    }, {
      onSuccess: id => {
        setDone({ id, name: `${firstName} ${lastName}`, first: firstName, replaced, at: scheduledAt, tz, location: place, best, used, cap: cap?.cap ?? null })
        setForm(BLANK); setNewId(null); setOldId(null); setReplaced(null); setBest(null); setTextsOk(false)
        pick.reset(); setConfirm(null); setErrors(new Set()); setStep1Open(true)
      },
      onError: err => setError(err.hint === 'weekly_cap'
        ? `${err.message} ${isNativeApp() ? `The cap resets ${resets}.` : `Upgrade your plan or wait until ${resets}.`}`
        : MSG[err.hint] || err.message || 'Could not submit this deal'),
    })
  }

  if (done) {
    const card = done.replaced ? (
      <BookedCard
        name={done.name} at={done.at} now={now} tz={done.tz} location={done.location}
        anotherLabel="Submit another" pipelineLabel="View in Clients"
        onAnother={() => setDone(null)}
        onPipeline={() => navigate(done.id ? `/agent/clients?open=${done.id}` : '/agent/clients')}
      />
    ) : (
      <BookedCard
        name={done.name} now={now} tz={done.tz} location={done.location}
        chip="Submitted" extraChip={done.cap != null && done.used != null ? `${done.used} of ${done.cap} this week` : null}
        line="Servicing starts with the packet check" box={<NextSteps first={done.first} best={done.best} />}
        anotherLabel="Submit another" pipelineLabel="View in Clients"
        onAnother={() => setDone(null)}
        onPipeline={() => navigate(done.id ? `/agent/clients?open=${done.id}` : '/agent/clients')}
      />
    )
    if (!phone) return card
    return (
      <>
        <div style={{ margin: '-4px -16px 0' }}><PhoneSubHead title={done.replaced ? 'Booked' : 'Submitted'} onBack={() => navigate('/agent')} /></div>
        {card}
      </>
    )
  }

  const busy = submitDeal.isPending
  const capped = !!cap?.blocking
  const showCap = cap && cap.cap != null
  const name = [titleCase(form.first.trim()), titleCase(form.last.trim())].filter(Boolean).join(' ')
  const location = city && form.state ? `${city}, ${form.state}` : ''
  const err1 = k => errors.has(k)
  const carriersError = carriersFailed && <LoadError what="the carrier list" onRetry={() => refetchCarriers()} tall />
  const capWarning = capped && (
    <div className="ov-attn" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: phone ? '16px 16px' : '18px 22px' }}>
      <TriangleAlert size={18} strokeWidth={2} style={{ color: 'var(--ov-warn)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, flex: '1 1 260px', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mid)' }}>
          You've used all {cap.cap} submissions on the {cap.tierName} plan this week.{' '}
          {upgrade && !isNativeApp()
            ? <>Upgrade to {upgrade.name} (<span style={{ fontFamily: 'var(--font-mono)' }}>{formatWeekly(upgrade.weekly_cents)}</span>/week, {upgrade.weekly_cap ?? 'unlimited'} a week) to keep submitting, or wait until {resets}.</>
            : <>The cap resets {resets}.</>}
        </p>
        {upgrade && !isNativeApp() && (
          <button type="button" className="ov-ghost" onClick={() => navigate('/agent/billing')} style={{ ...pillBtn, ...(phone ? { height: 44 } : null) }}>Upgrade</button>
        )}
      </div>
    </div>
  )
  const dupConfirm = confirm === 'duplicate' && duplicate

  // ── phone ──────────────────────────────────────────────────────────────
  if (phone) {
    const pill = showCap && (
      <span className={`ph-usepill${cap.atCap ? ' is-full' : ''}`}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{cap.used} of {cap.cap} used
      </span>
    )
    const first = form.first.trim() ? titleCase(form.first.trim()) : 'your client'
    const small = replaced === true ? `Fulfillment calls ${first}` : replaced === false ? `Review call for ${first}` : 'New deal'
    const big = replaced === true
      ? (scheduledAt ? dayTime(scheduledAt, now, tz) : 'Pick a time')
      : replaced === false ? (best ? bestLabel(best) : 'Pick a best time') : 'Answer step 2'
    const sumLine = [form.phone, [form.city.trim(), form.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    const carrierLine = [newPicked?.name, form.policyNumber.trim()].filter(Boolean).join(' · ')
    const label = { fontSize: 12, fontWeight: 600, color: 'var(--ov-data-a)' }
    const card = { padding: '16px 14px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 16 }
    return (
      <div className="ph-book">
        <div style={{ margin: '-4px -16px 0' }}><PhoneSubHead title="Submit a deal" onBack={goBack} right={pill} /></div>
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {carriersError}
          {capWarning}

          {step1Open || !step1Done ? (
            <section className="ov-card" style={card}>
              <div style={label}>1 · The client and the new policy</div>
              <OvField label="First name" placeholder="First name" autoComplete="off" enterKeyHint="next"
                value={form.first} onChange={e => set('first', e.target.value)} error={err1('first')} />
              <OvField label="Last name" placeholder="Last name" autoComplete="off" enterKeyHint="next"
                value={form.last} onChange={e => set('last', e.target.value)} error={err1('last')} />
              <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
                value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={err1('phone')} />
              <OvField label="City" placeholder="Pensacola" autoComplete="off"
                value={form.city} onChange={e => set('city', e.target.value)} error={err1('city')} />
              <StateField value={form.state} onChange={v => set('state', v)} error={err1('state')} />
              {dupText && (
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mid)' }}>
                  <TriangleAlert size={14} strokeWidth={2} style={{ color: 'var(--ov-warn)', verticalAlign: '-2px', marginRight: 6 }} aria-hidden="true" />
                  {dupText}
                </p>
              )}
              <div style={rule} />
              <CarrierInput
                label="New carrier" carriers={carriers} text={form.newCarrier} picked={newPicked} error={err1('carrier')}
                onText={v => setNew(v, null)} onPick={c => setNew(c.name, c.id)} onUseText={keepTyped('new')} adding={addCarrier.isPending && addingFor === 'new'}
              />
              <OvField label="Policy number" optional icon={Hash} placeholder="If you have it yet" autoComplete="off"
                value={form.policyNumber} onChange={e => set('policyNumber', e.target.value)} />
              <TextConsent checked={textsOk} onChange={setTextsOk} disabled={busy} compact />
              {step1Done && (
                <button type="button" className="ov-ghost" onClick={() => setStep1Open(false)} style={{ height: 48, borderRadius: 999, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                  Done · next step
                </button>
              )}
            </section>
          ) : (
            <section className="ov-card ph-sumcard" style={{ borderRadius: 20 }}>
              <span className="ph-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ov-mute)' }}>1 · The client and the new policy</span>
                <span className="ph-row-title" style={{ marginTop: 2, fontSize: 15 }}>{name}</span>
                <span className="ph-row-sub">{sumLine}</span>
                <span className="ph-row-sub">{carrierLine}</span>
              </span>
              <button type="button" className="ov-ghost ph-edit" onClick={() => setStep1Open(true)}>Edit</button>
            </section>
          )}

          <section className="ov-card" style={card}>
            <div style={label}>2 · Did this replace an old policy?</div>
            <div className={`ph-opts${err1('replaced') ? ' is-error' : ''}`}>
              <button type="button" className={`ph-opt${replaced === true ? ' is-on' : ''}`} aria-pressed={replaced === true} onClick={() => answer(true)}>
                <b>Yes, it did</b><small>We cancel the old one</small>
              </button>
              <button type="button" className={`ph-opt${replaced === false ? ' is-on' : ''}`} aria-pressed={replaced === false} onClick={() => answer(false)}>
                <b>No, it’s all new</b><small>No call time needed</small>
              </button>
            </div>
            <BestTime phone value={best} onChange={chooseBest} error={err1('best')} />
          </section>

          {replaced === true && (
            <PhoneCancelStep
              label="3 · Old-policy cancellation" sub="Fulfillment calls with the old carrier on the line. Times are the client’s local time."
              dimText="Add the client’s city, state and old carrier first, then pick a day and time."
              lead={(
                <CarrierInput
                  label="Carrier they’re leaving" carriers={carriers} text={form.oldCarrier} picked={oldPicked} error={err1('old')}
                  onText={v => setOld(v, null)} onPick={c => setOld(c.name, c.id)} onUseText={keepTyped('old')} adding={addCarrier.isPending && addingFor === 'old'}
                />
              )}
              ready={pick.ready} checking={pick.checking} picked={oldPicked} tz={tz} today={pick.today} date={pick.date} onDate={pickDate}
              slotsOn={pick.slotsOn} daySlots={pick.daySlots} openIsoSet={pick.openIsoSet} now={now} slot={pick.slot} onSlot={pickSlot}
              hoursLine={pick.hoursLine} closedText={pick.closedText} error={err1('slot')}
            />
          )}
        </div>

        <PhoneBar
          error={error} onClick={submit} busy={busy} disabled={capped} small={small} big={big} label="Submit" busyLabel="Submitting…"
          confirm={dupConfirm && (
            <div className="ph-err" role="alert" style={{ color: 'var(--ov-hi)', background: 'linear-gradient(var(--ov-st-needs-tint), var(--ov-st-needs-tint)), var(--ph-bg)', borderColor: 'var(--ov-st-needs-edge)' }}>
              {dupText}
              <span style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="ov-ghost" onClick={() => { setConfirm('duplicateOk'); doSubmit() }} style={{ height: 44, padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600 }}>Submit anyway</button>
                <button type="button" className="ov-ghost" onClick={() => navigate(`/agent/clients?open=${duplicate.id}`)} style={{ height: 44, padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600 }}>View it</button>
              </span>
            </div>
          )}
        />
      </div>
    )
  }

  // ── desktop (and a narrow window outside the phone shell) ───────────────
  const summary = {
    name, phone: form.phone.trim(), location, newCarrier: newPicked?.name || '', policyNumber: form.policyNumber.trim(),
    replaced, oldCarrier: oldPicked?.name || '', best, scheduledAt, now, tz, left: cap?.left ?? null,
    onSubmit: submit, busy, capped, error,
  }
  const grid3 = 'grid grid-cols-1 sm:grid-cols-3 gap-y-[18px] sm:gap-4'
  const cardCls = 'ov-card flex flex-col gap-[18px] sm:gap-5 px-[18px] pt-5 pb-[22px] sm:px-7 sm:pt-[26px] sm:pb-7'
  return (
    <div className="pb-[110px] sm:pb-0">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button type="button" className="ov-ghost" onClick={goBack} aria-label="Back" style={{ width: 44, height: 44, padding: 0, flexShrink: 0 }}>
          <ArrowRight size={20} strokeWidth={2.2} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 className="text-[22px] sm:text-[26px]" style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1, color: 'var(--ov-hi)' }}>Submit a deal</h2>
          <p style={{ margin: '2px 0 0', fontSize: 13.5, color: 'var(--ov-mute)' }}>You closed it. We keep it on the books.</p>
        </div>
      </div>
      {showCap && (
        <div className="flex sm:hidden" style={{ justifyContent: 'flex-end', marginBottom: 14 }}>
          <WeeklyUsage cap={cap} pill />
        </div>
      )}

      <div className="ov-book">
        <div className="flex flex-col gap-[14px] sm:gap-5" style={{ minWidth: 0 }}>
          {carriersError}
          {capWarning}

          <section className={cardCls}>
            <StepHead n={1} title="The client and the new policy" sub="Who they are and what you just sold them" />
            <div className={grid3}>
              <OvField label="First name" placeholder="First name" autoComplete="off"
                value={form.first} onChange={e => set('first', e.target.value)} error={err1('first')} />
              <OvField label="Last name" placeholder="Last name" autoComplete="off"
                value={form.last} onChange={e => set('last', e.target.value)} error={err1('last')} />
              <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
                value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={err1('phone')} />
            </div>
            <div className={grid3}>
              <OvField className="sm:col-span-2" label="City" placeholder="Pensacola" autoComplete="off"
                value={form.city} onChange={e => set('city', e.target.value)} error={err1('city')} />
              <StateField value={form.state} onChange={v => set('state', v)} error={err1('state')} />
            </div>
            {dupText && (
              <Notice warn={confirm === 'duplicate'}>
                {dupText}
                {confirm === 'duplicate' && (
                  <span style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <button type="button" className="ov-ghost" style={pillBtn} onClick={() => { setConfirm('duplicateOk'); doSubmit() }}>Submit anyway</button>
                    <button type="button" className="ov-ghost" style={pillBtn} onClick={() => navigate(`/agent/clients?open=${duplicate.id}`)}>View it</button>
                  </span>
                )}
              </Notice>
            )}
            <div style={rule} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-[18px] sm:gap-4">
              <CarrierInput
                label="New carrier" carriers={carriers} text={form.newCarrier} picked={newPicked} error={err1('carrier')}
                onText={v => setNew(v, null)} onPick={c => setNew(c.name, c.id)} onUseText={keepTyped('new')} adding={addCarrier.isPending && addingFor === 'new'}
              />
              <OvField label="Policy number" optional icon={Hash} placeholder="If you have it yet" autoComplete="off"
                value={form.policyNumber} onChange={e => set('policyNumber', e.target.value)} />
            </div>
            <TextConsent checked={textsOk} onChange={setTextsOk} disabled={busy} />
          </section>

          <section className={cardCls}>
            <StepHead n={2} title="Did this replace an old policy?" sub="If it did, Fulfillment cancels it on a call with the client" />
            <div className="grid grid-cols-2 gap-3" style={{ borderRadius: 14, ...(err1('replaced') ? { outline: '1px solid var(--danger)', outlineOffset: 6 } : null) }}>
              <OptionCard on={replaced === true} onClick={() => answer(true)} title="Yes, it replaced one" hint="We cancel the old policy" />
              <OptionCard on={replaced === false} onClick={() => answer(false)} title="No, it’s all new" hint="No call time needed" />
            </div>
            <BestTime value={best} onChange={chooseBest} error={err1('best')} />
          </section>

          {replaced === true && (
            <CancelStep
              pick={pick} resolving={resolving} error={err1('slot')} onDate={pickDate} onSlot={pickSlot} hours="none"
              n={3} title="Old-policy cancellation" sub="Fulfillment calls with the old carrier on the line. Times are the client’s local time."
              dimText="Add the client’s city, state and old carrier first, then pick a day and time."
              lead={(
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px] sm:gap-4 sm:items-end">
                  <CarrierInput
                    label="Carrier they’re leaving" carriers={carriers} text={form.oldCarrier} picked={oldPicked} error={err1('old')}
                    onText={v => setOld(v, null)} onPick={c => setOld(c.name, c.id)} onUseText={keepTyped('old')} adding={addCarrier.isPending && addingFor === 'old'}
                  />
                  {pick.hoursLine && !pick.checking && (
                    <p style={{ margin: 0, paddingBottom: 4, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>{pick.hoursLine}</p>
                  )}
                </div>
              )}
            />
          )}
        </div>

        <div className="ov-book-side hidden sm:flex" style={{ flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <DealSummary {...summary} />
          {showCap && <WeeklyUsage cap={cap} resets={resets} noun="submissions" />}
        </div>
      </div>

      <DealSummary {...summary} bar />
    </div>
  )
}

// One Yes / No card (desktop): a title, a hint, and a ring that fills with a
// tick when picked. `icon` swaps the ring for a leading icon (best time).
function OptionCard({ on, onClick, title, hint, icon: Icon, compact }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on} className={`ov-choice${on ? ' is-on' : ''}`}
      style={{ height: 64, padding: compact ? '0 12px' : '0 16px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: compact ? 9 : 12, textAlign: 'left', minWidth: 0 }}
    >
      {Icon && <Icon size={18} strokeWidth={2} style={{ flexShrink: 0, color: on ? 'var(--ov-pick)' : 'var(--ov-mute)' }} />}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, ...ellipsis }}>{title}</span>
        <span style={{ display: 'block', marginTop: 1, fontSize: 12.5, fontWeight: 500, color: on ? 'var(--ov-pick)' : 'var(--ov-mute)', ...ellipsis }}>{hint}</span>
      </span>
      {on ? (
        <span className={`ov-tick${Icon ? ' hidden min-[1440px]:flex' : ''}`}><Check size={12} strokeWidth={3} /></span>
      ) : !Icon && (
        <span style={{ width: 18, height: 18, flexShrink: 0, boxSizing: 'border-box', borderRadius: '50%', border: '1.5px solid var(--ov-faint)' }} />
      )}
    </button>
  )
}

// "Best time for the review call": morning / afternoon / evening, on both
// branches. Desktop cards, or the phone's three tiles.
function BestTime({ value, onChange, error, phone }) {
  return (
    <>
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>Best time for the review call</div>
        <div style={{ marginTop: 1, fontSize: 13, fontWeight: 500, color: 'var(--ov-mute)' }}>
          {phone ? 'We check their new policy details. Client’s local time.' : 'We call to check their details on the new policy. Client’s local time.'}
        </div>
      </div>
      {phone ? (
        <div className={`ph-opts c3${error ? ' is-error' : ''}`}>
          {BEST.map(b => (
            <button key={b.value} type="button" className={`ph-opt tm${value === b.value ? ' is-on' : ''}`} aria-pressed={value === b.value} onClick={() => onChange(b.value)}>
              <b.icon size={18} strokeWidth={2} aria-hidden="true" /><b>{b.label}</b><small>{b.hint}</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3" style={{ borderRadius: 14, ...(error ? { outline: '1px solid var(--danger)', outlineOffset: 6 } : null) }}>
          {BEST.map(b => (
            <OptionCard key={b.value} compact on={value === b.value} onClick={() => onChange(b.value)} title={b.label} hint={b.hint} icon={b.icon} />
          ))}
        </div>
      )}
    </>
  )
}

// What happens after a deal with no old policy is submitted.
function NextSteps({ first, best }) {
  const steps = [
    ['Packet check', `We confirm ${first} got the policy packet`],
    ['Review call', `${bestLabel(best)} is best, their local time`],
    ['12-month chargeback watch', 'You hear from us before a clawback'],
  ]
  return (
    <>
      <History size={19} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-hero-dot)' }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>What happens next</div>
        <ul style={{ margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {steps.map(([t, s], i) => (
            <li key={t} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, lineHeight: 1.4, listStyle: 'none' }}>
              <span className="ov-hero-chip" style={{ width: 22, height: 22, padding: 0, justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 12 }}>{i + 1}</span>
              <span>{t}<span style={{ display: 'block', fontSize: 13, color: 'var(--ov-hero-soft)' }}>{s}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// The deal so far, with the Submit button. `bar` is the version fixed to the
// bottom of a narrow window; the phone shell uses PhoneBar instead.
function DealSummary({ name, phone, location, newCarrier, policyNumber, replaced, oldCarrier, best, scheduledAt, now, tz, left, onSubmit, busy, capped, error, bar }) {
  const when = replaced === true && scheduledAt ? dayTime(scheduledAt, now, tz) : null
  const m = when && when.match(/^(.*?)\s*(AM|PM)$/)
  const full = replaced === true && scheduledAt
    ? new Date(scheduledAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz })
    : null
  const button = (
    <button type="button" onClick={onSubmit} disabled={busy || capped} className="ov-hero-btn"
      style={{ width: '100%', height: 52, fontSize: 16, flexShrink: 0, ...(busy || capped ? { opacity: 0.6, cursor: 'not-allowed' } : null) }}>
      <Check size={18} strokeWidth={2.4} />
      {capped ? 'Weekly cap reached' : busy ? 'Submitting…' : 'Submit deal'}
    </button>
  )
  if (bar) {
    const line = replaced === true ? (when || 'Pick a time') : replaced === false ? (best ? bestLabel(best) : 'Pick a best time') : 'Answer step 2'
    return (
      <div className="ov-hero flex flex-col sm:hidden" style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, borderRadius: '22px 22px 0 0',
        padding: '16px 16px calc(20px + env(safe-area-inset-bottom))', gap: 14,
      }}>
        {error && <BookError>{error}</BookError>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, ...ellipsis }}>{name || 'New client'}</div>
          <div style={{ fontSize: 13, color: 'var(--ov-hero-soft)', ...ellipsis }}>{line}{location && ` · ${location}`}</div>
        </div>
        {button}
      </div>
    )
  }
  const big = { marginTop: 6, fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em' }
  const soft = { fontSize: 14, color: 'var(--ov-hero-soft)' }
  const row = (label, value, set) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, ...soft }}>
      <span>{label}</span>
      <b style={{ fontWeight: set ? 600 : 500, color: set ? 'inherit' : 'var(--ov-hero-soft)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</b>
    </div>
  )
  return (
    <div className="ov-hero" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 26px 22px' }}>
      <span className="ov-hero-chip" style={{ alignSelf: 'flex-start' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />Deal summary
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ClientAvatar name={name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, overflowWrap: 'anywhere' }}>{name || 'New client'}</div>
          <div style={{ marginTop: 3, ...soft }}>{phone || 'Add their name and number'}</div>
          {location && (
            <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, ...soft }}>
              <MapPin size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
              <span style={ellipsis}>{location}</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ height: 1, background: 'var(--ov-hero-soft)', opacity: 0.25 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {row('New carrier', newCarrier || 'Not added', !!newCarrier)}
        {row('Policy number', policyNumber || 'Not yet', !!policyNumber)}
        {row('Old policy', replaced === true ? (oldCarrier ? `Cancel ${oldCarrier}` : 'Add the carrier') : replaced === false ? 'None' : 'Not answered', replaced === true)}
        {row('Best time', best ? bestLabel(best) : 'Not picked', !!best)}
      </div>
      <div style={{ height: 1, background: 'var(--ov-hero-soft)', opacity: 0.25 }} />
      <div>
        {replaced === true ? (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Fulfillment calls about the old policy</div>
            {when ? (
              <>
                <div style={big}>
                  {m ? m[1] : when}
                  {m && <span style={{ marginLeft: 7, fontSize: 17, fontWeight: 500, letterSpacing: 0, color: 'var(--ov-hero-soft)' }}>{m[2]}</span>}
                </div>
                <div style={{ marginTop: 6, ...soft }}>{full}</div>
              </>
            ) : <div style={{ ...big, color: 'var(--ov-hero-soft)' }}>Pick a time</div>}
          </>
        ) : replaced === false ? (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Review call</div>
            {best ? (
              <>
                <div style={big}>{bestLabel(best)}</div>
                <div style={{ marginTop: 6, ...soft }}>Client’s local time. No call to book.</div>
              </>
            ) : <div style={{ ...big, color: 'var(--ov-hero-soft)' }}>Pick a best time</div>}
          </>
        ) : (
          <>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ov-hero-soft)' }}>Old policy</div>
            <div style={{ ...big, color: 'var(--ov-hero-soft)' }}>Answer step 2</div>
          </>
        )}
      </div>
      {button}
      {!capped && left != null && left > 0 && (
        <div style={{ marginTop: -6, textAlign: 'center', fontSize: 13, color: 'var(--ov-hero-soft)' }}>Uses 1 of the {left} you have left this week</div>
      )}
      {error && <BookError>{error}</BookError>}
    </div>
  )
}
