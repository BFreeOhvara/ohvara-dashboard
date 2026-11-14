import { useState } from 'react'
import { CalendarClock, CircleCheck, PhoneMissed, Forward, Send, Undo2, MessageSquare, Users, MessageSquareText } from 'lucide-react'
import { useFulActions, useVaBooking, useFulClock } from '../../ful/data'
import { useGate } from '../../docs886/data'
import { useClientZone } from '../../useClientZone'
import { vaSlots, freeVa, zoneAbbr, clocksBetween } from '../../../lib/callSlots'
import { SEND_REASONS } from '../../ful/words'
import { useNote } from '../../kit'
import { BottomSheet } from '../AppKit'
import { SlotChooser } from './VSlots'
import { useVaChat } from './useVaChat'
import { firstName } from './vaModel'

// P1002 — the booked-call actions the desktop has and the phone didn't (ful/screens/Calendar.jsx CallDrawer and
// Servicing.jsx TaskDrawer). A cancel-the-old-policy call: Cancelled, No answer, Move, Pass on. A booked servicing call:
// Move, Send to agent, and (once started) Record the result and Put back. Same actions, same rules as the desktop:
// Move picks a time on the client's clock where a VA on shift is free (the 30-minute rule), Pass on hands the call to
// a VA who is, Cancelled waits for the new policy to be issued.
const CLIENT_DAY = clocksBetween(8 * 60, 20 * 60 - 30) // the client's 8 AM to 8 PM; the VA shift filters it
const clientIdOf = it => it?.row?.client_id || it?.row?.client?.id || null
const idOf = it => it?.ref || it?.id

// The buttons, in the call brief. `go(what)` opens a sheet (the brief closes first); `onDone` closes the brief.
export function BriefActions({ it, go, onDone, onResult }) {
  const actions = useFulActions()
  const note = useNote()
  const gate = useGate(it?.name || '')
  const chat = useVaChat()
  if (!it) return null
  const row = it.row || {}
  const first = firstName(it.name) || 'them'
  const agentFirst = firstName(it.agent) || 'the agent'
  const isCall = it.kind === 'call'
  const open = isCall && (row.status === 'booked' || row.status === 'no_answer') && !it.done
  const held = !isCall && !!row.held
  const canMove = !it.done && !held && (isCall ? !!actions.moveCall : !!actions.moveTask)
  const clientId = clientIdOf(it)
  const btn = (key, Icon, label, run, extra = {}) => <button key={key} type="button" className="ma-btn is-soft va-act ma-press" onClick={run} disabled={extra.disabled}><Icon size={17} aria-hidden="true" />{label}</button>
  const list = []
  if (open) {
    list.push(btn('cancelled', CircleCheck, 'Cancelled', () => go('cancelled'), { disabled: !gate.open }))
    list.push(btn('noans', PhoneMissed, 'No answer', () => { actions.markCall(idOf(it), 'no_answer', { notes: row.notes || 'No answer.' }); note(`No answer logged for ${first}`); onDone() }))
  }
  if (held) list.push(btn('result', CircleCheck, 'Record the result', () => { onDone(); onResult(it) }))
  if (canMove) list.push(btn('move', CalendarClock, 'Move', () => go('move')))
  if (open) list.push(btn('pass', Forward, 'Pass on', () => go('pass')))
  if (!isCall && !it.done) list.push(btn('send', Send, 'Send to agent', () => go('send')))
  if (held) list.push(btn('back', Undo2, 'Put back', () => { actions.putBack(idOf(it)); note('Put back'); onDone() }))
  return (
    <div className="va-actions" role="group" aria-label="Call actions">
      {list.length > 0 && <div className="va-actgrid">{list}</div>}
      {open && !gate.open && <p className="ma-hint va-act-why">Cancelled waits for the new policy to be issued.</p>}
      {(clientId || it.agent) && (
        <div className="va-actgrid is-links">
          {clientId && btn('client', Users, 'Open client', () => { onDone(); chat.client(clientId) })}
          {clientId && btn('msg', MessageSquare, `Message ${agentFirst}`, () => { onDone(); chat.message(clientId) })}
        </div>
      )}
    </div>
  )
}

// The sheets the buttons open. `sheet` = { what, it }; the provider keeps it, and the last one stays while a sheet slides away.
export function CallActionSheets({ sheet, onClose }) {
  const [last, setLast] = useState(null)
  if (sheet && sheet !== last) setLast(sheet) // keep the last one while its sheet slides away
  const cur = sheet || last
  const it = cur?.it || null
  const at = w => !!sheet && sheet.what === w
  return (
    <>
      <CancelledSheet open={at('cancelled')} it={it} onClose={onClose} />
      <MoveSheet key={`m-${idOf(it)}`} open={at('move')} it={it} onClose={onClose} />
      <PassSheet open={at('pass')} it={it} onClose={onClose} />
      <SendSheet key={`s-${idOf(it)}`} open={at('send')} it={it} onClose={onClose} />
    </>
  )
}

function Head({ title, sub }) { return <><p className="ma-sheet-t">{title}</p>{sub && <p className="ma-sheet-s">{sub}</p>}</> }

