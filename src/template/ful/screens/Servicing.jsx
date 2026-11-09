import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, MapPin, Hand, Undo2, Send, CircleCheck, Check, MessageSquare, Phone } from 'lucide-react'
import { useFulTasks, useFulActions } from '../data'
import { Avatar, Chip, Drawer, PillTabs, useNote } from '../../kit'
import { MoveBooking } from '../MoveBooking'
import { CALLBACK_WHY, isCallKind } from '../bookings'
import { WINDOWS } from '../../../lib/callSlots'
import { RecordDrawer, Block, Stepper } from '../../Record'
import { fp } from '../paths'
import { KIND, kindTone, outcomesOf, outcomeLabel, SEND_REASONS } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { DocsBlock } from '../Docs886'
import { WELCOME_TEXT_ASK, ordinal } from '../../../lib/bookImport.js'
import '../../p891.css'
import { StartCall } from '../StartCall'

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

// P888: a missed payment, lapse notice or chargeback warning is one ordinary call task (a lapse save). It comes in by
// itself: the agent's forwarded carrier email, the agent's Request service, or the client calling in. No desk, no
// portal checks. What happened sits in the first block; the call, the papers and the result are steps.
const NOTICE = { missed: 'Missed payment', lapse_notice: 'Lapse notice', chargeback_warning: 'Chargeback warning' }
const sayFor = (t, m) => `Hi ${t.client.client_first_name}, this is (your name) with Deedstone, calling for ${t.agent}. We noticed a payment on your ${t.carrier} policy didn’t go through${m.due ? ` on ${m.due}` : ''}. I want to make sure your coverage stays in place. Can we fix it together now?`

