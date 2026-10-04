import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useCarriers } from '../../hooks/useCarriers'
import { useAgentBookings, useBookCall } from '../../hooks/useAgentBookings'
import { card, cardTitle, primaryBtn, ghostBtn, fieldLabel, eyebrow, grid3, MONO, DISPLAY } from '../../lib/exportStyles'
import { TextField, GapNote } from '../../components/ui/ExportForm'
import { SlotPicker, ScriptHint } from '../../components/agent/AgentUI'
import { formatPhoneInput, titleCase } from '../../lib/policyFormat'
import { SLOTS, slotToISO, localDateISO, isFarOut, fmtBooking } from '../../lib/scheduling'
import { stageOf, digits, useNow } from '../../lib/agentBookings'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import { capState, nextTier, formatReset, formatWeekly } from '../../lib/billing'

// Book a call (Prompt 665) — replaces the old 25-field New Submission form.
//
// The agent's whole job is the phone call: if the client's a yes, book them a
// time with Fulfillment. So the only ask before booking is who (name + phone)
// and, if the agent already knows it, which carrier they're leaving. DOB,
// address, bank and beneficiaries are gone from this flow entirely —
// Fulfillment gathers what it needs on its own call (Brayden: "if we just
// have the client, then we don't need pretty much any information").
//
// The hand-off contract is unchanged: a policies row with
// fulfillment_assigned=true, stage 'Pending', scheduled_call_at set — exactly
// what the Fulfillment desk already reads.
//
// Prompt 669 — restyled to Restorix Portal's design system: numbered steps,
// the Today/Tomorrow switch as a segmented control, a tinted footer bar for
// the booking summary. (Prompt 680: the day's-calls side panel and the
// read-to-the-client hint were removed.)

const BLANK = { first: '', last: '', phone: '', carrier: '' }

