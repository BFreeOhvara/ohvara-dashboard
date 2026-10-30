import { useRef } from 'react'
import { Check, Phone, Calendar, Sun, Clock, Moon, TriangleAlert, Info } from 'lucide-react'
import { OvField, StateField, CarrierInput, SlotSkeleton } from '../AgentUI'
import { formatPhoneInput } from '../../../lib/policyFormat'
import { addDaysStr, clientSlotISO, slotState, slotTo24h, dayGone, fmtBooking } from '../../../lib/scheduling'
import { PhoneSubHead } from '../../layout/PhoneShell'
import { dayTime } from './phoneBits'
import TextConsent from '../TextConsent'

// Prompt 772 — the booking flow (Submit) on a phone (mockup Book.dc.html). All the state and
// every rule live in BookCall.jsx's NewBooking (the same validation, carrier
// hours, notice window, taken times, duplicate check, weekly cap and server
// refusals); this is only the phone layout of it:
//   Step 1 — the client's fields stacked with big inputs; once they're all in
//            it folds to a one-line summary with Edit.
//   Step 2 — five day boxes in one row (Today + the next 3 days + Pick, which
//            opens the date picker), then Morning / Afternoon / Evening times
//            in 3 columns. Past, too-soon and taken times stay dimmed with
//            their reason.
//   A sticky card at the bottom: "Fulfillment calls <name>" with Book it.
// The tab bar is hidden here; the back arrow leaves.

const fmtNoon = (day, opts) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
const SLOT_NOTE = { past: 'Past', soon: 'Too soon', booked: 'Full' }
const SLOT_WHY = { past: 'already past', soon: 'less than 30 minutes away', booked: 'you already have a call booked at this time' }
const hourOf = s => Number(slotTo24h(s).slice(0, 2))

