import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Phone as PhoneIc, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, History, CircleCheck, PhoneMissed, ChevronRight, Search,
  Volume2, UserPlus, Merge, PhoneForwarded, NotebookPen, CircleDot, X, ArrowUpRight, Building2, ShieldCheck, ListTodo,
} from 'lucide-react'
import { useFulCalls, useFulActions, useFulDay, useFulQueue, useFulTasks, AGENTS } from './data'
import { Avatar, Field, PillTabs, useNote } from '../kit'
import { useClientZone } from '../useClientZone'
import { clockOf, zoneAbbr } from '../../lib/callSlots'
import { clock } from '../../lib/portalPhone'
import { PAD } from '../../components/fulfillment/phoneIcons'
import { CARRIER_CATALOG } from '../../lib/carriers/catalog'
import { newCall, callReducer, lineCount, heldFor, XFER_WORDS, xferOpen, CHECK_MS, BOUNCE_MS, XFER_BOOK, XFER_GO, xferFromCheck, xferRefused, SAMPLE_REACH, REACH_WORDS } from './callLine'
import { useRealXfer } from '../../hooks/useLiveTransfer'
import { CALL_WORD, KIND } from './words'
import { fp } from './paths'
import { HelpDot } from '../../fulshell/training/HelpDot'

// P876 — the VA phone is a call screen that slides in from the right OVER the page, like a phone's in-call screen
// (the caller and the timer at the top, round buttons below, a red End). It never changes the page's layout. A tab on
// its left edge (arrow pointing right) slides it away, even mid-call: the call keeps going and the rail's phone icon
// shows it (green pulse + timer). The rail icon is the only way in (the top bar's phone icon on a phone); there is no
// floating phone button.
// VAs don't dial numbers (Brayden, Nov 7): every call comes in, or starts from a task the system gave them (Next call,
// a callback, a lead, a servicing step) with its Call button. The keypad exists only during a call, for carrier
// menus. Add caller brings a carrier (from the carrier directory) or the agent onto the call, then Merge; each person
// on the line can be dropped. Transfer is the live transfer (Check agent → push → cold transfer → bounce-back).
// Calling stays OFF (recovery_config.voice_live): the call screen keeps the time, the line and the notes while the VA
// dials from a phone, and says so. Sample info only; nothing leaves the browser. The call itself: ./callLine.
const CALLING_ON = false
const RECORD_NOTICE = null // the wording is Brayden's (blueprint "recording with a notice"); null shows a placeholder

const OPEN = ['booked', 'no_answer']
const plain = s => String(s || '').toLowerCase()

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

// P854's client-time rule: the client's own clock first, from their state + city (or the call's saved zone).
function useTheirTime(who) {
  const found = useClientZone(who?.state, who?.city)
  const tz = who?.tz || found.tz
  const now = useNow(15000)
  if (!who || who.role === 'carrier') return ''
  if (!tz) return who.state ? 'Their time: not known yet' : 'Their time: unknown number'
  const iso = new Date(now).toISOString()
  return `${clockOf(iso, tz)} ${zoneAbbr(tz, iso)}, their time${who.city ? ` (${who.city}, ${who.state})` : ''}`
}

// Every call starts from one of these: what the system gave the VA. `rec` = the record, one tap away.
const fromCall = k => ({
  key: `k-${k.id}`, kind: 'call', id: k.id, role: 'client', name: k.name, number: k.client.client_phone, state: k.client.state, city: k.client.city,
  tz: k.tz || null, agentId: k.client.agent_id, agent: k.agent, reason: `Cancel ${k.old_carrier}, keeping ${k.carrier}`, carrier: k.old_carrier,
  callId: OPEN.includes(k.status) ? k.id : null, notes: k.notes || '', rec: fp('schedule', k.id), when: k.time,
})
const LEAD_WHY = { callback_due: 'Callback', new: 'New lead', not_reached: 'Retry' }
const fromLead = l => ({
  key: `l-${l.id}`, kind: 'lead', id: l.id, role: 'lead', name: l.name, number: l.phone, state: l.checklist?.state || l.state, city: l.city,
  reason: `${LEAD_WHY[l.bucket] || 'Lead'}${l.bucket === 'not_reached' ? `, try ${l.tries + 1}` : ''} · ${l.type}`, notes: l.note || '', rec: fp('queue', l.id),
  when: l.bucket === 'callback_due' ? l.callback : `Came in ${l.came}`,
})
const fromTask = t => ({
  key: `t-${t.id}`, kind: 'task', id: t.id, role: 'client', name: t.name, number: t.client.client_phone, state: t.client.state, city: t.client.city,
  agentId: t.client.agent_id, agent: t.agent, reason: `${KIND[t.kind] || 'Servicing'} · ${t.carrier}`, carrier: t.carrier, notes: t.note || '',
  rec: fp('servicing', t.id), when: t.due_text,
})

