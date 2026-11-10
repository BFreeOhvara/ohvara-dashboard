import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, MapPin, Hand, Undo2, Send, CircleCheck, Check, Phone } from 'lucide-react'
import { useFulTasks, useFulActions, bookedText } from '../data'
import { Avatar, Chip, Drawer, PillTabs, useNote } from '../../kit'
import { MoveBooking } from '../MoveBooking'
import { isCallKind } from '../bookings'
import { RecordDrawer, Block, Stepper } from '../../Record'
import { fp } from '../paths'
import { KIND, kindTone, outcomesOf, outcomeLabel, SEND_REASONS } from '../words'
import { NOT_SAVED_REASONS } from '../../../lib/clientLine'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { DocsBlock } from '../Docs886'
import '../../p891.css'
import { StartCall } from '../StartCall'
import { CallBody } from '../CallPanel'
import { whyShort } from '../callSteps'
import { CarrierWay } from '../Playbook932'
import { actionOf } from '../../../lib/servicing/playbook.js'

// P918 — no Servicing page any more. This file keeps the call view for every booking that isn't a cancel-the-old-policy
// call (it opens on the Calendar at /fulfillment/calendar/<id>, and from a client's drawer): who, why, the short script,
// the steps, and Start call, which turns on only near the call's time. A step that isn't a call (a packet check) still
// opens here from its client; the client's stage checklist is where that work lives.
// P845 — Servicing: the steps agents asked for (packet checks, payment and beneficiary changes, review calls, lapse
// saves). A board: overdue, booked today, booked later, not a call; each card takes its kind's colour (lib/
// vaServicing toneOf). A step opens in a drawer at its own URL: start it, pick the result from a closed list, or send
// it back to the agent when it is a coverage or advice question (a VA is unlicensed). Sample only.
// P907: every step that is a call with the client is booked by the system (the client's preferred window, a VA on
// shift who is free) and sits on that VA's Schedule. Here the whole team's steps show with who has each one; Move
// picks another time (the client gets a confirmation text). There is no manual "Schedule it" any more.
const STEPS = [{ key: 'requested', label: 'Asked for' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'in_progress', label: 'Working on it' }, { key: 'done', label: 'Done' }]

// P931 — every call with a client (booked or not) opens as the call panel (../CallPanel): why, the agent's note, the
// client, at most 3 steps, Texts closed. What's left here is a step that isn't a call (a packet check, a chargeback
// watch): what the agent asked, the papers if any, and the result.
const NOTICE = { missed: 'Missed payment', lapse_notice: 'Lapse notice', chargeback_warning: 'Chargeback warning' }

// The welcome call's text-updates question: only a yes is logged as consent (P891).
function WelcomeAsk({ t }) {
  const { textConsent } = useFulActions()
  const note = useNote()
  const say = yes => { textConsent(t.id, yes); note(yes ? 'Yes to texts. Logged' : 'No texts. Nothing logged') }
  if (t.texts) return <span className="wc-said"><Check size={14} aria-hidden="true" />{t.texts === 'yes' ? 'Said yes. Logged as their text consent' : 'Said no. No texts, nothing logged'}</span>
  if (t.status === 'done') return null
  return (
    <>
      <div className="wc-ask"><button type="button" className="tp-primary sm fx-accent" disabled={!t.held} onClick={() => say(true)}>Yes, texts are fine</button><button type="button" className="tp-btn ov-ghost" disabled={!t.held} onClick={() => say(false)}>No texts</button></div>
      {!t.held && <span>Start the call to record their answer.</span>}
    </>
  )
}

function TaskSteps({ t }) {
  const done = t.status === 'done'
  return (
    <Block title="Steps">
      <ol className="fs-steps">
        <li className={done ? 'done' : ''}><i /><div><b>Papers, if they need any</b><span>A carrier form to sign, or a letter to send in.</span><DocsBlock bare who={t.name} carrier={t.carrier} task={t.id} /></div></li>
        <li className={done ? 'done' : ''}><i /><div><b>Pick what happened</b><span>Anything about coverage or advice goes to the agent.</span>
          <ul className="fs-outs">{outcomesOf(t.kind).map(([k, label]) => <li key={k} className={t.outcome === k ? 'is-on' : ''}>{label}</li>)}</ul></div></li>
      </ol>
    </Block>
  )
}