// Today, unless today's last slot has already passed — then tomorrow.
function defaultDate() {
  const today = localDateISO(0)
  return new Date(slotToISO(today, SLOTS[SLOTS.length - 1])).getTime() > Date.now() ? today : localDateISO(1)
}

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
    if (slot && new Date(slotToISO(d, slot)).getTime() <= Date.now()) setSlot('')
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
      onSuccess: () => {
        setDone({ name: `${firstName} ${lastName}`, at: scheduledAt })
        setForm(BLANK); setSlot(''); setDate(defaultDate()); setConfirm(null); setErrors(new Set())
      },
      onError: err => setError(err.hint === 'weekly_cap'
        ? `${err.message} Upgrade your plan or wait until ${formatReset(usage?.week_end)}.`
        : err.message || 'Could not book this call'),
    })
  }

  if (done) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '44px 28px', textAlign: 'center' }}>
          <span style={{
            width: 56, height: 56, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--success-dim)', color: 'var(--success)',
          }}>
            <CheckCircle2 size={26} />
          </span>
          <p style={{ ...eyebrow, marginTop: 4, color: 'var(--success)' }}>Booked with Fulfillment</p>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 24, fontWeight: 500, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>{done.name}</p>
          <p style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--text-secondary)', fontFamily: MONO }}>{fmtBooking(done.at)}</p>
          <ScriptHint>
            Before you hang up: "You're all set for {fmtBooking(done.at)}. Our Underwriting Team will give you a call
            right at that time to get everything squared away."
          </ScriptHint>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            <button onClick={() => setDone(null)} style={primaryBtn}>Book another</button>
            <button onClick={() => navigate('/agent/clients')} style={{ ...ghostBtn, height: 40 }}>
              See my clients <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const busy = book.isPending
  const capped = !!cap?.blocking

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ ...card, flex: '1 1 520px', minWidth: 0, maxWidth: 820, padding: '24px 28px' }}>
        {cap && cap.cap != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: capped ? 0 : 4 }}>
            <span style={{
              fontFamily: MONO, fontSize: 12.5, padding: '3px 10px', borderRadius: 999,
              color: cap.atCap ? 'var(--warning)' : 'var(--text-secondary)',
              background: cap.atCap ? 'var(--warning-dim)' : 'var(--bg-elevated)',
              border: `1px solid ${cap.atCap ? 'var(--warning-bd)' : 'var(--border)'}`,
            }}>
              {cap.used} of {cap.cap} submissions this week
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {cap.tierName} plan · resets {formatReset(usage.week_end)}
            </span>
          </div>
        )}
        {capped && (
          <Notice tone="warning">
            You've used all {cap.cap} submissions on the {cap.tierName} plan this week.{' '}
            {upgrade
              ? <>Upgrade to {upgrade.name} ({formatWeekly(upgrade.weekly_cents)}/week, {upgrade.weekly_cap ?? 'unlimited'} a week) to keep booking, or wait until {formatReset(usage.week_end)}.</>
              : <>The cap resets {formatReset(usage.week_end)}.</>}
            {upgrade && (
              <button onClick={() => navigate('/agent/billing')}
                style={{ ...ghostBtn, height: 30, marginLeft: 8, color: 'var(--warning)', borderColor: 'var(--warning-bd)' }}>
                Upgrade
              </button>
            )}
          </Notice>
        )}
        <Step n={1} title="Who's the client" />
        <div style={grid3}>
          <TextField label="First name" placeholder="First name" autoComplete="off"
            value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')} />
          <TextField label="Last name" placeholder="Last name" autoComplete="off"
            value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')} />
          <TextField label="Phone" mono placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
            value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
        </div>
        <div style={{ maxWidth: 360, marginBottom: 4 }}>
          <TextField
            label="Carrier they're leaving (if you know it)" placeholder="e.g. Mutual of Omaha" list="leaving-carriers"
            value={form.carrier} onChange={e => set('carrier', e.target.value)}
          />
          <datalist id="leaving-carriers">
            {carriers.map(c => <option key={c.id} value={c.name} />)}
          </datalist>
        </div>

        {duplicate && (
          <Notice tone={confirm === 'duplicate' ? 'warning' : 'muted'}>
            You already have {duplicate.client_first_name} {duplicate.client_last_name} booked with this number
            ({fmtBooking(duplicate.scheduled_call_at)}).
            {confirm === 'duplicate' && (
              <span style={{ display: 'inline-flex', gap: 8, marginLeft: 8, flexWrap: 'wrap' }}>
                <button onClick={() => { setConfirm('duplicateOk'); if (!isFarOut(scheduledAt)) doBook(); else setConfirm('farOut') }}
                  style={{ ...ghostBtn, height: 30, color: 'var(--warning)', borderColor: 'var(--warning-bd)' }}>
                  Book anyway
                </button>
                <button onClick={() => navigate('/agent/clients')} style={{ ...ghostBtn, height: 30 }}>View it</button>
              </span>
            )}
          </Notice>
        )}

        <Step n={2} title="When should Fulfillment call" />
        <SlotPicker date={date} slot={slot} onDate={pickDate} onSlot={pickSlot}
          takenCounts={takenCounts} error={errors.has('slot')} now={now} />
        <p style={{
          margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.5,
          color: isFarOut(scheduledAt) ? 'var(--warning)' : 'var(--text-muted)',
        }}>
          Today or tomorrow is the norm — further out needs Fulfillment's OK.
        </p>
        <GapNote>
          Slots don't know Fulfillment's real availability yet — there's no shared calendar behind this. "Booked"
          only counts your own calls.
        </GapNote>

        {confirm === 'farOut' && (
          <Notice tone="warning">
            That's more than a day out — confirm Fulfillment is actually booked through then?
            <span style={{ display: 'inline-flex', gap: 8, marginLeft: 8, flexWrap: 'wrap' }}>
              <button onClick={() => { setConfirm('farOutOk'); doBook() }}
                style={{ ...ghostBtn, height: 30, color: 'var(--warning)', borderColor: 'var(--warning-bd)' }}>
                Yes, book it
              </button>
              <button onClick={() => setConfirm(null)} style={{ ...ghostBtn, height: 30 }}>Change time</button>
            </span>
          </Notice>
        )}

        {error && <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '24px -28px -24px', padding: '16px 28px',
          borderTop: 'var(--border-w) solid var(--border)', background: 'var(--bg-elevated)',
          borderRadius: '0 0 16px 16px',
        }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <p style={{ ...fieldLabel, margin: 0 }}>Booking</p>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: scheduledAt ? 'var(--text-primary)' : 'var(--text-muted)', fontFamily: MONO }}>
              {[titleCase(form.first), titleCase(form.last)].filter(Boolean).join(' ') || 'Client'} · {scheduledAt ? fmtBooking(scheduledAt) : 'pick a time'}
            </p>
          </div>
          <button onClick={submit} disabled={busy || capped} style={{ ...primaryBtn, height: 44, padding: '0 26px', opacity: busy || capped ? 0.6 : 1 }}>
            {busy ? 'Booking…' : capped ? 'Weekly cap reached' : 'Book the call'}
          </button>
        </div>
      </div>

    </div>
  )
}

function Step({ n, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 0 14px' }}>
      <span style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--accent-dim)', color: 'var(--accent-deep)', fontFamily: MONO, fontSize: 12, fontWeight: 500,
      }}>{n}</span>
      <p style={{ ...cardTitle, margin: 0, fontSize: 15 }}>{title}</p>
    </div>
  )
}

function Notice({ tone, children }) {
  const warn = tone === 'warning'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16,
      padding: '12px 16px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5,
      color: warn ? 'var(--text-primary)' : 'var(--text-secondary)',
      background: warn ? 'var(--warning-dim)' : 'var(--bg-elevated)',
      border: `1px solid ${warn ? 'var(--warning-bd)' : 'var(--border)'}`,
    }}>
      <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 200 }}>{children}</span>
    </div>
  )
}
