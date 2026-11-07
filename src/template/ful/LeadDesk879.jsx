import { useEffect, useState } from 'react'
import { BellRing, Check, CircleSlash, Info, PhoneForwarded, PhoneOff, ShieldAlert, Voicemail, UserX, CalendarCheck, Undo2, FileCheck2, MessageSquareText, Phone } from 'lucide-react'
import { Chip, Field, SampleTag, useNote } from '../kit'
import { Select } from '../Select'
import { Block } from '../Record'
import {
  flagsOf, sourceOf, CONSENT_LINE, agentForState, agentCheck, checkStep, CHECK_WORD, OUTCOMES, WRAP_REMIND_S, ageRule, SOMEONE_ELSE,
  SCRIPTS, BOUNDARY, COVERAGE_CUE, requiredLeft, VOICEMAIL, ALERTS_ADMIN, bestNumberCheck, NOTE_CHIPS, myCallTasks, mmss,
} from './p879'
import { liveHoursText } from '../../lib/leadSplit'
import { zoneAbbr } from '../../lib/callSlots'
import './p879.css'

// P879 — the lead drawer's new blocks (Queue › a lead), sample only until 852 wires calls, pushes and texts. Calling
// from the portal is off (voice_live), so Check agent runs in a labelled sample mode: no real push, transfer or bill.
const mem = {} // this visit's state per lead, so closing and reopening the drawer keeps it
const useLeadState = (id, key, init) => {
  const k = `${id}:${key}`
  const [v, setV] = useState(() => { if (!(k in mem)) mem[k] = typeof init === 'function' ? init() : init; return mem[k] })
  return [v, x => { const n = typeof x === 'function' ? x(v) : x; mem[k] = n; setV(n) }]
}

// N-B-42, N-B-17: opted out or closed → a banner (answer, but no texts and no outbound calls); a call-in reads the
// verbal consent line first, and texts stay off until it's captured.
export function LeadFlags({ l }) {
  const f = flagsOf(l)
  const [said, setSaid] = useLeadState(l.id, 'consent', false)
  return (<>
    {f.optedOut && <p className="v879-band is-warn" role="status"><CircleSlash size={16} aria-hidden="true" /><span><b>Opted out: no texts, no outbound calls</b><small>They called in, so talk to them. Nothing is texted unless they opt back in.</small></span></p>}
    {f.closed && !f.optedOut && <p className="v879-band" role="status"><Info size={16} aria-hidden="true" /><span><b>Closed lead calling in</b><small>They reopen as New once you save an outcome.</small></span></p>}
    {f.callIn && (
      <section className="fx-blk">
        <header><h3><FileCheck2 size={16} aria-hidden="true" />Read the consent line</h3>{said ? <Chip tone="green">Captured</Chip> : <Chip tone="warn">Texts off</Chip>}</header>
        <p className="tp-mid">"{CONSENT_LINE}"</p>
        <button type="button" className={said ? 'tp-btn sm ov-ghost' : 'tp-primary sm fx-accent'} onClick={() => setSaid(!said)}>{said ? <><Undo2 size={14} />Undo</> : <><Check size={14} />They said yes</>}</button>
      </section>
    )}
  </>)
}

// N-B-50, N-B-02: "how we got your number", from the consent proof.
export function HowWeGotYou({ l }) {
  const s = sourceOf(l)
  return (
    <Block title="How we got your number" sub="Say this if they ask">
      <p className="tp-mid">"{s.said}."</p>
      <p className="tp-sub">Consent saved {s.at} on {s.page} · certificate <span className="tp-num">{s.cert}</span></p>
    </Block>
  )
}

