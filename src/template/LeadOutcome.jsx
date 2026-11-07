import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Undo2 } from 'lucide-react'
import { Drawer, Field, Seg, Switch, useNote } from './kit'
import { Select } from './Select'
import { useSampleActions, useSampleBilling } from './data'
import { paths } from './paths'
import { agentChip } from './agentView'
import { laneOf } from './stages'
import { leadText } from './leadTexts'

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
      <span className="tp-grow"><b>Marked no-show</b><small>{lead.first_name}{'’'}s rebook link sends in {Math.max(left, 0)} s</small></span>
      <button type="button" className="tp-btn ov-ghost" onClick={() => { undoNoShow(lead.id); note('Undone. No text went out') }}><Undo2 size={14} aria-hidden="true" />Undo</button>
    </div>
  )
}

const FOLLOW_DAYS = ['Mon, Nov 2', 'Tue, Nov 3', 'Wed, Nov 4', 'Thu, Nov 5', 'Fri, Nov 6', 'Mon, Nov 9']
const REASONS = ['Not interested right now', 'Already covered', 'Cannot afford it', 'Wrong number']
const SHOWED = [{ key: 'showed', label: 'Showed' }, { key: 'no_show', label: 'No-show' }]
const HOW = [{ key: 'sold', label: 'Sold' }, { key: 'follow_up', label: 'Follow up' }, { key: 'not_interested', label: 'Not interested' }]

// P873 — after an appointment (or a live call): did they show, and how did it go? Showed → Sold / Follow up /
// Not interested; No-show hands them back to the team to rebook. Sold offers "Submit for servicing" when the agent's
// plan has servicing. start: skip straight to an outcome (the Sold / Not interested buttons on the lead).
export function OutcomePrompt({ lead, start = null, onClose }) {
  const { moveLead, markNoShow, sendBookingLink } = useSampleActions()
  const { data: billing } = useSampleBilling()
  const note = useNote()
  const [came, setCame] = useState(start ? 'showed' : null)
  const [how, setHow] = useState(start)
  const [when, setWhen] = useState(FOLLOW_DAYS[3])
  const [why, setWhy] = useState(REASONS[0])
  const [link, setLink] = useState(true)
  const [sold, setSold] = useState(false)
  if (!lead) return null
  const name = `${lead.first_name} ${lead.last_name}`
  const plan = billing.servicing?.status === 'active'
  const ready = came === 'no_show' || (came === 'showed' && how)
  const save = () => {
    if (came === 'no_show') { markNoShow(lead.id); onClose(); return }
    moveLead(lead.id, how, how === 'follow_up' ? { follow: when } : how === 'not_interested' ? { reason: why } : {})
    if (how === 'follow_up' && link) sendBookingLink(lead.id)
    if (how === 'sold') { setSold(true); note(`${name} marked sold`); return }
    note(how === 'follow_up' ? `Follow up set for ${when}${link ? '. Booking link sent' : ''}` : `${name} marked not interested`)
    onClose()
  }

  if (sold) {
    return (
      <Drawer open onClose={onClose} title="Marked sold" sub={name}
        footer={<>{plan
          ? <Link to={paths.submit(lead.id)} className="tp-primary fx-accent" onClick={onClose}>Submit for servicing</Link>
          : <Link to={paths.billing()} className="tp-primary fx-accent" onClick={onClose}>Turn on servicing</Link>}
          <button type="button" className="tp-btn ov-ghost" onClick={onClose}>Later</button></>}>
        <p className="tp-mid">Nice work.</p>
        {plan
          ? <p className="tp-sub">Submit the policy and the team takes it from here: the review call, the carrier and every change after. {lead.first_name}{'’'}s details fill in for you.</p>
          : <p className="tp-sub">Your plan does not include policy servicing yet. Turn it on in Billing and the team handles {lead.first_name}{'’'}s policy for you.</p>}
      </Drawer>
    )
  }

  return (
    <Drawer open onClose={onClose} title="How did it go?" sub={`${name}${lead.appt ? ` · ${lead.appt}` : ''}`}
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={save}>{came === 'no_show' ? 'Mark no-show' : how === 'sold' ? 'Mark sold' : 'Save'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <div className="lc-q"><b>Did {lead.first_name} show up?</b><Seg label={`Did ${lead.first_name} show up?`} value={came} onChange={v => { setCame(v); if (v === 'no_show') setHow(null) }} options={SHOWED} role="radiogroup" /></div>
      {came === 'showed' && <div className="lc-q"><b>How did it go?</b><Seg label="How did it go?" value={how} onChange={setHow} options={HOW} role="radiogroup" /></div>}
      {came === 'showed' && how === 'sold' && <p className="tp-sub">{plan ? 'Next you can submit it for servicing. The details fill in for you.' : 'Your plan does not include policy servicing yet.'}</p>}
      {came === 'showed' && how === 'follow_up' && <>
        <Field label="Follow up on" hint="It shows in Needs you now on the day."><Select label="Follow up on" value={when} onChange={setWhen} options={FOLLOW_DAYS} /></Field>
        <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Send a booking link</b><p className="tp-sub">An automatic text lets {lead.first_name} pick a time on your calendar.</p></div><Switch on={link} label="Send a booking link" onChange={setLink} /></div>
        {link && <div className="tp-chat"><div className="tp-bub me">{leadText('booking_link', { lead: lead.first_name })}<small>Deedstone · draft wording · sends when your leads go live</small></div></div>}
      </>}
      {came === 'showed' && how === 'not_interested' && <Field label="Reason" hint="All calls and texts stop."><Select label="Reason" value={why} onChange={setWhy} options={REASONS} /></Field>}
      {came === 'no_show' && <>
        <p className="tp-sub">{lead.first_name} gets a text right away with a one-tap link to pick a new time. If they don{'’'}t, the team calls. You have {UNDO_SECONDS} seconds to undo.</p>
        <div className="tp-chat"><div className="tp-bub me">{leadText('no_show_link', { lead: lead.first_name })}<small>Deedstone · draft wording · sends when your leads go live</small></div></div>
      </>}
    </Drawer>
  )
}

// The lead's Sold / Not interested buttons and the stepper open the prompt at that outcome.
export function OutcomeDrawer({ lead, kind, onClose }) {
  if (!lead || !kind) return null
  return <OutcomePrompt lead={lead} start={kind} onClose={onClose} />
}
