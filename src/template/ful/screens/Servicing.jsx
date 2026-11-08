import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Search, CalendarClock, MapPin, Hand, Undo2, Send, CircleCheck, LifeBuoy, Check, MessageSquare, Phone } from 'lucide-react'
import { useFulTasks, useFulActions } from '../data'
import { Avatar, Chip, Drawer, Empty, PillTabs, Seg, useNote } from '../../kit'
import { RecordDrawer, Block, Stepper } from '../../Record'
import { fp } from '../paths'
import { KIND, kindTone, outcomesOf, outcomeLabel, SEND_REASONS, TASK_GROUPS } from '../words'
import { HelpDot } from '../../../fulshell/training/HelpDot'
import { DocsBlock } from '../Docs886'
import { WELCOME_TEXT_ASK, ordinal } from '../../../lib/bookImport.js'
import '../../p891.css'

// P845 — Servicing: the steps agents asked for (packet checks, payment and beneficiary changes, review calls, lapse
// saves). A board like the Queue: overdue, due today, coming up, no date; each card takes its kind's colour (lib/
// vaServicing toneOf). A step opens in a drawer at its own URL: start it, pick the result from a closed list, or send
// it back to the agent when it is a coverage or advice question (a VA is unlicensed). Sample only.
const STEPS = [{ key: 'requested', label: 'Asked for' }, { key: 'scheduled', label: 'Scheduled' }, { key: 'in_progress', label: 'Working on it' }, { key: 'done', label: 'Done' }]

function TaskCard({ t, i }) {
  const tone = kindTone(t.kind)
  return (
    <article className={`fx-card fx-lcard is-${tone}`} style={{ '--i': i }}>
      <Link to={fp('servicing', t.id)} className="fx-cover" aria-label={`Open ${KIND[t.kind]} for ${t.name}`} />
      <div className="fx-lcard-top"><span className="fx-kind"><LifeBuoy size={13} aria-hidden="true" />{KIND[t.kind]}</span>{t.held && <span className="fx-tag">Working</span>}</div>
      <h3>{t.name}</h3>
      <p>{t.agent}'s client · {t.carrier}</p>
      <div className="fx-lcard-bot"><span className="fx-big">{t.due_text}</span><Avatar name={t.name} tone={tone} /></div>
    </article>
  )
}

const WHEN = ['Today, 4:30 PM', 'Fri, 10:00 AM', 'Fri, 2:00 PM', 'Mon, 11:00 AM']

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