// P889: every fresh form lead is called right away. If the agent takes live transfers and it's inside their
// live-call hours (their time zone) → Check agent; Yes → cold transfer; No or no answer in 30 s → book. Outside
// their hours, or an Appointments-only agent → book. The route line says which, before the VA asks.
// N-C-01, N-C-03, N-C-22, N-C-26, N-B-72: from a reached lead, Check agent or Book. Check agent is on only when the
// agent can take it, else the reason shows. Then Sent → Seen → Yes / No / No answer on a 30 s timer; Yes is a cold
// transfer (you drop off), and if the agent doesn't pick up in about 20 s it comes back to you to book.
export function CheckAgent({ l, held, onBook }) {
  const state = l.checklist?.state || l.state
  const agent = agentForState(state)
  const elig = agentCheck(agent, state)
  const [start, setStart] = useLeadState(l.id, 'check', null)
  const [answer, setAnswer] = useLeadState(l.id, 'answer', null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!start || answer) return undefined
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [start, answer])
  const ms = start ? now - start : 0
  const step = start ? checkStep(ms, answer) : null
  const left = Math.max(0, 30 - Math.floor(ms / 1000))
  const ended = ['no', 'none', 'fail', 'bounced'].includes(step)
  return (
    <Block title="Reached them? Check the agent or book" sub={`${agent.name} · licensed in ${agent.states.join(', ')}`} aside={<SampleTag>Sample mode</SampleTag>}>
      {elig.route && !start && <p className={`v879-band${elig.route.route === 'check' ? ' is-blue' : ''}`} role="status">{elig.route.route === 'check' ? <BellRing size={14} aria-hidden="true" /> : <CalendarCheck size={14} aria-hidden="true" />}<span><b>{elig.route.route === 'check' ? 'Live transfer if they’re ready now' : 'Book them'}</b><small>{elig.route.why.replace(/: (book them|check the agent.*)$/i, '')}{agent.mode === 'both' ? ` · ${liveHoursText(agent.hours)}, ${zoneAbbr(agent.tz)}` : ''}</small></span></p>}
      {!elig.bookOk && <p className="adm-warn-t v879-warn"><ShieldAlert size={13} aria-hidden="true" />{state ? `${agent.name.split(' ')[0]} isn't licensed in ${state}. Don't transfer or book; the team finds a licensed agent.` : "Confirm the lead's state on the call before checking the agent or booking."}</p>}
      {!start && (
        <div className="tp-row tp-wrap">
          <button type="button" className="tp-primary fx-accent" disabled={!held || !elig.ok} onClick={() => { setAnswer(null); setStart(Date.now()) }}><BellRing size={16} />Check agent</button>
          <button type="button" className="tp-btn ov-ghost" disabled={!held || !elig.bookOk} onClick={onBook}><CalendarCheck size={16} />Book</button>
          {!elig.ok && <small className="tp-sub">{elig.why}</small>}
        </div>
      )}
      {start && (<>
        <ol className="v879-steps" aria-label="Check agent">
          {['sent', 'seen', 'answer'].map((k, i) => {
            const at = step === 'sent' ? 0 : step === 'seen' ? 1 : 2
            return <li key={k} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}><i aria-hidden="true" />{i === 2 ? (at === 2 ? CHECK_WORD[step] : 'Answer') : CHECK_WORD[k]}</li>
          })}
        </ol>
        {!answer && step !== 'none' && <p className="tp-mid"><b className="tp-num">{left} s</b> for {agent.name.split(' ')[0]} to tap Yes or No in the app. The timer is kept on the server, so a reload doesn't lose it.</p>}
        {!answer && step !== 'none' && (
          <div className="tp-row tp-wrap v879-sim"><small className="tp-sub">Sample: play the agent's answer</small>
            <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAnswer('yes')}>Yes</button>
            <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAnswer('no')}>No</button>
            <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAnswer('fail')}>Push fails</button>
          </div>
        )}
        {step === 'yes' && <section className="fx-blk"><header><h3><PhoneForwarded size={16} aria-hidden="true" />Say: "Connecting you with your licensed agent"</h3></header>
          <p className="tp-mid">Then you drop off. It's a straight transfer, not a three-way call. If {agent.name.split(' ')[0]} doesn't pick up in about 20 seconds, the call comes back to you.</p>
          <button type="button" className="tp-btn sm ov-ghost" onClick={() => setAnswer('bounced')}>Sample: agent misses it</button></section>}
        {ended && <div className="tp-row tp-wrap"><p className="tp-mid tp-grow">{step === 'fail' ? "Couldn't reach the agent. Book them now." : step === 'bounced' ? 'The call is back with you. Book them now.' : `Book them on ${agent.name.split(' ')[0]}'s calendar, in their time.`}</p>
          <button type="button" className="tp-primary sm fx-accent" onClick={onBook}><CalendarCheck size={14} />Book</button>
          <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setStart(null); setAnswer(null) }}>Start over</button></div>}
      </>)}
    </Block>
  )
}