function WhatHappened({ t }) {
  const m = t.missed
  if (!m) {
    return (
      <Block title="What the agent asked">
        <p className="tp-mid">{t.note || `${KIND[t.kind]} for ${t.name}.`}</p>
        <dl className="fx-facts">{[['Agent', t.agent], ['Policy', t.client.policy_number], ['Carrier', t.carrier || 'Not given'], [t.iso ? 'Booked' : 'Due', t.due_text]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
    )
  }
  const facts = [['Policy', t.client.policy_number], ['Carrier', t.carrier], ['Payment due', m.due], ['How we heard', m.how], ['Grace ends', m.grace], [t.iso ? 'Booked' : 'Call by', t.due_text],
    ...(m.chargeback ? [['Chargeback watch', `Month ${m.month} of ${m.of}`]] : []), ...(m.repeat ? [['Repeat', 'Second miss in 12 months']] : [])]
  return (
    <Block title={`${NOTICE[m.notice] || 'Missed payment'}${m.chargeback ? ' · chargeback risk' : ''}`} sub={`${t.agent} already knows`}>
      <p className="tp-mid">{m.what}</p>
      <dl className="fx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Block>
  )
}

export function TaskDrawer({ id, onClose }) {
  const { data: tasks } = useFulTasks()
  const { startTask, putBack, finishTask, moveTask, sendToAgent, showLive } = useFulActions()
  const note = useNote()
  const t = tasks.find(x => x.id === id)
  const [panel, setPanel] = useState(null)
  const [result, setResult] = useState(null)
  const [why, setWhy] = useState(SEND_REASONS[0])
  const [lost, setLost] = useState(null)
  if (!t) return <RecordDrawer label="Step not found" kicker="Calendar" onClose={onClose} hero={<h2>Sent back</h2>}><p className="fx-calm"><Check size={16} aria-hidden="true" />This step went back to the agent.</p></RecordDrawer>
  const tone = kindTone(t.kind)
  const done = t.status === 'done'
  const canMove = !done && isCallKind(t.kind) && !!moveTask
  // P918: a booked call starts only at its time (StartCall); starting it takes the step and opens the phone.
  const booked = isCallKind(t.kind) && !!t.iso
  const startCall = () => { if (!t.held) startTask(t.id); showLive({ kind: 'task', id: t.id }) }
  const openClient = t.client_id ? <Link to={fp('clients', t.client_id)} className="tp-btn ov-ghost">Open client</Link> : null
  return (
    <RecordDrawer label={`${KIND[t.kind]} for ${t.name}`} kicker={<>{booked ? 'Booked call' : 'Client step'} · {t.agent}{t.agent ? '’s client' : ''} <HelpDot lesson={t.kind} inline /></>} tone={tone} onClose={onClose}
      hero={isCallKind(t.kind) ? <>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{t.due_text}</span><Chip tone={tone}>{whyShort(t)}</Chip></div>
        <h2>{t.name}</h2>
      </> : <>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{t.due_text}</span><Chip tone={tone}>{KIND[t.kind]}</Chip></div>
        <h2>{t.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{[[t.client.city, t.client.state].filter(Boolean).join(', '), t.carrier].filter(Boolean).join(' · ')}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{t.client.client_phone}</b><Avatar name={t.name} tone={tone} /></div>
      </>}
      stepper={isCallKind(t.kind) ? null : <Stepper label="Where this step is" steps={STEPS} current={t.status} onPick={k => (k === 'in_progress' ? (startTask(t.id), note('Started')) : k === 'done' ? setPanel('done') : null)} />}
      actions={done ? openClient : booked ? <>
        <StartCall iso={t.iso} onStart={startCall} label={t.held ? 'Call' : 'Start call'} />
        {t.held && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('done')}><CircleCheck size={16} />Record the result</button>}
        {!t.held && canMove && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('move')}><CalendarClock size={15} />Move</button>}
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('send')}><Send size={15} />Send to agent</button>
        {t.held && <button type="button" className="tp-btn ov-ghost" onClick={() => { putBack(t.id); note('Put back') }}><Undo2 size={15} />Put back</button>}
      </> : t.held ? <>
        {/* P876: a servicing step is a task the system gave the VA; its Call button starts the call on the phone. */}
        <button type="button" className="tp-primary fx-accent" onClick={() => showLive({ kind: 'task', id: t.id })}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('done')}><CircleCheck size={16} />Record the result</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('send')}><Send size={15} />Send to agent</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => { putBack(t.id); note('Put back') }}><Undo2 size={15} />Put back</button>
      </> : <>
        <button type="button" className="tp-primary fx-accent" onClick={() => { startTask(t.id); note(`Working on ${t.name}`) }}><Hand size={16} />Start</button>
        {canMove && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('move')}><CalendarClock size={15} />Move</button>}
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('send')}><Send size={15} />Send to agent</button>
      </>}>
      {done && <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />{outcomeLabel(t.kind, t.outcome) || 'Done'}</h3></header><p className="tp-mid">{t.agent} sees the result on the client.</p></section>}
      {/* P931: a booked call is just a call: why, the agent's note, the client, at most 3 steps, Texts closed. */}
      {isCallKind(t.kind) ? <CallBody item={t} done={done} now={!!t.held} bookedWhen={bookedText(t.iso, t.tz)} welcome={t.kind === 'welcome_call' ? <WelcomeAsk t={t} /> : null}
        gate={t.mine === false ? <p className="cp-gate">{t.vaName} has this call.</p> : null} /> : <>
        <WhatHappened t={t} />
        {/* P932: the carrier's way for this change, ready before the call (method, line, hours, have-ready, form). */}
        {actionOf(t.kind) && t.carrier && <CarrierWay carrier={t.carrier} kind={t.kind} itemId={t.id} first={(t.name || '').split(' ')[0] || 'They'} done={done} />}
        <TaskSteps t={t} />
      </>}

      <Drawer open={panel === 'done'} center onClose={() => setPanel(null)} title="Record the result" sub={`${KIND[t.kind]} · ${t.name}`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!result || (result === 'not_saved' && !lost)} onClick={() => { finishTask(t.id, result, lost); note(`${outcomeLabel(t.kind, result)}. ${t.agent} can see it`); setPanel(null) }}><CircleCheck size={16} />Save result</button>}>
        <PillTabs role="radiogroup" label="Result" className="fx-chips fs-wrap" itemClass="fx-chip" value={result} onChange={setResult} items={outcomesOf(t.kind).map(([k, label]) => ({ key: k, label: <b>{label}</b> }))} />
        {/* P924: a save call ends in the agent's hands (live or booked) or in Closed with the reason. */}
        {t.kind === 'lapse_save' && result === 'to_agent' && <p className="tp-mid fs-hint">Use Check agent on the call first. If {t.agent} picks up, the client is handed over live.</p>}
        {t.kind === 'lapse_save' && result === 'agent_booked' && <p className="tp-mid fs-hint">The call lands on {t.agent}'s calendar in their next open time. They see why on the client.</p>}
        {t.kind === 'lapse_save' && result === 'not_saved' && <>
          <p className="tp-mid fs-hint">The client moves to Closed on {t.agent}'s side with this reason.</p>
          <PillTabs role="radiogroup" label="Why it can't be saved" className="fx-chips fs-wrap" itemClass="fx-chip" value={lost} onChange={setLost} items={NOT_SAVED_REASONS.map(r => ({ key: r, label: <b>{r}</b> }))} />
        </>}
      </Drawer>
      <MoveBooking open={panel === 'move'} onClose={() => setPanel(null)} name={t.name} state={t.client.state} city={t.client.city} tz={t.tz} exceptId={t.id} onMove={(iso, va) => moveTask(t.id, iso, va)} />
      <Drawer open={panel === 'send'} center onClose={() => setPanel(null)} title={`Send to ${t.agent}`} sub="It leaves your list and goes back to the agent."
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { sendToAgent(t.id, why); note(`Sent to ${t.agent}`); onClose() }}><Send size={16} />Send</button>}>
        <PillTabs role="radiogroup" label="Why" className="fx-chips fs-wrap" itemClass="fx-chip" value={why} onChange={setWhy} items={SEND_REASONS.map(r => ({ key: r, label: <b>{r}</b> }))} />
      </Drawer>
    </RecordDrawer>
  )
}