function TaskSteps({ t }) {
  if (t.kind === 'welcome_call') return <WelcomeSteps t={t} />
  const m = t.missed
  const done = t.status === 'done'
  const agentFirst = t.agent.split(' ')[0]
  const papers = <li key="papers" className={done ? 'done' : ''}><i /><div><b>Papers, if they need any</b><span>A carrier form to sign, or a letter to send in.</span><DocsBlock bare who={t.name} carrier={t.carrier} task={t.id} /></div></li>
  const result = (
    <li key="result" className={done ? 'done' : ''}><i /><div><b>Pick what happened</b>
      <span>{t.kind === 'lapse_save' ? 'No answer puts the call back on tomorrow’s list, 3 tries in all. Fixing it sets a check in 3 business days.' : 'Anything about coverage or advice goes to the agent.'}</span>
      <ul className="fs-outs">{outcomesOf(t.kind).map(([k, label]) => <li key={k} className={t.outcome === k ? 'is-on' : ''}>{label}</li>)}</ul>
    </div></li>
  )
  const steps = m && !m.check ? [
    <li key="who" className={done ? 'done' : t.held ? 'now' : ''}><i /><div><b>Confirm it’s them</b><span>Name and date of birth.</span></div></li>,
    <li key="say" className={done ? 'done' : ''}><i /><div><b>Say why you’re calling</b><p className="fs-say">“{sayFor(t, m)}”</p></div></li>,
    <li key="fix" className={done ? 'done' : ''}><i /><div><b>Fix the payment together</b><span>A new draft date, a new card or bank, or call {t.carrier} together. Anything to change in the carrier portal goes to {agentFirst}: use Send to agent.</span></div></li>,
    papers, result,
  ] : [
    <li key="call" className={done ? 'done' : t.held ? 'now' : ''}><i /><div><b>{m ? `Check with ${t.carrier}, then call ${t.client.client_first_name} if it didn’t clear` : `Call ${t.client.client_first_name}`}</b><span>{t.client.client_phone} · {t.carrier}</span></div></li>,
    papers, result,
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
  if (!m) {
    return (
      <Block title="What the agent asked">
        <p className="tp-mid">{t.note || `${KIND[t.kind]} for ${t.name}.`}</p>
        <dl className="fx-facts">{[['Agent', t.agent], ['Policy', t.client.policy_number], ['Carrier', t.carrier], ['Due', t.due_text]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </Block>
    )
  }
  const facts = [['Policy', t.client.policy_number], ['Carrier', t.carrier], ['Payment due', m.due], ['How we heard', m.how], ['Grace ends', m.grace], ['Call by', t.due_text],
    ...(m.chargeback ? [['Chargeback watch', `Month ${m.month} of ${m.of}`]] : []), ...(m.repeat ? [['Repeat', 'Second miss in 12 months']] : [])]
  return (
    <Block title={`${m.check ? 'Check it cleared' : NOTICE[m.notice] || 'Missed payment'}${m.chargeback ? ' · chargeback risk' : ''}`} sub={`${t.agent} already knows`}>
      <p className="tp-mid">{m.check ? t.note : m.what}</p>
      <dl className="fx-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </Block>
  )
}

function TaskDrawer({ id, onClose }) {
  const { data: tasks } = useFulTasks()
  const { startTask, putBack, finishTask, scheduleTask, sendToAgent, showLive } = useFulActions()
  const note = useNote()
  const t = tasks.find(x => x.id === id)
  const [panel, setPanel] = useState(null)
  const [result, setResult] = useState(null)
  const [when, setWhen] = useState(WHEN[0])
  const [why, setWhy] = useState(SEND_REASONS[0])
  if (!t) return <RecordDrawer label="Step not found" kicker="Servicing" onClose={onClose} hero={<h2>Sent back</h2>}><p className="fx-calm"><Check size={16} aria-hidden="true" />This step went back to the agent.</p></RecordDrawer>
  const tone = kindTone(t.kind)
  const done = t.status === 'done'
  return (
    <RecordDrawer label={`${KIND[t.kind]} for ${t.name}`} kicker={<>Servicing · asked by {t.agent} <HelpDot lesson={t.kind} inline /></>} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><CalendarClock size={13} aria-hidden="true" />{t.due_text}</span><Chip tone={tone}>{KIND[t.kind]}</Chip></div>
        <h2>{t.name}</h2>
        <p><MapPin size={13} aria-hidden="true" />{t.client.city}, {t.client.state} · {t.carrier}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-num">{t.client.client_phone}</b><Avatar name={t.name} tone={tone} /></div>
      </>}
      stepper={<Stepper label="Where this step is" steps={STEPS} current={t.status} onPick={k => (k === 'in_progress' ? (startTask(t.id), note('Started')) : k === 'scheduled' ? setPanel('schedule') : k === 'done' ? setPanel('done') : null)} />}
      actions={done ? <Link to={fp('clients', t.client_id)} className="tp-btn ov-ghost">Open client</Link> : t.held ? <>
        {/* P876: a servicing step is a task the system gave the VA; its Call button starts the call on the phone. */}
        <button type="button" className="tp-primary fx-accent" onClick={() => showLive({ kind: 'task', id: t.id })}><Phone size={16} />Call</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('done')}><CircleCheck size={16} />Record the result</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('send')}><Send size={15} />Send to agent</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => { putBack(t.id); note('Put back') }}><Undo2 size={15} />Put back</button>
      </> : <>
        <button type="button" className="tp-primary fx-accent" onClick={() => { startTask(t.id); note(`Working on ${t.name}`) }}><Hand size={16} />Start</button>
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('schedule')}><CalendarClock size={15} />Schedule</button>
        <span className="tp-grow" />
        <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('send')}><Send size={15} />Send to agent</button>
      </>}>
      {done && <section className="fx-blk fs-done"><header><h3><CircleCheck size={16} aria-hidden="true" />{outcomeLabel(t.kind, t.outcome) || 'Done'}</h3></header><p className="tp-mid">{t.agent} sees the result on the client.</p></section>}
      <WhatHappened t={t} />
      <TaskSteps t={t} />
      <Block title={`Message ${t.agent}`}>
        <Link to={fp('messages')} className="fx-mrow"><MessageSquare size={16} aria-hidden="true" /><span className="tp-grow"><b>Open the thread about {t.client.client_first_name}</b><small>The client doesn't see it</small></span></Link>
      </Block>

      <Drawer open={panel === 'done'} center onClose={() => setPanel(null)} title="Record the result" sub={`${KIND[t.kind]} · ${t.name}`}
        footer={<button type="button" className="tp-primary fx-accent" disabled={!result} onClick={() => { finishTask(t.id, result); note(`${outcomeLabel(t.kind, result)}. ${t.agent} can see it`); setPanel(null) }}><CircleCheck size={16} />Save result</button>}>
        <PillTabs role="radiogroup" label="Result" className="fx-chips fs-wrap" itemClass="fx-chip" value={result} onChange={setResult} items={outcomesOf(t.kind).map(([k, label]) => ({ key: k, label: <b>{label}</b> }))} />
      </Drawer>
      <Drawer open={panel === 'schedule'} center onClose={() => setPanel(null)} title="Schedule it" sub={`${t.name} · their time`}
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { scheduleTask(t.id, when); note(`Scheduled for ${when}`); setPanel(null) }}><CalendarClock size={16} />Schedule</button>}>
        <Seg label="When" value={when} onChange={setWhen} options={WHEN.map(w => ({ key: w, label: w.replace('Today, ', '') }))} className="fs-wrap" />
      </Drawer>
      <Drawer open={panel === 'send'} center onClose={() => setPanel(null)} title={`Send to ${t.agent}`} sub="It leaves your list and goes back to the agent."
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => { sendToAgent(t.id, why); note(`Sent to ${t.agent}`); onClose() }}><Send size={16} />Send</button>}>
        <PillTabs role="radiogroup" label="Why" className="fx-chips fs-wrap" itemClass="fx-chip" value={why} onChange={setWhy} items={SEND_REASONS.map(r => ({ key: r, label: <b>{r}</b> }))} />
      </Drawer>
    </RecordDrawer>
  )
}