export default function FulPhone({ open, onClose, ringId, onAnswer, onDecline, onLine: report, missed = [], live, onLive, startReq, onBook }) {
  const { data: calls } = useFulCalls()
  const { data: day } = useFulDay()
  const { data: queue } = useFulQueue()
  const { data: tasks } = useFulTasks()
  const { markCall, hideLive } = useFulActions()
  const note = useNote()
  const navigate = useNavigate()
  const [tab, setTab] = useState('todo')
  const [call, act] = useReducer((c, a) => (a.type === 'start' ? newCall(a.who, a.now) : a.type === 'clear' ? null : callReducer(c, a)), null)
  const [sheet, setSheet] = useState(null) // during a call: 'add' | 'xfer' | 'notes' | 'line'
  const [log, setLog] = useState([])       // calls finished this visit
  const box = useRef(null)
  const now = useNow(call && !call.end ? 1000 : 30000)

  // What the system gave this VA to call, in the order to call it.
  const todo = useMemo(() => {
    const leads = queue.filter(l => !l.closed)
    return [
      ['Next call', day.next ? [fromCall(day.next)] : []],
      ['Callbacks due', leads.filter(l => l.bucket === 'callback_due').map(fromLead)],
      ['New leads', leads.filter(l => l.bucket === 'new').map(fromLead)],
      ['Servicing due', tasks.filter(t => t.due === 'overdue' || t.due === 'today').map(fromTask)],
      ['Not reached yet', leads.filter(l => l.bucket === 'not_reached').map(fromLead)],
    ].filter(([, rows]) => rows.length)
  }, [day.next, queue, tasks])

  const resolve = req => {
    if (!req) return null
    const { kind, id } = typeof req === 'string' ? { kind: 'call', id: req } : req
    if (kind === 'call') { const k = calls.find(x => x.id === id); return k ? fromCall(k) : null }
    if (kind === 'lead') { const l = queue.find(x => x.id === id); return l ? fromLead(l) : null }
    if (kind === 'task') { const t = tasks.find(x => x.id === id); return t ? fromTask(t) : null }
    if (kind === 'client') {
      const k = calls.find(x => x.client_id === id && OPEN.includes(x.status))
      const t = tasks.find(x => x.client_id === id && x.due !== 'done')
      return k ? fromCall(k) : t ? fromTask(t) : null
    }
    return null
  }

  const ring = ringId && !call ? calls.find(x => x.id === ringId) : null
  const ringWho = ring ? fromCall(ring) : null
  const subject = call?.who || ringWho
  const theirTime = useTheirTime(subject)

  const start = who => {
    if (!who) return
    if (call && !call.end) { note('Finish this call first'); return }
    act({ type: 'start', who }); setSheet(null)
  }
  // A Call button elsewhere (a call's drawer, a lead, a servicing step) sets the store's live request: the frame
  // slides this screen in (startReq) and the call starts on that person.
  useEffect(() => { if (live) { onLive(live); hideLive() } }, [live, onLive, hideLive])
  const [seenReq, setSeenReq] = useState(null)
  if (startReq && startReq !== seenReq) {
    setSeenReq(startReq)
    const who = resolve(startReq.req)
    if (who && !(call && !call.end)) { act({ type: 'start', who }); setSheet(null) }
  }

  const view = ring ? 'ring' : call ? (call.end ? 'result' : 'call') : 'idle'
  const lineState = view === 'call' ? 'live' : view === 'result' ? 'after' : null
  const since = call?.start ?? null
  useEffect(() => { report?.(lineState, since) }, [lineState, since, report])

  // Sample: whoever is added answers after a moment; the live transfer moves on its own (P852 swaps in real events).
  const ringing = call?.parties.filter(p => p.state === 'ringing').map(p => p.id).join('|') || ''
  useEffect(() => {
    if (!ringing) return undefined
    const ts = ringing.split('|').map((id, i) => setTimeout(() => act({ type: 'answered', id }), 2200 + i * 400))
    return () => ts.forEach(clearTimeout)
  }, [ringing])
  const xs = call?.xfer?.step
  const xAgent = AGENTS.find(a => a.id === call?.xfer?.agent)
  // P880: on a real call (help-voice's CallSid on it) the transfer card follows the server's check instead.
  const real = useRealXfer(call)
  const realRow = real?.row, realSkew = real?.skew, realRefused = real?.refused
  useEffect(() => {
    if (realRow) act({ type: 'xferServer', xfer: xferFromCheck(realRow, realSkew) })
    else if (realRefused) act({ type: 'xferServer', xfer: xferRefused(realRefused, null) })
  }, [realRow, realSkew, realRefused])
  useEffect(() => {
    if (!xs || !xAgent || call?.xfer?.live) return undefined
    const later = (ms, a) => { const t = setTimeout(() => act(a), ms); return () => clearTimeout(t) }
    if (xs === 'sent') return later(1200, { type: 'xfer', step: 'seen' })
    // Sample answers: an agent who takes transfers says Yes, a booking-only agent says Not now.
    if (xs === 'seen') return later(Math.min(2600, CHECK_MS), { type: 'xfer', step: xAgent.duty ? 'yes' : 'no' })
    // Dana picks up; Priya doesn't, so the call bounces back after BOUNCE_MS (about 20 s).
    if (xs === 'ringing') return xAgent.id === 'ag-dana' ? later(3000, { type: 'picked' }) : later(BOUNCE_MS, { type: 'bounce' })
    return undefined
  }, [xs, xAgent])

  // The screen is not modal: Esc slides it away only while you are in it, and focus goes back to the rail icon.
  const railBack = () => requestAnimationFrame(() => document.querySelector('.fs-ri-phone:not([hidden]), .fs-top-phone')?.focus?.())
  const slideAway = () => { onClose(); railBack() }
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      if (e.key !== 'Escape' || !box.current?.contains(document.activeElement)) return
      e.stopPropagation()
      if (sheet) { setSheet(null); return }
      onClose(); railBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose, sheet])
  // Closed: out of the tab order and hidden from screen readers (it stays mounted so the call keeps going).
  useEffect(() => { if (box.current) box.current.inert = !open }, [open])
  useEffect(() => {
    if (!open) return undefined
    const t = requestAnimationFrame(() => box.current?.querySelector('[data-first]')?.focus())
    return () => cancelAnimationFrame(t)
  }, [open, view])

  const took = call ? clock(((call.end || now) - call.start) / 1000) : ''
  const finish = () => { act({ type: 'clear' }); setSheet(null); setTab('recent') }
  const openRec = who => { if (who?.rec) navigate(who.rec) }

  let body
  if (ring) {
    body = (
      <div className="fs-cs fs-cs-ring">
        <div className="fs-cs-who">
          <span className="fs-cs-kicker"><span className="fs-cs-pulse" aria-hidden="true" />Incoming call</span>
          <Avatar name={ring.name} tone="blue" />
          <b className="fs-cs-name">{ring.name}</b>
          <small>{ringWho.reason}</small>
          <small className="fs-ph-tz">{theirTime}</small>
          <button type="button" className="fs-cs-rec" onClick={() => openRec(ringWho)}>{ring.agent}'s client · open the call<ArrowUpRight size={13} aria-hidden="true" /></button>
        </div>
        {!CALLING_ON && <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" /><span>Calling is off right now. Answer to keep the time and notes here, and dial <b className="tp-num">{ring.client.client_phone}</b> from your phone.</span></p>}
        <div className="fs-cs-ans">
          <span><button type="button" className="fs-rb is-end" aria-label="Not now" onClick={() => onDecline()}><PhoneOff size={24} /></button><small>Not now</small></span>
          <span><button type="button" className="fs-rb is-go" data-first aria-label={`Answer ${ring.name}`} onClick={() => { const w = ringWho; onAnswer(); start(w) }}><PhoneIc size={24} /></button><small>Answer</small></span>
        </div>
      </div>
    )
  } else if (call && !call.end) {
    const p = call.who
    const waiting = call.parties.some(x => x.state === 'waiting')
    const pending = call.parties.some(x => x.state === 'ringing')
    const people = lineCount(call)
    const held = heldFor(call, now)
    const isLead = p.role === 'lead'
    const status = call.held ? `On hold · ${clock(held / 1000)}` : call.muted ? 'Muted' : people > 2 ? `${people} on the call` : 'On the call'
    const btn = (key, label, Icon, on, run, extra = {}) => (
      <span key={key} className="fs-rbw"><button type="button" className={`fs-rb${on ? ' is-on' : ''}${extra.cls ? ` ${extra.cls}` : ''}`} aria-pressed={extra.press === false ? undefined : !!on}
        aria-label={extra.aria || label} disabled={extra.disabled} title={extra.title} onClick={run} {...(extra.first ? { 'data-first': true } : {})}><Icon size={22} /></button><small>{label}</small></span>
    )
    body = (
      <div className="fs-cs">
        <div className="fs-cs-who">
          {call.rec && <span className="fs-cs-recpill"><CircleDot size={12} aria-hidden="true" />Recording</span>}
          <Avatar name={p.name} tone="blue" />
          <button type="button" className="fs-cs-name is-link" onClick={() => openRec(p)} aria-label={`Open ${p.name}'s record`}>{p.name}<ArrowUpRight size={15} aria-hidden="true" /></button>
          <small>{p.reason}</small>
          {theirTime && <small className="fs-ph-tz">{theirTime}</small>}
          <p className={`fs-cs-timer tp-num${call.held ? ' is-held' : ''}`} aria-live="off"><span>{status}</span>{took}</p>
        </div>
        {call.rec && <p className="fs-cs-notice"><CircleDot size={13} aria-hidden="true" />{RECORD_NOTICE || 'Say the recording notice first. (The exact words are coming from Brayden.)'}</p>}
        {!CALLING_ON && <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" /><span>Calling is off right now. Dial <b className="tp-num">{p.number}</b> from your phone. This keeps the time, the line and your notes.</span></p>}
        {(people > 2 || waiting || pending) && <LineList call={call} onDrop={id => act({ type: 'drop', id })} onMerge={() => act({ type: 'merge' })} />}
        {call.xfer && <XferCard x={call.xfer} agent={xAgent} now={now}
          onTransfer={() => (real ? real.transfer().catch(e => note(e.message)) : act({ type: 'transfer' }))}
          onBook={() => { onBook?.(p.kind === 'lead' ? p.id : null); if (real) { real.book().catch(() => {}); real.clear() } act({ type: 'xferClear' }) }}
          onClear={() => { real?.clear(); act({ type: 'xferClear' }) }} />}
        {call.pad && <div className="fs-ph-tones tp-num" aria-label="Keys pressed">{call.tones || ' '}</div>}
        {call.pad && <div className="fs-pad is-small" aria-label="Keypad for tones">{PAD.map(d => <button key={d} type="button" className="fs-key" onClick={() => act({ type: 'tone', key: d })}>{d}</button>)}</div>}
        {sheet === 'notes' && <Field label="Notes" hint="Saved with the call"><textarea className="tp-input fx-ta" rows={3} placeholder="What happened on the call" value={call.notes} onChange={e => act({ type: 'notes', text: e.target.value })} /></Field>}
        {sheet === 'add' && <AddCaller who={p} on={call.parties} onPick={party => { act({ type: 'add', party }); setSheet(null) }} onClose={() => setSheet(null)} />}
        {sheet === 'xfer' && <PickAgent who={p} real={!!real} onCheck={agent => { if (real) real.check().catch(e => note(e.message)); else act({ type: 'check', agent }); setSheet(null) }} onClose={() => setSheet(null)} />}
        <div className="fs-cs-grid">
          {btn('mute', call.muted ? 'Unmute' : 'Mute', call.muted ? MicOff : Mic, call.muted, () => act({ type: 'mute' }), { first: true })}
          {btn('pad', 'Keypad', Grid3x3, call.pad, () => act({ type: 'pad' }), { title: 'Tones for carrier menus' })}
          {btn('spk', 'Speaker', Volume2, call.speaker, () => act({ type: 'speaker' }))}
          {btn('hold', call.held ? 'Resume' : 'Hold', call.held ? Play : Pause, call.held, () => act({ type: 'hold' }))}
          {waiting
            ? btn('merge', 'Merge', Merge, false, () => act({ type: 'merge' }), { press: false, cls: 'is-merge', aria: 'Merge everyone into one call' })
            : btn('add', 'Add caller', UserPlus, sheet === 'add', () => setSheet(s => (s === 'add' ? null : 'add')), { press: false, aria: 'Add a carrier or the agent to the call' })}
          {btn('xfer', 'Transfer', PhoneForwarded, sheet === 'xfer' || xferOpen(call.xfer), () => setSheet(s => (s === 'xfer' ? null : 'xfer')), { press: false, disabled: !isLead || !!call.xfer, title: isLead ? 'Live transfer to the agent' : 'Live transfer is for leads. For a coverage question, Add caller → the agent' })}
          {btn('notes', 'Notes', NotebookPen, sheet === 'notes', () => setSheet(s => (s === 'notes' ? null : 'notes')), { press: false })}
          {btn('rec', call.rec ? 'Recording' : 'Record', CircleDot, call.rec, () => act({ type: 'rec' }), { cls: 'is-rec' })}
        </div>
        <div className="fs-cs-endrow"><span className="fs-rbw"><button type="button" className="fs-rb is-end is-big" aria-label="End the call" onClick={() => act({ type: 'end' })}><PhoneOff size={26} /></button><small>End</small></span></div>
      </div>
    )
  } else if (call) {
    body = <Result call={call} took={took} agent={xAgent} onDone={finish} save={r => {
      const p = call.who
      if (p.callId && (r.pick === 'cancelled' || r.pick === 'no_answer')) {
        if (r.pick === 'cancelled') { markCall(p.callId, 'cancelled', { confirmation: r.conf.trim().toUpperCase(), notes: r.notes }); note('Cancelled. It shows on Pay as checking') }
        else { markCall(p.callId, 'no_answer', { notes: r.notes || 'No answer.' }); note(`No answer logged for ${p.name.split(' ')[0]}`) }
      } else note(`Call with ${p.name} logged`)
      const word = CALL_WORD[r.pick] || r.pick
      setLog(l => [{ id: `d-${Date.now()}`, name: p.name, number: p.number, outcome: word, tone: /cancel|reached|transfer/i.test(word) ? 'cancelled' : 'no_answer', when: `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, who: p }, ...l])
      finish()
    }} />
  } else {
    const recent = [
      ...log,
      ...missed.map(m => calls.find(k => k.id === m.id)).filter(Boolean).map((k, i) => ({ id: `m-${k.id}-${i}`, name: k.name, number: k.client.client_phone, outcome: 'Missed', tone: 'no_answer', when: 'Today, just now', who: fromCall(k), missed: true })),
      ...calls.filter(k => !OPEN.includes(k.status) || k.status === 'no_answer').sort((a, b) => b.day - a.day).map(k => ({ id: k.id, name: k.name, number: k.client.client_phone, outcome: CALL_WORD[k.status], tone: k.status, when: k.day === 5 ? `Today, ${k.time}` : `Nov ${k.day}, ${k.time}`, who: fromCall(k) })),
    ]
    body = (
      <>
        <div className="fs-ph-tabs" role="tablist" aria-label="Phone">
          {[['todo', 'To call', ListTodo], ['recent', 'Recent', History]].map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`fs-ph-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)} {...(tab === k ? { 'data-first': true } : {})}><I size={15} aria-hidden="true" />{l}</button>)}
        </div>
        {tab === 'todo' ? (
          <>
            <p className="tp-sub fs-ph-rule">Calls come in, or start from what you were given here. You don't dial numbers yourself.</p>
            {todo.length === 0 && <p className="fx-calm">Nothing to call right now. Calls that come in ring here.</p>}
            {todo.map(([head, rows]) => (
              <section key={head} className="fs-ph-group" aria-label={head}>
                <h3 className="fs-ph-gh">{head}<span className="tp-num">{rows.length}</span></h3>
                <ul className="tp-list fs-ph-todo">{rows.map(w => <TodoRow key={w.key} w={w} onCall={() => start(w)} onOpen={() => openRec(w)} />)}</ul>
              </section>
            ))}
          </>
        ) : (
          <ul className="tp-list fs-ph-recent" aria-label="Recent calls">
            {recent.map(r => (
              <li key={r.id} className="fs-ph-row">
                <button type="button" className="fx-mrow" onClick={() => openRec(r.who)}>
                  <Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small className="tp-num">{r.when} · {r.number}</small></span>
                  <span className={`fs-st is-${r.tone}`}>{r.tone === 'no_answer' ? <PhoneMissed size={12} aria-hidden="true" /> : null}{r.outcome}</span>
                </button>
                {r.missed && <button type="button" className="fs-rb is-go is-sm" aria-label={`Call ${r.name} back`} title="Call back" onClick={() => start(r.who)}><PhoneIc size={16} /></button>}
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  const onCall = view === 'call'
  const head = ring ? 'A call is coming in' : onCall ? `On a call · ${took}` : view === 'result' ? 'How did it go?' : CALLING_ON ? 'Ready' : 'Calling is off right now'
  const lesson = ring ? 'answer' : call ? 'logging' : 'dialer'

  // Portaled to <body> like the record drawers. No scrim: the page behind stays usable and never moves.
  return createPortal(
    <div className="tp fx-layer fs-call-layer">
      <section ref={box} className={`fs-call${open ? ' is-in' : ''}${onCall || ring ? ' is-live' : ''}`} role="dialog" aria-label="Phone" aria-hidden={!open}>
        <button type="button" className="fs-call-tab" aria-label={call && !call.end ? 'Slide the phone away. The call keeps going' : 'Slide the phone away'} title={call && !call.end ? 'Slide away (the call keeps going)' : 'Slide away'} onClick={slideAway}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <header className="fs-ph-h">
          <span className={`fs-ph-ic${ring || onCall ? ' is-live' : ''}`} aria-hidden="true"><PhoneIc size={16} /></span>
          <span className="tp-grow"><b>Phone</b><small>{head}</small></span>
          <HelpDot lesson={lesson} />
        </header>
        <div className="fs-ph-b">{body}</div>
      </section>
    </div>,
    document.body,
  )
}

function TodoRow({ w, onCall, onOpen }) {
  return (
    <li className="fs-ph-row">
      <button type="button" className="fx-mrow" onClick={onOpen} aria-label={`Open ${w.name}'s record`}>
        <Avatar name={w.name} /><span className="tp-grow"><b>{w.name}</b><small>{w.reason}</small><small className="tp-num">{w.when}</small></span>
      </button>
      <button type="button" className="fs-rb is-go is-sm" aria-label={`Call ${w.name}`} title={`Call ${w.name.split(' ')[0]}`} onClick={onCall}><PhoneIc size={16} /></button>
    </li>
  )
}

// Everyone on the line: the VA, then each person (merged, on a separate line waiting to merge, or still ringing).
const ROLE = { client: 'Client', lead: 'Lead', carrier: 'Carrier', agent: 'Agent' }
function LineList({ call, onDrop, onMerge }) {
  const waiting = call.parties.some(p => p.state === 'waiting')
  return (
    <section className="fs-cs-line" aria-label="On the line">
      <h3 className="fs-ph-gh">On the line<span className="tp-num">{lineCount(call)}</span></h3>
      <ul className="tp-list">
        <li className="fs-cs-li"><Avatar name="You" /><span className="tp-grow"><b>You</b><small>{call.held ? 'Holding' : 'On the call'}</small></span></li>
        {call.parties.map(p => (
          <li key={p.id} className={`fs-cs-li is-${p.state}`}>
            <Avatar name={p.name} />
            <span className="tp-grow"><b>{p.name}</b><small>{ROLE[p.role]} · {p.state === 'line' ? 'On the call' : p.state === 'waiting' ? 'Answered. Merge to bring them in' : 'Ringing…'}</small></span>
            <button type="button" className="fx-pillbtn fs-cs-drop" aria-label={`Drop ${p.name} from the call`} onClick={() => onDrop(p.id)}><X size={13} />Drop</button>
          </li>
        ))}
      </ul>
      {waiting && <button type="button" className="tp-primary fx-accent fs-cs-merge" onClick={onMerge}><Merge size={16} />Merge into one call</button>}
    </section>
  )
}

// Add caller: the client's agent (a coverage question is a warm hand-off: VAs aren't licensed), or a carrier from
// the carrier directory with its service line.
function AddCaller({ who, on, onPick, onClose }) {
  const [q, setQ] = useState('')
  const has = id => on.some(p => p.id === id)
  const agents = [...AGENTS].sort((a, b) => (a.id === who.agentId ? -1 : b.id === who.agentId ? 1 : 0))
  const carriers = useMemo(() => {
    const t = plain(q).trim()
    const list = CARRIER_CATALOG.filter(c => c.service_phone)
    const first = who.carrier ? list.filter(c => plain(c.name) === plain(who.carrier)) : []
    return (t ? list.filter(c => plain(c.name).includes(t) || c.aliases.some(a => plain(a).includes(t))) : [...first, ...list.filter(c => !first.includes(c))]).slice(0, 6)
  }, [q, who.carrier])
  return (
    <section className="fs-cs-sheet" aria-label="Add a caller">
      <header className="fs-cs-sh"><b>Add to the call</b><button type="button" className="fx-x" aria-label="Close" onClick={onClose}><X size={15} /></button></header>
      <h3 className="fs-ph-gh">Agent</h3>
      <ul className="tp-list">{agents.map(a => (
        <li key={a.id}><button type="button" className="fx-mrow" disabled={has(a.id)} onClick={() => onPick({ id: a.id, name: a.name, role: 'agent', number: null })}>
          <ShieldCheck size={16} aria-hidden="true" /><span className="tp-grow"><b>{a.name}{a.id === who.agentId ? ' (their agent)' : ''}</b><small>Coverage questions: a warm hand-off</small></span><UserPlus size={15} aria-hidden="true" />
        </button></li>
      ))}</ul>
      <h3 className="fs-ph-gh">Carrier directory</h3>
      <label className="fs-ph-entry"><Search size={16} aria-hidden="true" /><input data-first value={q} onChange={e => setQ(e.target.value)} placeholder="Find a carrier" aria-label="Find a carrier" /></label>
      <ul className="tp-list">{carriers.map(c => (
        <li key={c.id}><button type="button" className="fx-mrow" disabled={has(c.id)} onClick={() => onPick({ id: c.id, name: c.name, role: 'carrier', number: c.service_phone })}>
          <Building2 size={16} aria-hidden="true" /><span className="tp-grow"><b>{c.name}</b><small className="tp-num">{c.service_phone}</small></span><UserPlus size={15} aria-hidden="true" />
        </button></li>
      ))}</ul>
    </section>
  )
}

// Transfer: pick the agent, then Check agent sends the push (blueprint "Live transfer").
// P880: an agent who can't get live calls (no app, notifications off, push test not passed, booking only) can't be
// checked; the reason shows. On a real call the server checks the lead's own agent (the one the ad link routed to).
function PickAgent({ who, real, onCheck, onClose }) {
  const can = a => a.duty && !SAMPLE_REACH[a.id]
  const [agent, setAgent] = useState((AGENTS.find(can) || AGENTS[0]).id)
  const why = a => (SAMPLE_REACH[a.id] ? REACH_WORDS[SAMPLE_REACH[a.id]] : a.duty ? 'Takes transfers' : REACH_WORDS.booking_only)
  const picked = AGENTS.find(a => a.id === agent)
  return (
    <section className="fs-cs-sheet" aria-label="Live transfer">
      <header className="fs-cs-sh"><b>Live transfer</b><button type="button" className="fx-x" aria-label="Close" onClick={onClose}><X size={15} /></button></header>
      <p className="tp-sub">The agent gets a push on the Ohvara phone app with {who.name.split(' ')[0]}'s name, age, state and need, and answers Yes or No.</p>
      {real ? <p className="tp-sub">This goes to {who.agent ? who.agent.split(' ')[0] : 'their agent'}.</p> : (
        <PillTabs role="radiogroup" label="Agent" className="fx-chips" itemClass="fx-chip" value={agent} onChange={setAgent}
          items={AGENTS.map(a => ({ key: a.id, label: <><b>{a.name.split(' ')[0]}</b><small>{can(a) ? 'Takes transfers' : 'Not reachable'}</small></> }))} />
      )}
      {!real && picked && !can(picked) && <p className="fs-cs-why" role="note">{why(picked)}. Book them on {picked.name.split(' ')[0]}’s calendar.</p>}
      <button type="button" className="tp-primary fx-accent" data-first disabled={!real && !can(picked)} onClick={() => onCheck(agent)}><PhoneForwarded size={16} />Check agent</button>
    </section>
  )
}

function XferCard({ x, agent, now, onTransfer, onBook, onClear }) {
  const first = agent?.name.split(' ')[0] || 'The agent'
  const left = x.step === 'ringing' ? Math.max(0, Math.ceil((BOUNCE_MS - (now - x.at)) / 1000)) : x.step === 'sent' || x.step === 'seen' ? Math.max(0, Math.ceil((CHECK_MS - (now - x.at)) / 1000)) : null
  const steps = ['sent', 'seen', 'yes']
  const at = steps.indexOf(['ringing', 'bounced', 'lateyes', 'withdrew'].includes(x.step) ? 'yes' : x.step)
  const book = XFER_BOOK.includes(x.step)
  const go = XFER_GO.includes(x.step)
  return (
    <section className={`fs-cs-xfer is-${x.step}`} aria-live="polite" aria-label="Live transfer">
      <header><b>Live transfer to {first}</b>{left != null && <span className="tp-num">{left}s</span>}</header>
      {at >= 0 && <ol className="fs-cs-steps">{['Sent', 'Seen', 'Yes'].map((l, i) => <li key={l} className={i <= at ? 'is-done' : ''}>{l}</li>)}</ol>}
      <p>{XFER_WORDS[x.step]}</p>
      <div className="fs-ph-acts">
        {go && <button type="button" className="tp-primary fx-accent" data-first onClick={onTransfer}><PhoneForwarded size={16} />Transfer now</button>}
        {go && <small className="tp-sub">Say “connecting you with your licensed agent”, then transfer. They hear hold music while {first}’s phone rings; you drop off when {first} picks up.</small>}
        {x.step === 'ringing' && <small className="tp-sub">Stay on. If {first} doesn’t pick up in about 20 seconds, the lead comes back to you.</small>}
        {book && <button type="button" className="tp-primary fx-accent" onClick={onBook}>Book them with {first}</button>}
        {(book || ['cancelled', 'booked'].includes(x.step)) && <button type="button" className="tp-btn ov-ghost" onClick={onClear}>Close</button>}
      </div>
    </section>
  )
}

// After the call: the result and notes (a cancellation call: Cancelled with the carrier's confirmation number, or No
// answer). A lead or servicing call keeps a simple outcome; a transferred lead says so.
const FREE = ['Reached them', 'No answer', 'Left a voicemail']
function Result({ call, took, agent, save, onDone }) {
  const p = call.who
  const transferred = call.outcome === 'transferred'
  const opts = transferred ? [[`Transferred to ${agent?.name || 'the agent'}`, `Transferred to ${agent?.name.split(' ')[0] || 'the agent'}`]] : p.callId ? [['cancelled', 'Cancelled'], ['no_answer', 'No answer']] : FREE.map(f => [f, f])
  const [pick, setPick] = useState(opts[0][0])
  const [conf, setConf] = useState('')
  const [notes, setNotes] = useState(call.notes || '')
  const ready = !p.callId || pick !== 'cancelled' || conf.trim().length >= 4
  return (
    <div className="fs-ph-call">
      <div className="fs-ph-who"><Avatar name={p.name} /><span className="tp-grow"><b>{p.name}</b><small>Call ended · {took}{heldFor(call) ? ` · on hold ${clock(heldFor(call) / 1000)}` : ''}</small></span></div>
      <div className="tp-field"><span>How did it go?</span>
        <PillTabs role="radiogroup" label="How did it go?" className="fx-chips" itemClass="fx-chip" value={pick} onChange={setPick} items={opts.map(([v, l]) => ({ key: v, label: <b>{l}</b> }))} />
      </div>
      {p.callId && pick === 'cancelled' && <Field label="Confirmation number" hint="From the carrier, on the call"><input data-first value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>}
      <Field label="Notes" hint={p.agent ? `${p.agent.split(' ')[0]} sees these` : undefined}><textarea className="tp-input fx-ta" rows={3} placeholder="What happened on the call" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <div className="fs-ph-acts">
        <button type="button" className="tp-primary fx-accent" data-first disabled={!ready} onClick={() => save({ pick, conf, notes })}><CircleCheck size={16} />Save result</button>
        <button type="button" className="tp-btn ov-ghost" onClick={onDone}>Skip</button>
      </div>
    </div>
  )
}