// N-F-19, N-B-51, N-C-53: the script for this call type, required lines ticked (saved on the call), the unlicensed line
// and the coverage cue.
export function Script({ l }) {
  const sc = SCRIPTS.lead
  const [ticked, setTicked] = useLeadState(l.id, 'script', {})
  const left = requiredLeft(sc.lines, ticked)
  return (
    <Block title={`Script · ${sc.title}`} sub={left ? `${left} required ${left === 1 ? 'line' : 'lines'} to go` : 'Every required line said'}>
      <ul className="tp-list v879-lines">{sc.lines.map(([k, text, req]) => (
        <li key={k}><label className="fx-mrow"><input type="checkbox" checked={!!ticked[k]} onChange={e => setTicked({ ...ticked, [k]: e.target.checked })} />
          <span className="tp-grow">{text.replace('{me}', 'Maya')}</span>{req && <Chip tone={ticked[k] ? 'green' : 'mute'}>Required</Chip>}</label></li>
      ))}</ul>
      <p className="v879-band is-blue"><MessageSquareText size={16} aria-hidden="true" /><span><b>{COVERAGE_CUE}</b><small>Say: "{BOUNDARY}"</small></span></p>
    </Block>
  )
}

// N-B-28, N-B-47, N-B-48, N-B-39, N-J-15, N-B-27: the outcome (every one, saved before you're Available again, with a
// reminder at 60 s), age, "spoke to someone else" (a spouse can set a callback but can't book or consent), one-tap
// Do not call (synced like STOP, every agent and queue), and the approved voicemail.
export function Outcome({ l, held, onDone }) {
  const note = useNote()
  const [pick, setPick] = useLeadState(l.id, 'outcome', null)
  const [age, setAge] = useLeadState(l.id, 'age', '')
  const [saved, setSaved] = useLeadState(l.id, 'saved', false)
  const [wrapAt] = useLeadState(l.id, 'wrapAt', () => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (saved) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [saved])
  const wrapS = Math.round((now - wrapAt) / 1000)
  const a = ageRule(age)
  const save = o => {
    setPick(o); setSaved(true)
    note(o === 'do_not_call' ? `${l.name} is on the do-not-call list for every agent` : o === 'voicemail' ? 'Voicemail left. It counts as a try.' : ALERTS_ADMIN.includes(o) ? 'Saved. The admins have been alerted with the timeline.' : `Saved: ${OUTCOMES.find(x => x[0] === o)[1]}. You're Available again.`)
    onDone?.(o)
  }
  return (
    <Block title="Outcome" sub="Save one before you're Available for the next call" aside={saved ? <Chip tone="green">Saved</Chip> : <Chip tone={wrapS >= WRAP_REMIND_S ? 'warn' : 'blue'}>Wrap-up {mmss(wrapS)}</Chip>}>
      {!saved && wrapS >= WRAP_REMIND_S && <p className="adm-warn-t v879-warn"><BellRing size={13} aria-hidden="true" />Reminder: save the outcome so the next call can ring you.</p>}
      <Field label="Their age" hint={a.ok === false ? a.why : 'Needed before booking'}><input inputMode="numeric" value={age} disabled={!held} placeholder="e.g. 52" onChange={e => setAge(e.target.value.replace(/\D/g, '').slice(0, 3))} /></Field>
      <Field label="What happened"><Select label="What happened" value={pick} disabled={!held || saved} placeholder="Pick the outcome" onChange={setPick} options={OUTCOMES.map(([value, label]) => ({ value, label }))} /></Field>
      {pick === 'someone_else' && <p className="tp-sub">A spouse or family member can set a callback{SOMEONE_ELSE.canBook ? '' : ', but they can\'t book'}{SOMEONE_ELSE.canConsent ? '' : ' or give consent for them'}. Use Call back above.</p>}
      {a.ok === false && <p className="adm-warn-t v879-warn"><ShieldAlert size={13} aria-hidden="true" />{a.why}. Save it as Not eligible.</p>}
      <div className="tp-row tp-wrap">
        <button type="button" className="tp-primary sm fx-accent" disabled={!held || !pick || saved || (a.ok === false && pick !== 'not_eligible')} onClick={() => save(pick)}><Check size={14} />Save outcome</button>
        <button type="button" className="tp-btn sm ov-ghost" disabled={!held || saved} onClick={() => save('voicemail')} title={VOICEMAIL.text}><Voicemail size={14} />Leave the voicemail</button>
        <button type="button" className="tp-btn sm ov-ghost tp-danger" disabled={saved} onClick={() => save('do_not_call')}><PhoneOff size={14} />Do not call</button>
      </div>
      <p className="tp-sub">Voicemail: "{VOICEMAIL.name}", approved {VOICEMAIL.approved}. Do not call holds for every agent and queue, like STOP.</p>
    </Block>
  )
}