export default function Servicing() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: tasks } = useFulTasks()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const n = q.trim().toLowerCase()
  const open = tasks.filter(t => t.due !== 'done')
  const shown = open.filter(t => (kind === 'all' || kindTone(t.kind) === kind) && (!n || `${t.name} ${KIND[t.kind]} ${t.agent}`.toLowerCase().includes(n)))
  const done = tasks.filter(t => t.due === 'done')
  const kinds = [{ key: 'all', label: 'All', count: open.length }, { key: 'warn', label: 'Saves and watches' }, { key: 'teal', label: 'Changes' }, { key: 'blue', label: 'Calls' }, { key: 'green', label: 'Packets' }].map(o => (o.key === 'all' ? o : { ...o, count: open.filter(t => kindTone(t.kind) === o.key).length }))
  let card = 0
  return (
    <div className="tp-page fx-page fx-leads fs-serv">
      <div className="fx-tools">
        <label className="fx-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a step" placeholder="Find by client, step or agent" value={q} onChange={e => setQ(e.target.value)} /></label>
        <PillTabs label="Kind" className="fx-filters" itemClass="fx-filter" value={kind} onChange={setKind} items={kinds.map(k => ({ ...k, className: k.key === 'all' ? '' : `is-tone is-${k.key}` }))} />
        <HelpDot lesson="servicing" />
      </div>

      <div className="fx-board fs-board4" role="region" aria-label="Servicing by when it is due">
        {TASK_GROUPS.map((g, li) => {
          const rows = shown.filter(t => t.due === g.key)
          return (
            <section key={g.key} className={`fx-lane is-${g.tone}`} style={{ '--i': li }} aria-label={`${g.label}, ${rows.length}`}>
              <header className="fx-lane-h"><i aria-hidden="true" /><b>{g.label}</b><span>{rows.length}</span></header>
              <div className="fx-lane-b">
                {rows.map(t => <TaskCard key={t.id} t={t} i={card++} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No step matches.' : g.empty} />}
              </div>
            </section>
          )
        })}
      </div>

      <section className="fx-tile fs-donelist" aria-label="Done this week">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Done this week</h2><p>{done.length} steps</p></span></header>
        <ul className="fs-agents">
          {done.map(t => <li key={t.id}><Avatar name={t.name} tone="green" /><span className="tp-grow"><b>{KIND[t.kind]} · {t.name}</b><small>{t.agent} · {t.due_text}</small></span><Link to={fp('servicing', t.id)} className="fx-delta is-up">{outcomeLabel(t.kind, t.outcome)}</Link></li>)}
        </ul>
      </section>

      {id && <TaskDrawer key={id} id={id} onClose={() => navigate(fp('servicing'))} />}
    </div>
  )
}