function CancelledSheet({ open, it, onClose }) {
  const { markCall } = useFulActions()
  const note = useNote()
  const [text, setText] = useState('')
  const row = it?.row || {}
  const save = () => { markCall(idOf(it), 'cancelled', { notes: [row.notes, text.trim()].filter(Boolean).join('\n') }); note(`Old policy cancelled for ${firstName(it.name)}`); setText(''); onClose() }
  return (
    <BottomSheet open={open} onClose={onClose} label="Old policy cancelled">
      {it && <>
        <Head title="Old policy cancelled" sub={`${it.name} · ${row.old_carrier || ''}`.replace(/ · $/, '')} />
        <label className="va-mynotes"><span>Note · {firstName(it.agent) || 'the agent'} sees it · optional</span>
          <textarea rows={4} value={text} placeholder="Anything worth knowing about the call" onChange={e => setText(e.target.value)} />
        </label>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" onClick={save}><CircleCheck size={18} aria-hidden="true" />Save</button>
      </>}
    </BottomSheet>
  )
}

// Move: a new time on the client's clock; the slot says who it goes to (you first). The client gets the confirmation text.
function MoveSheet({ open, it, onClose }) {
  const actions = useFulActions()
  const note = useNote()
  const book = useVaBooking()
  const row = it?.row || {}
  const c = row.client || {}
  const found = useClientZone(c.state, c.city)
  const zone = it?.tz ? { ...found, tz: it.tz, auto: true } : found
  const { nowIso, bookDays, dayName, dateText, isoOf } = useFulClock()
  const [day, setDay] = useState(bookDays[0]?.[1])
  const [time, setTime] = useState('')
  const slots = vaSlots({ date: isoOf(day), clocks: zone.tz ? CLIENT_DAY : [], clientTz: zone.tz, team: book.team, calls: book.calls, load: book.load, prefer: book.me, exceptId: idOf(it) })
  const pick = slots.find(x => x.clock === time && x.open && x.iso >= nowIso)
  const first = firstName(it?.name) || 'The client'
  const save = () => {
    const mine = pick.va.id === book.me
    if (it.kind === 'call') actions.moveCall(idOf(it), pick.iso, pick.va.id)
    else actions.moveTask(idOf(it), pick.iso, pick.va.id)
    note(`Moved to ${dayName(day)}, ${dateText(day)}, ${time} ${zoneAbbr(zone.tz, pick.iso)}, their time. ${first} gets a text with the new time${mine ? '' : `. ${pick.va.name} has it now`}`)
    onClose()
  }
  return (
    <BottomSheet open={open} onClose={onClose} label="Move this call" tall>
      {it && <>
        <Head title="Move this call" sub={`${it.name} · the client's time`} />
        <SlotChooser days={bookDays} day={day} onDay={setDay} slots={slots} value={time} onPick={setTime} zone={zone} place={[c.city, c.state].filter(Boolean).join(', ')}
          viewerTz={book.viewerTz} mine={book.me} notBefore={nowIso} showVa label="New time" hint="Inside the team’s hours. Greyed-out times have no VA free." />
        <p className="ma-hint va-movetext"><MessageSquareText size={14} aria-hidden="true" />{first} gets the usual confirmation text with the new time.</p>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={!pick} onClick={save}><CalendarClock size={18} aria-hidden="true" />Move it</button>
      </>}
    </BottomSheet>
  )
}

// Pass on: to another VA on shift who is free at this call's time. Use it when you can't make the time.
function PassSheet({ open, it, onClose }) {
  const { markCall } = useFulActions()
  const note = useNote()
  const book = useVaBooking()
  const taker = it?.iso ? freeVa({ iso: it.iso, team: book.team, calls: book.calls, load: book.load, skip: [book.me] }) : null
  return (
    <BottomSheet open={open} onClose={onClose} label="Pass this call on">
      {it && <>
        <Head title="Pass this call on?" sub={it.name} />
        <p className="va-passtext">{taker
          ? `${taker.name} takes it: on shift and free at ${it.time}. Use this when you can't make the time.`
          : `Nobody else on shift is free at ${it.time}: each has a call within 30 minutes. Move it to another time instead.`}</p>
        <div className="ma-two">
          <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={onClose}>Keep it</button>
          <button type="button" className="ma-btn is-solid is-tall ma-press" disabled={!taker} onClick={() => { markCall(idOf(it), 'passed', { passed_to: taker.id }); note(`Passed on to ${taker.name}`); onClose() }}><Forward size={18} aria-hidden="true" />Pass it on</button>
        </div>
      </>}
    </BottomSheet>
  )
}

// Send to agent: it leaves the VA's list and goes back to the agent, with a reason.
function SendSheet({ open, it, onClose }) {
  const { sendToAgent } = useFulActions()
  const note = useNote()
  const [why, setWhy] = useState(SEND_REASONS[0])
  return (
    <BottomSheet open={open} onClose={onClose} label="Send to agent">
      {it && <>
        <Head title={`Send to ${it.agent || 'the agent'}`} sub="It leaves your list and goes back to the agent." />
        <p className="ma-cap">Why</p>
        <div className="va-chips" role="radiogroup" aria-label="Why">
          {SEND_REASONS.map(r => <button key={r} type="button" role="radio" aria-checked={why === r} className={`ma-chip va-tap ma-press${why === r ? ' is-solid' : ''}`} onClick={() => setWhy(r)}>{r}</button>)}
        </div>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" onClick={() => { sendToAgent(idOf(it), why); note(`Sent to ${it.agent || 'the agent'}`); onClose() }}><Send size={18} aria-hidden="true" />Send</button>
      </>}
    </BottomSheet>
  )
}