// N-C-55, N-C-39: a best number (formatted, checked against other leads; reminders use it) and booking notes the agent
// sees on the appointment card.
export function BestNumberNotes({ l, held }) {
  const [raw, setRaw] = useLeadState(l.id, 'best', '')
  const [notes, setNotes] = useLeadState(l.id, 'notes', [])
  const [name, setName] = useLeadState(l.id, 'pref', '')
  const chk = raw ? bestNumberCheck(raw) : null
  return (
    <Block title="For the agent" sub="Shows on their appointment card">
      <div className="fx-form-grid">
        <Field label="Best number" hint={chk ? (chk.ok ? `Reminders go to ${chk.value}` : chk.why) : 'If different from the one they used'}><input inputMode="tel" value={raw} disabled={!held} placeholder="(512) 555-0123" onChange={e => setRaw(e.target.value)} onBlur={() => chk?.ok && setRaw(chk.value)} /></Field>
        <Field label="Goes by" hint="Optional"><input value={name} disabled={!held} placeholder="e.g. Bobby" onChange={e => setName(e.target.value)} /></Field>
      </div>
      <div className="tp-field"><span>Booking notes</span>
        <div className="fx-chips fs-wrap" role="group" aria-label="Booking notes">{NOTE_CHIPS.map(n => {
          const on = notes.includes(n)
          return <button key={n} type="button" className={`fx-chip${on ? ' is-on' : ''}`} aria-pressed={on} disabled={!held} onClick={() => setNotes(on ? notes.filter(x => x !== n) : [...notes, n])}><b>{n}</b></button>
        })}</div>
      </div>
    </Block>
  )
}

// N-F-38: "I know this person": the lead goes to someone else, is hidden from you, and it's logged.
export function Recuse({ l, onDone }) {
  const note = useNote()
  return <button type="button" className="tp-btn sm ov-ghost" onClick={() => { note(`${l.name} went to another VA. Hidden from you and logged.`); onDone?.() }}><UserX size={14} />I know this person</button>
}

// The Queue's call tasks from incoming texts: the automatic reply already went out; the VA calls (no reply box).
export function CallTasksStrip() {
  const note = useNote()
  const [done, setDone] = useState([])
  const rows = myCallTasks().filter(t => !done.includes(t.id))
  if (!rows.length) return null
  return (
    <section className="fx-tile v879-tasks" aria-label="Call tasks from texts">
      <header className="fx-tile-h"><span className="tp-grow"><h2>Call tasks from texts</h2><p>The automatic reply already went. Call them back; there's no reply box.</p></span><SampleTag>Sample</SampleTag></header>
      <ul className="tp-list">{rows.map(t => (
        <li key={t.id} className="fx-mrow"><MessageSquareText size={16} aria-hidden="true" />
          <span className="tp-grow"><b>{t.who} · {t.kind}</b><small>"{t.text}" · {t.at} · replied: "{t.reply}"</small></span>
          <button type="button" className="tp-primary sm fx-accent" onClick={() => { setDone([...done, t.id]); note(`Calling ${t.who}`) }}><Phone size={14} />Call</button>
        </li>
      ))}</ul>
    </section>
  )
}