// P891: the welcome call for a client the agent brought in. The VA introduces the agent's client care team, checks
// the details the agent gave, asks about text updates (only a yes is logged as consent), and notes any problem.
const sayWelcome = t => `Hi ${t.client.client_first_name}, this is (your name) with ${t.agent}'s client care team at Deedstone. ${t.agent.split(' ')[0]} asked us to look after your ${t.carrier} policy from now on: payments, changes, your yearly review. Do you have two minutes so I can check we have your details right?`
const money = v => (v || v === 0 ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0 })}` : 'Not given')

function WelcomeSteps({ t }) {
  const { textConsent } = useFulActions()
  const note = useNote()
  const done = t.status === 'done'
  const c = t.client
  const facts = [['Name', t.name], ['Phone', c.client_phone], ['Email', c.email || 'Not given'], ['State', c.state], ['Carrier', t.carrier], ['Policy', c.policy_number],
    ['Product', c.product_name], ['Face amount', money(c.face_amount)], ['Premium', `${money(c.monthly_premium)} a month`], ['Draft day', c.draft_day ? `The ${ordinal(c.draft_day)}` : 'Not given'], ['Effective', c.effective || 'Not given']]
  const say = yes => { textConsent(t.id, yes); note(yes ? 'Yes to texts. Logged' : 'No texts. Nothing logged') }
  return (
    <Block title="On this call">
      <ol className="fs-steps">
        <li className={done ? 'done' : t.held ? 'now' : ''}><i /><div><b>Confirm it’s them</b><span>Name and date of birth.</span></div></li>
        <li className={done ? 'done' : ''}><i /><div><b>Say who you are</b><p className="fs-say">“{sayWelcome(t)}”</p></div></li>
        <li className={done ? 'done' : ''}><i /><div><b>Check the details</b><span>Read each one back. Anything wrong: fix it in your notes and pick Details fixed.</span>
          <dl className="wc-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div></li>
        <li className={done || t.texts ? 'done' : ''}><i /><div><b>Ask about text updates</b><p className="fs-say">“{WELCOME_TEXT_ASK}” <span className="tp-tag">Draft wording</span></p>
          {t.texts ? <span className="wc-said"><Check size={14} aria-hidden="true" />{t.texts === 'yes' ? 'Said yes. Logged as their text consent' : 'Said no. No texts, nothing logged'}</span>
            : !done && <div className="wc-ask"><button type="button" className="tp-primary sm fx-accent" disabled={!t.held} onClick={() => say(true)}>Yes, texts are fine</button><button type="button" className="tp-btn ov-ghost" disabled={!t.held} onClick={() => say(false)}>No texts</button></div>}
          {!t.held && !done && !t.texts && <span>Start the step to record their answer.</span>}</div></li>
        <li className={done ? 'done' : ''}><i /><div><b>Note any problem</b><span>A wrong policy, a payment issue, or a question about coverage: pick Problem → agent and say what in the note. Coverage and advice are {t.agent.split(' ')[0]}’s.</span></div></li>
        <li className={done ? 'done' : ''}><i /><div><b>Pick what happened</b><span>No answer puts the call back on the next business day, 3 tries in all. After that {t.agent.split(' ')[0]} is told.</span>
          <ul className="fs-outs">{outcomesOf(t.kind).map(([k, label]) => <li key={k} className={t.outcome === k ? 'is-on' : ''}>{label}</li>)}</ul></div></li>
      </ol>
    </Block>
  )
}

// P918: the short script for every other booked call (Brayden: a call's view has the client, the agent, why, the
// short script and the steps). Draft wording, like the rest of the scripts.
const CHANGE_KINDS = ['payment_change', 'beneficiary_change', 'address_change', 'draft_date_change', 'name_change', 'change_request']
function sayFor918(t) {
  const first = t.client.client_first_name || t.name.split(' ')[0]
  const ag = (t.agent || '').split(' ')[0]
  if (t.kind === 'handoff_call') return `Hi ${first}, this is (your name) with Deedstone, part of ${ag}’s client care team. Congratulations on your new ${t.carrier || ''} policy. I’m calling to check your details and tell you who to call for anything you need.`.replace('  ', ' ')
  if (t.kind === 'callback') {
    if (t.why === 'no_show') return `Hi ${first}, this is (your name) with Deedstone. We missed you at your call with ${ag}. Can we find a new time that works for you?`
    if (t.why === 'missed_call') return `Hi ${first}, this is (your name) with Deedstone, returning your call. How can I help?`
    return `Hi ${first}, this is (your name) with Deedstone, calling you back as promised. How can I help?`
  }
  if (t.kind === 'cancel_request') return `Hi ${first}, this is (your name) with Deedstone. You asked about cancelling your ${t.carrier || ''} policy. Before anything changes, can I ask what’s going on? There may be a way to keep your coverage.`.replace('  ', ' ')
  if (CHANGE_KINDS.includes(t.kind)) return `Hi ${first}, this is (your name) with Deedstone. ${ag} let us know you’d like a ${(KIND[t.kind] || 'change').toLowerCase()}. I can help with that now. First, let me confirm it’s you.`
  if (t.kind === 'annual_review' || t.kind === 'review_call') return `Hi ${first}, this is (your name) with Deedstone, calling for your yearly review for ${ag}. It takes five minutes: I’ll check your policy still fits and your details are right.`
  return null
}

function TaskSteps({ t }) {
  if (t.kind === 'welcome_call') return <WelcomeSteps t={t} />
  const m = t.missed
  const done = t.status === 'done'
  const agentFirst = t.agent.split(' ')[0]
  const papers = <li key="papers" className={done ? 'done' : ''}><i /><div><b>Papers, if they need any</b><span>A carrier form to sign, or a letter to send in.</span><DocsBlock bare who={t.name} carrier={t.carrier} task={t.id} /></div></li>
  const result = (
    <li key="result" className={done ? 'done' : ''}><i /><div><b>Pick what happened</b>
      <span>{t.kind === 'lapse_save' ? 'No answer books the next try on the next business day, 3 tries in all. Fixing it books a check 3 days on.' : t.kind === 'callback' || t.kind === 'handoff_call' || t.kind === 'cancel_request' ? 'No answer books the next try on the next business day, 3 tries in all. Coverage or advice goes to the agent.' : 'Anything about coverage or advice goes to the agent.'}</span>
      <ul className="fs-outs">{outcomesOf(t.kind).map(([k, label]) => <li key={k} className={t.outcome === k ? 'is-on' : ''}>{label}</li>)}</ul>
    </div></li>
  )
  const steps = m && !m.check ? [
    <li key="who" className={done ? 'done' : t.held ? 'now' : ''}><i /><div><b>Confirm it’s them</b><span>Name and date of birth.</span></div></li>,
    <li key="say" className={done ? 'done' : ''}><i /><div><b>Say why you’re calling</b><p className="fs-say">“{sayFor(t, m)}”</p></div></li>,
    <li key="fix" className={done ? 'done' : ''}><i /><div><b>Fix the payment together</b><span>A new draft date, a new card or bank, or call {t.carrier} together. Anything to change in the carrier portal goes to {agentFirst}: use Send to agent.</span></div></li>,
    papers, result,
  ] : [
    <li key="call" className={done ? 'done' : t.held ? 'now' : ''}><i /><div><b>{m ? `Check with ${t.carrier}, then call ${t.client.client_first_name} if it didn’t clear` : `Call ${t.client.client_first_name}`}</b><span>{[t.client.client_phone, t.carrier].filter(Boolean).join(" · ")}</span></div></li>,
    ...(!m && sayFor918(t) ? [<li key="say" className={done ? 'done' : ''}><i /><div><b>Say why you’re calling</b><p className="fs-say">“{sayFor918(t)}”</p></div></li>] : []),
    ...(t.kind === "callback" ? [] : [papers]), result,
  ]
  return <Block title="On this call"><ol className="fs-steps">{steps}</ol></Block>
}

function WhatHappened({ t }) {
  const m = t.missed
  if (t.kind === 'welcome_call') {
    return (
      <Block title={`Added by ${t.agent}`} sub="A client from their own book, new to the team">
        <p className="tp-mid">{t.note}</p>
        <dl className="fx-facts">{[['Agent', t.agent], ['Added', t.client.submitted], ['Try', `${t.tries || 1} of 3`], ['Call by', t.due_text]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {t.client.note && <p className="tp-sub">Agent’s note: {t.client.note}</p>}
      </Block>
    )
  }
  if (t.kind === 'callback') {
    return (
      <Block title={CALLBACK_WHY[t.why] || 'Call back'} sub={t.client.lead ? 'Not a client yet' : `${t.agent}'s client`}>
        <p className="tp-mid">{t.note}</p>
        <dl className="fx-facts">{[['Phone', t.client.client_phone], ['Lives in', [t.client.city, t.client.state].filter(Boolean).join(', ') || 'Not known'], ['Agent', t.agent], ['Booked', t.due_text]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
    )
  }
  if (t.kind === 'handoff_call') {
    return (
      <Block title={`Sold by ${t.agent}`} sub="The hand-off call after every sale">
        <p className="tp-mid">{t.note}</p>
        <dl className="fx-facts">{[['Carrier', t.carrier || 'Not given'], ['Phone', t.client.client_phone], ['Try', `${t.tries || 1} of 3`], ['Booked', t.due_text]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
    )
  }
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
    <Block title={`${m.check ? 'Check it cleared' : NOTICE[m.notice] || 'Missed payment'}${m.chargeback ? ' · chargeback risk' : ''}`} sub={`${t.agent} already knows`}>
      <p className="tp-mid">{m.check ? t.note : m.what}</p>
      <dl className="fx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Block>
  )
}

