import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Undo2, BadgeCheck, CalendarX2, CalendarClock, Ban, CalendarCheck, Check } from 'lucide-react'
import { Drawer, Field, useNote } from './kit'
import { Select } from './Select'
import { useSampleActions, useSampleBilling, useSampleAppointments, useSampleSettings } from './data'
import { paths } from './paths'
import { agentChip, agentStatus, agentStatusOf, followDays, followUpPick, isLiveCall, needsResult, resultsFor, RESULT_LABEL, RESULT_MEANING, RESULT_STATUS } from './agentView'
import { whenLabel, timeLabel, followReminders, clockNow } from './leadLifecycle'
import { clocksBetween } from '../lib/callSlots'
import { laneOf } from './stages'
import { leadText } from './leadTexts'
import './result898.css'

// The status chip ([tone, words]) for the cards, the drawer, the palette and the Overview: the agent's five statuses
// (agentView.js), never call attempts. With only a stage, the status that stage sits in.
export const stageChip = (stage, lead) => (lead ? agentChip(lead) : [laneOf(stage).tone, laneOf(stage).label])

// P878 (N-C-45): a no-show gets a short Undo before its rebook text sends. Shown on the lead while it counts down.
const UNDO_SECONDS = 10
export function NoShowUndo({ lead }) {
  // A fresh countdown each time a no-show is marked (the key remounts it).
  return lead.undo ? <UndoBar key={`${lead.id}-${lead.events.length}`} lead={lead} /> : null
}
function UndoBar({ lead }) {
  const { undoNoShow, sendNoShowText } = useSampleActions()
  const note = useNote()
  const [left, setLeft] = useState(UNDO_SECONDS)
  useEffect(() => {
    const t = setInterval(() => setLeft(n => n - 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => { if (left <= 0) sendNoShowText(lead.id) }, [left, lead.id, sendNoShowText])
  return (
    <div className="lc-undo" role="status">
      <span className="tp-grow"><b>Marked no show</b><small>{lead.first_name}{'’'}s rebook link sends in {Math.max(left, 0)} s</small></span>
      <button type="button" className="tp-btn ov-ghost" onClick={() => { undoNoShow(lead.id); note('Undone. No text went out') }}><Undo2 size={14} aria-hidden="true" />Undo</button>
    </div>
  )
}

const REASONS = ['Not interested right now', 'Already covered', 'Cannot afford it', 'Wrong number']
const ICON = { sold: BadgeCheck, no_show: CalendarX2, follow_up: CalendarClock, not_interested: Ban, booked: CalendarCheck }
const SAVE = { sold: 'Mark sold', no_show: 'Mark no show', follow_up: 'Set follow up', not_interested: 'Mark not interested', booked: 'Move to Booked' }

// P898 — the status picker: one clean sheet (centred on desktop and tablet, sliding up from the bottom on a phone). The
// lead's name on top, then only the results its status allows (agentView.js resultsFor) as large choices in each
// status's colour with a one-line meaning; the Follow up day, the Not interested reason and the No show text show
// inline under the picked choice. Sold offers "Submit for servicing" when the plan has servicing. start: open at that result.
// P910: Follow up is the agent's own call on their calendar. A day and time are optional: with none, the system books
// the lead's best window (else afternoon), 30 minutes clear of other calls (agentView.js followUpPick), shown before
// saving. The lead gets the two reminder texts. Sold opens Submit with what we already have filled in.
const FOLLOW_CLOCKS = clocksBetween(8 * 60, 19 * 60 + 30)
export function OutcomePrompt({ lead, start = null, onClose }) {
  const { moveLead, markNoShow } = useSampleActions()
  const { data: billing } = useSampleBilling()
  const { data: appts } = useSampleAppointments()
  const { data: settings } = useSampleSettings()
  const note = useNote()
  const allowed = lead ? resultsFor(lead) : []
  const [how, setHow] = useState(allowed.includes(start) ? start : allowed.length === 1 ? allowed[0] : null)
  const [day, setDay] = useState(null)
  const [time, setTime] = useState('')
  const [why, setWhy] = useState(REASONS[0])
  const [sold, setSold] = useState(false)
  if (!lead) return null
  const name = `${lead.first_name} ${lead.last_name}`
  const plan = billing.servicing?.status === 'active'
  const live = isLiveCall(lead)
  const days = followDays()
  const picked = days.find(d => d.at === day)
  const pickDate = picked ? picked.at.slice(0, 10) : null
  const slotOf = t => followUpPick(lead, { appts, settings, date: pickDate, time: t || null })
  const slot = how === 'follow_up' ? slotOf(time) : null
  const times = pickDate ? FOLLOW_CLOCKS.map(c => ({ value: c, label: c, disabled: !slotOf(c)?.free, sub: slotOf(c)?.free ? undefined : 'Too close to a call, or outside your hours' })) : []
  const ready = !!how && (how !== 'follow_up' || (!!slot && slot.free !== false))
  const save = () => {
    if (how === 'no_show') { markNoShow(lead.id); onClose(); return }
    if (how === 'booked') { moveLead(lead.id, 'booked'); note(`${name} moved to Booked`); onClose(); return }
    moveLead(lead.id, how, how === 'follow_up' ? { follow: whenLabel(slot.at), followAt: slot.at, followAuto: !slot.picked, slotIso: slot.iso } : how === 'not_interested' ? { reason: why } : {})
    if (how === 'sold') { setSold(true); note(`${name} marked sold`); return }
    note(how === 'follow_up' ? `Follow up on your calendar: ${whenLabel(slot.at)}. ${lead.first_name} gets a reminder the day before and that morning` : `${name} marked not interested`)
    onClose()
  }

  if (sold) {
    return (
      <Drawer open center onClose={onClose} title="Marked sold" sub={name}
        footer={<>{plan
          ? <Link to={paths.submit(lead.id)} className="tp-primary fx-accent" onClick={onClose}>Submit for servicing</Link>
          : <Link to={paths.billing()} className="tp-primary fx-accent" onClick={onClose}>Turn on servicing</Link>}
          <button type="button" className="tp-btn ov-ghost" onClick={onClose}>Later</button></>}>
        <div className="rs" data-sheet="result">
          <p className="tp-mid">Nice work.</p>
          {plan
            ? <p className="tp-sub">Submit the policy and the team takes it from here: the review call, the carrier and every change after. {lead.first_name}{'’'}s details fill in for you.</p>
            : <p className="tp-sub">Your plan does not include policy servicing yet. Turn it on in Billing and the team handles {lead.first_name}{'’'}s policy for you.</p>}
        </div>
      </Drawer>
    )
  }

  const now = agentStatus(agentStatusOf(lead))
  const sub = live ? 'Live call · how did it go?' : needsResult(lead) && lead.appt ? `${lead.appt} · how did it go?` : `On ${now.label} now · pick the result`
  return (
    <Drawer open center onClose={onClose} title={name} sub={sub}
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={save}>{how ? SAVE[how] : 'Pick a result'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <div className="rs" data-sheet="result">
        {allowed.length
          ? <div className="rs-opts" role="radiogroup" aria-label="Result">
            {allowed.map(k => {
              const st = agentStatus(RESULT_STATUS[k])
              const Icon = ICON[k]
              const on = how === k
              return (
                <button key={k} type="button" role="radio" aria-checked={on} data-result={k} className={`rs-opt is-${st.tone}${on ? ' is-on' : ''}`} onClick={() => setHow(k)}>
                  <span className="rs-ic" aria-hidden="true"><Icon size={18} /></span>
                  <span className="rs-t"><b>{RESULT_LABEL[k]}</b><small>{RESULT_MEANING[k]}</small></span>
                  <span className="rs-dot" aria-hidden="true">{on && <Check size={13} strokeWidth={3} />}</span>
                </button>
              )
            })}
          </div>
          : <p className="tp-sub">Nothing to mark on this lead.</p>}

        {how === 'sold' && <p className="rs-note">{plan ? 'Next you can submit it for servicing. The details fill in for you.' : 'Your plan does not include policy servicing yet.'}</p>}
        {how === 'follow_up' && <div className="rs-more is-teal">
          <b className="rs-h">When do you call {lead.first_name} again? Optional</b>
          <div className="rs-days" role="radiogroup" aria-label="Follow up day">
            <button type="button" role="radio" aria-checked={!day} className={`rs-day is-auto${!day ? ' is-on' : ''}`} onClick={() => { setDay(null); setTime('') }}>
              <small>Best</small><b>time</b>
            </button>
            {days.map(d => (
              <button key={d.at} type="button" role="radio" aria-checked={day === d.at} className={`rs-day${day === d.at ? ' is-on' : ''}`} onClick={() => { setDay(d.at); setTime('') }}>
                <small>{d.label.slice(0, 3)}</small><b>{d.label.slice(5)}</b>
              </button>
            ))}
          </div>
          {day && <Field label="Time, optional" hint="Your time. Leave it and we pick the best open time that day."><Select label="Time" placeholder="Best open time" value={time} onChange={setTime} options={[{ value: '', label: 'Best open time' }, ...times]} /></Field>}
          <p className="rs-note" data-follow-slot={slot?.iso || ''}>{slot
            ? slot.picked ? `On your calendar ${whenLabel(slot.at)}.` : `We book it for you: ${whenLabel(slot.at)}, ${slot.inWindow ? `in ${lead.first_name}’s ${slot.window || 'best'} window` : 'the next open time'}, 30 minutes clear of your other calls.`
            : 'No open time in the next two weeks. Pick a day and time.'}</p>
          {slot && (() => {
            const texts = followReminders(slot.at, clockNow())
            return texts.length > 0
              ? <div className="tp-chat">{texts.map(r => <div key={r.step} className="tp-bub me">{leadText(r.step, { lead: lead.first_name, appt: timeLabel(slot.at) })}<small>{r.step === 'follow_day_before' ? 'The day before, 6:30 PM' : 'That morning, 8:30 AM'} · sends when your leads go live</small></div>)}</div>
              : <p className="tp-sub" data-follow-texts="none">It{'’'}s today, so no reminder text goes out.</p>
          })()}
        </div>}
        {how === 'not_interested' && <div className="rs-more is-mute"><Field label="Reason" hint="All calls and texts stop."><Select label="Reason" value={why} onChange={setWhy} options={REASONS} /></Field></div>}
        {how === 'booked' && <p className="rs-note">{lead.first_name} goes on Booked. Send a booking link from the lead if they still need to pick a time.</p>}
        {how === 'no_show' && <div className="rs-more is-warn">
          <p className="rs-note">{lead.first_name} gets a text right away with a one-tap link to pick a new time, and our team is booked to call and book them again (the next open time in their best window). When they rebook, they go back to Booked on your calendar. You have {UNDO_SECONDS} seconds to undo.</p>
          <div className="tp-chat"><div className="tp-bub me">{leadText('no_show_link', { lead: lead.first_name })}<small>Deedstone · sends when your leads go live</small></div></div>
        </div>}
      </div>
    </Drawer>
  )
}

// The lead's Sold / Not interested buttons and the stepper open the prompt at that outcome.
export function OutcomeDrawer({ lead, kind, onClose }) {
  if (!lead || !kind) return null
  return <OutcomePrompt lead={lead} start={kind} onClose={onClose} />
}