export function PhoneBook({
  onBack, cap, capWarning,
  form, set, errors, picked, carriers, onCarrierText, onCarrierPick, onCarrierUse, addingCarrier,
  step1Open, onEdit, onDone, filled,
  ready, checking, tz, today, date, onDate, slotsOn, daySlots, openIsoSet, now, slot, onSlot, hoursLine, closedText,
  duplicate, confirmDuplicate, onBookAnyway, onViewDuplicate,
  name, scheduledAt, onBook, busy, capped, error, textsOk, onTextsOk,
}) {
  const first = form.first.trim() ? form.first.trim()[0].toUpperCase() + form.first.trim().slice(1) : 'your client'
  const summaryLine = [form.phone, [form.city.trim(), form.state].filter(Boolean).join(', '), picked?.name].filter(Boolean).join(' · ')

  const pill = cap && cap.cap != null && (
    <span className={`ph-usepill${cap.atCap ? ' is-full' : ''}`}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} aria-hidden="true" />{cap.used} of {cap.cap} used
    </span>
  )

  return (
    <div className="ph-book">
      <div style={{ margin: '-4px -16px 0' }}>
        <PhoneSubHead title="Submit" onBack={onBack} right={pill} />
      </div>

      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {capWarning}

        {step1Open ? (
          <section className="ov-card" style={{ padding: '16px 14px 18px', borderRadius: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ph-step-label">1 · The client</div>
            <OvField label="First name" placeholder="First name" autoComplete="off" enterKeyHint="next"
              value={form.first} onChange={e => set('first', e.target.value)} error={errors.has('first')} />
            <OvField label="Last name" placeholder="Last name" autoComplete="off" enterKeyHint="next"
              value={form.last} onChange={e => set('last', e.target.value)} error={errors.has('last')} />
            <OvField label="Phone" icon={Phone} placeholder="(602) 555-0184" inputMode="tel" autoComplete="off"
              value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} error={errors.has('phone')} />
            <OvField label="City" placeholder="Pensacola" autoComplete="off"
              value={form.city} onChange={e => set('city', e.target.value)} error={errors.has('city')} />
            <StateField value={form.state} onChange={v => set('state', v)} error={errors.has('state')} />
            <CarrierInput
              label="Carrier they're leaving" carriers={carriers} text={form.carrier} picked={picked} error={errors.has('carrier')}
              onText={onCarrierText} onPick={onCarrierPick} onUseText={onCarrierUse} adding={addingCarrier}
            />
            {duplicate && (
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mid)' }}>
                <TriangleAlert size={14} strokeWidth={2} style={{ color: 'var(--ov-warn)', verticalAlign: '-2px', marginRight: 6 }} aria-hidden="true" />
                You already have {duplicate.client_first_name} {duplicate.client_last_name} booked with this number ({fmtBooking(duplicate.scheduled_call_at, duplicate.client_timezone)}).
              </p>
            )}
            {filled && (
              <button type="button" className="ov-ghost" onClick={onDone} style={{ height: 48, borderRadius: 999, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Done · pick a time
              </button>
            )}
          </section>
        ) : (
          <section className="ov-card ph-sumcard" style={{ borderRadius: 20 }}>
            <span className="ph-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ov-mute)' }}>1 · The client</span>
              <span className="ph-row-title" style={{ marginTop: 2, fontSize: 15 }}>{name}</span>
              <span className="ph-row-sub">{summaryLine}</span>
            </span>
            <button type="button" className="ov-ghost ph-edit" onClick={onEdit}>Edit</button>
          </section>
        )}

        <PhoneCancelStep
          ready={ready} checking={checking} picked={picked} tz={tz} today={today} date={date} onDate={onDate} slotsOn={slotsOn}
          daySlots={daySlots} openIsoSet={openIsoSet} now={now} slot={slot} onSlot={onSlot} hoursLine={hoursLine} closedText={closedText}
          error={errors.has('slot')}
        />

        <TextConsent checked={textsOk} onChange={onTextsOk} disabled={busy} compact />
      </div>

      <PhoneBar
        error={error} onClick={onBook} busy={busy} disabled={capped}
        confirm={confirmDuplicate && (
          <div className="ph-err" role="alert" style={{ color: 'var(--ov-hi)', background: 'linear-gradient(var(--ov-st-needs-tint), var(--ov-st-needs-tint)), var(--ph-bg)', borderColor: 'var(--ov-st-needs-edge)' }}>
            You already have {duplicate.client_first_name} {duplicate.client_last_name} booked with this number.
            <span style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="ov-ghost" onClick={onBookAnyway} style={{ height: 44, padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600 }}>Book anyway</button>
              <button type="button" className="ov-ghost" onClick={onViewDuplicate} style={{ height: 44, padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600 }}>View it</button>
            </span>
          </div>
        )}
        small={`Fulfillment calls ${first}`} big={scheduledAt ? dayTime(scheduledAt, now, tz) : 'Pick a time'}
        label="Book it" busyLabel="Booking…"
      />
    </div>
  )
}

// The Fulfillment-call day and time card on a phone: five day boxes, then
// Morning / Afternoon / Evening times. `lead` is an optional block under the
// heading (Submit puts the old carrier box there). Shared by Submit and the
// old-policy step of the new deal flow.
export function PhoneCancelStep({
  label = '2 · When should Fulfillment call?', sub = 'Times are the client’s local time', lead,
  dimText = 'Add the client’s city, state and carrier first, then pick a day and time.',
  ready, checking, picked, tz, today, date, onDate, slotsOn, daySlots, openIsoSet, now, slot, onSlot, hoursLine, closedText, error,
}) {
  const dateInput = useRef(null)
  const openPicker = () => {
    const el = dateInput.current
    if (!el) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }
  const days = [0, 1, 2, 3].map(i => addDaysStr(today, i))
  const isOther = !!date && !days.includes(date)
  const groups = [
    { label: 'Morning', icon: Sun, slots: daySlots.filter(s => hourOf(s) < 12) },
    { label: 'Afternoon', icon: Clock, slots: daySlots.filter(s => hourOf(s) >= 12 && hourOf(s) < 17) },
    { label: 'Evening', icon: Moon, slots: daySlots.filter(s => hourOf(s) >= 17) },
  ].filter(g => g.slots.length)
  return (
    <section className="ov-card" style={{ padding: '16px 14px 18px', borderRadius: 22, borderColor: ready ? 'var(--ov-st-booked-edge)' : undefined }}>
      <div className="ph-step-label">{label}</div>
      <div style={{ marginTop: 2, fontSize: 12.5, color: 'var(--ov-mute)' }}>{sub}</div>
      {lead && <div style={{ marginTop: 14 }}>{lead}</div>}

      <div className="ph-days" aria-disabled={!ready || undefined}>
        {days.map((d, i) => {
          const gone = !ready || dayGone(d, tz, now, slotsOn(d))
          const on = ready && date === d
          return (
            <button key={d} type="button" className={`ph-day${on ? ' is-on' : ''}`} disabled={gone} aria-pressed={on}
              aria-label={`${i === 0 ? 'Today' : fmtNoon(d, { weekday: 'long' })}, ${fmtNoon(d, { month: 'long', day: 'numeric' })}${gone && ready ? ', no times left' : ''}`}
              onClick={() => onDate(d)}>
              <small>{i === 0 ? 'Today' : fmtNoon(d, { weekday: 'short' })}</small>
              <b>{fmtNoon(d, { day: 'numeric' })}</b>
            </button>
          )
        })}
        <button type="button" className={`ph-day${isOther ? ' is-on' : ''}`} disabled={!ready} aria-pressed={isOther}
          aria-label={isOther ? `Picked ${fmtNoon(date, { weekday: 'long', month: 'long', day: 'numeric' })}. Pick another date` : 'Pick another date'}
          onClick={openPicker}>
          <small>{isOther ? fmtNoon(date, { weekday: 'short' }) : 'Pick'}</small>
          {isOther ? <b>{fmtNoon(date, { day: 'numeric' })}</b> : <Calendar size={20} strokeWidth={2} aria-hidden="true" />}
        </button>
      </div>
      <input
        ref={dateInput} type="date" value={date || ''} min={today} tabIndex={-1} aria-hidden="true"
        onChange={e => e.target.value && onDate(e.target.value)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }}
      />

      {!ready && !checking && (
        <div className="ov-note" style={{ marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 14 }}>
          <Info size={16} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-mute)' }} aria-hidden="true" />
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mid)' }}>{dimText}</p>
        </div>
      )}
      {checking && <p role="status" style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--ov-mid)' }}>Checking {picked?.name}’s hours…</p>}
      {hoursLine && <p style={{ margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>{hoursLine}</p>}

      {checking ? <div style={{ marginTop: 14 }}><SlotSkeleton gridClass="grid grid-cols-3" /></div> : ready && (
        groups.length === 0 ? (
          <div className="ov-note" style={{ marginTop: 14, padding: '16px 14px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)', textAlign: 'center' }}>{closedText}</div>
        ) : (
          <div className={`ph-slots-wrap${error ? ' is-error' : ''}`}>
            {groups.map(({ label, icon: Icon, slots }) => (
              <div key={label} className="ph-slotgroup">
                <div className="ph-slotgroup-label"><Icon size={14} strokeWidth={2} aria-hidden="true" />{label}</div>
                <div className="ph-slots">
                  {slots.map(s => {
                    const state = slotState(clientSlotISO(date, s, tz), { now, openIsoSet })
                    const off = state !== 'open'
                    const on = !off && slot === s
                    const [t, ap] = s.split(' ')
                    return (
                      <button key={s} type="button" disabled={off} aria-pressed={on} onClick={() => onSlot(s)}
                        aria-label={off ? `${s}, ${SLOT_WHY[state]}` : s}
                        className={`ph-slot${on ? ' is-on' : ''}${state === 'booked' ? ' is-full' : off ? ' is-off' : ''}`}>
                        <span className="ph-slot-t">{t}<small>{ap}</small></span>
                        {off && <span className="ph-slot-note">{SLOT_NOTE[state]}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  )
}

// The fixed bottom bar: an optional error and confirm block above a hero card
// with a line, a big line and the button. Book it and Submit both use it.
export function PhoneBar({ error, confirm, small, big, onClick, busy, disabled, label, busyLabel }) {
  return (
    <div className="ph-bookbar">
      {error && <div className="ph-err" role="alert">{error}</div>}
      {confirm}
      <div className="ov-hero ph-bookbar-card">
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--ov-hero-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{small}</span>
          <span style={{ display: 'block', fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {big}
          </span>
        </span>
        <button type="button" className="ov-hero-btn ph-bookbar-btn" onClick={onClick} disabled={busy || disabled}>
          <Check size={17} strokeWidth={2.4} aria-hidden="true" />{busy ? busyLabel : label}
        </button>
      </div>
    </div>
  )
}