// P907: when the call is booked, who has it, and why that time (the system's pick in the client's window).
function Booked({ t, onMove }) {
  if (!t.iso || t.status === 'done') return null
  const win = WINDOWS[t.window]?.label?.toLowerCase()
  return (
    <section className="fx-blk fs-booked">
      <header><h3><CalendarClock size={16} aria-hidden="true" />Booked {t.due_text.replace(/^Today, /, 'today, ')}</h3>{onMove && <button type="button" className="fx-pillbtn" onClick={onMove}><CalendarClock size={13} aria-hidden="true" />Move</button>}</header>
      <p className="tp-mid">{t.mine === false ? `${t.vaName} has this call. ` : 'On your Calendar. '}{t.inWindow === false ? `Nothing was open in their ${win || 'usual'} window, so the system took the next open time.` : `The system picked the next open time in their ${win || 'usual'} window, their clock.`}{t.tries > 1 ? ` Try ${t.tries} of 3.` : ''}</p>
    </section>
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
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{t.due_text}</span><Chip tone={tone}>{KIND[t.kind]}</Chip></div>
        <h2>{t.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{[[t.client.city, t.client.state].filter(Boolean).join(', '), t.carrier].filter(Boolean).join(' · ')}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{t.client.client_phone}</b><Avatar name={t.name} tone={tone} /></div>
      </>}
      stepper={<Stepper label="Where this step is" steps={STEPS} current={t.status} onPick={k => (k === 'in_progress' ? (startTask(t.id), note('Started')) : k === 'scheduled' && canMove ? setPanel('move') : k === 'done' ? setPanel('done') : null)} />}
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
      <Booked t={t} onMove={canMove ? () => setPanel('move') : null} />
      <WhatHappened t={t} />
      <TaskSteps t={t} />
      <Block title={`Message ${t.agent}`}>
        <Link to={fp('messages')} className="fx-mrow"><MessageSquare size={16} aria-hidden="true" /><span className="tp-grow"><b>Open the thread about {t.client.client_first_name}</b><small>The client doesn't see it</small></span></Link>
      </Block>

      <Drawer open={panel === 'done'} center onClose={() => setPanel(null)} title="Record the result" sub={`${KIND[t.kind]} · ${t.name}`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!result} onClick={() => { finishTask(t.id, result); note(`${outcomeLabel(t.kind, result)}. ${t.agent} can see it`); setPanel(null) }}><CircleCheck size={16} />Save result</button>}>
        <PillTabs role="radiogroup" label="Result" className="fx-chips fs-wrap" itemClass="fx-chip" value={result} onChange={setResult} items={outcomesOf(t.kind).map(([k, label]) => ({ key: k, label: <b>{label}</b> }))} />
      </Drawer>
      <MoveBooking open={panel === 'move'} onClose={() => setPanel(null)} name={t.name} state={t.client.state} city={t.client.city} tz={t.tz} exceptId={t.id} onMove={(iso, va) => moveTask(t.id, iso, va)} />
      <Drawer open={panel === 'send'} center onClose={() => setPanel(null)} title={`Send to ${t.agent}`} sub="It leaves your list and goes back to the agent."
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { sendToAgent(t.id, why); note(`Sent to ${t.agent}`); onClose() }}><Send size={16} />Send</button>}>
        <PillTabs role="radiogroup" label="Why" className="fx-chips fs-wrap" itemClass="fx-chip" value={why} onChange={setWhy} items={SEND_REASONS.map(r => ({ key: r, label: <b>{r}</b> }))} />
      </Drawer>
    </RecordDrawer>
  )
}
