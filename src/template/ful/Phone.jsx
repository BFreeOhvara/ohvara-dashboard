import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Phone as PhoneIc, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, History, CircleCheck, PhoneMissed, ChevronRight, Search,
  Volume2, UserPlus, Merge, PhoneForwarded, NotebookPen, X, ArrowUpRight, Building2, ShieldCheck, ListTodo,
  Ban, LifeBuoy, Voicemail, ArrowRightLeft, Undo2, CircleSlash, Timer, Plus,
} from 'lucide-react'
import { useFulCalls, useFulActions, useFulDay, useFulTasks, useFulAgents, useFulClock } from './data'
import { Avatar, Field, PillTabs, useNote } from '../kit'
import { useClientZone } from '../useClientZone'
import { clockOf, zoneAbbr } from '../../lib/callSlots'
import { clock } from '../../lib/portalPhone'
import { PAD } from '../../components/fulfillment/phoneIcons'
import { CARRIER_CATALOG } from '../../lib/carriers/catalog'
import {
  newCall, callReducer, lineCount, heldFor, XFER_WORDS, xferOpen, CHECK_MS, BOUNCE_MS, XFER_BOOK, XFER_GO, xferFromCheck, xferRefused, SAMPLE_REACH, REACH_WORDS,
  holdOnlyCarrier, RING_KIND, ringLeft, initialPresence, presenceReducer, wrapLeft, wrapStuck, PRESENCE_WORDS, MISSED_TO_AWAY,
} from './callLine'
import { predial, predialLine } from './predial'
import { flagsOf } from './p879'
import { useRealXfer } from '../../hooks/useLiveTransfer'
import { useRealLine } from '../../hooks/useRealLine'
import { CALL_WORD, KIND } from './words'
import { fp } from './paths'
import { HelpDot } from '../../fulshell/training/HelpDot'

// P876 — the VA phone is a call screen that slides in from the right OVER the page, like a phone's in-call screen
// (the caller and the timer at the top, round buttons below, a red End). It never changes the page's layout. A tab on
// its left edge (arrow pointing right) slides it away, even mid-call: the call keeps going and the rail's phone icon
// shows it (green pulse + timer). The rail icon is the only way in (the top bar's phone icon on a phone); there is no
// floating phone button.
// VAs don't dial numbers (Brayden, Nov 7): every call comes in, or starts from a booking the system gave them (P907:
// the Schedule's booked calls; no queue, no leads) with its Call button. The keypad exists only during a call, for carrier
// menus. Add caller brings a carrier (from the carrier directory) or the agent onto the call, then Merge; each person
// on the line can be dropped. Transfer is the live transfer (Check agent → push → cold transfer → bounce-back).
// Calling stays OFF (recovery_config.voice_live): the call screen keeps the time, the line and the notes while the VA
// dials from a phone, and says so. Sample info only; nothing leaves the browser. The call itself: ./callLine.
// P882: no call recording at launch (Q51), so the phone has no Record button and says nothing about recordings. The real engine
// (useRealLine: rings from routing, the pre-dial check, hold/keypad/merge, Do not call) takes over once calling is on;
// until then everything below runs on the sample.
const CALLING_ON = false

// P882 sample: calls placed to a lead in the last 24 hours (minutes before the sample clock). Joyce in Florida is at
// the state's limit of 3.
const SAMPLE_ATTEMPTS = { 'vq-9': [23 * 60, 5 * 60, 60] }

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
// P907: a booked servicing call (a hand-off, save, change, callback...) opens on the Schedule when it's yours.
const fromTask = t => ({
  key: `t-${t.id}`, kind: 'task', id: t.id, role: t.client.lead ? 'lead' : 'client', name: t.name, number: t.client.client_phone, state: t.client.state, city: t.client.city,
  tz: t.tz || null, agentId: t.client.agent_id || t.agent_id, agent: t.agent, reason: [KIND[t.kind] || 'Servicing', t.carrier].filter(Boolean).join(' · '), carrier: t.carrier, notes: t.note || '',
  rec: t.iso && t.mine !== false ? fp('schedule', t.id) : fp('servicing', t.id), when: t.when || t.due_text,
})
// A Schedule item (P907's one row shape) or, on real data, a call row.
const fromItem = i => (i.row ? (i.kind === 'task' ? fromTask(i.row) : fromCall(i.row)) : fromCall(i))

export default function FulPhone({ open, onClose, ringId, onAnswer, onDecline, onLine: report, missed = [], live, onLive, startReq, onBook }) {
  const { data: calls } = useFulCalls()
  const { data: day } = useFulDay()
  const { data: tasks } = useFulTasks()
  const { markCall, hideLive } = useFulActions()
  const { data: AGENTS } = useFulAgents()
  // P852: the sample clock on sample rows; the real minute on real rows (and on a real line).
  const { nowIso: NOW_ISO } = useFulClock()
  const note = useNote()
  const navigate = useNavigate()
  const loc = useLocation()
  const [tab, setTab] = useState('todo')
  const [call, act] = useReducer((c, a) => (a.type === 'start' ? newCall(a.who, a.now) : a.type === 'clear' ? null : callReducer(c, a)), null)
  const [sheet, setSheet] = useState(null) // during a call: 'add' | 'xfer' | 'notes' | 'dnc' | 'handoff'
  const [log, setLog] = useState([])       // calls finished this visit
  const [opted, setOpted] = useState(() => new Set()) // P882 sample: people opted out on a call this visit
  const [pres, presDo] = useReducer(presenceReducer, initialPresence)
  const rl = useRealLine()                 // P882: the real engine, null while calling is off
  const offer = rl?.offer || null
  const box = useRef(null)
  const now = useNow((call && (!call.end || pres.status === 'wrap')) || ringId || offer ? 1000 : 30000)
  // P882: the pre-dial check runs on the sample clock for sample rows, on the real clock on a real line.
  const clockNow = rl ? now : Date.parse(NOW_ISO)

  // The server's presence wins on a real line.
  const rlPresence = rl?.presence
  useEffect(() => { if (rlPresence) presDo({ type: 'server', presence: rlPresence, skew: rl?.skew || 0 }) }, [rlPresence, rl?.skew])

  // P882: who can be called right now (consent, opt-out and do-not-call, calling hours in their state, the state's
  // attempt limit). A blocked row says why and when; its Call button is off.
  const check = w => {
    if (w.role === 'carrier') return { ok: true }
    const f = w.kind === 'lead' ? flagsOf({ id: w.id }) : {}
    const attempts = (SAMPLE_ATTEMPTS[w.id] || []).map(m => Date.parse(NOW_ISO) - m * 60000)
    return predial({ state: w.state, consent: true, writtenConsent: true, optedOut: !!f.optedOut || opted.has(w.number), attempts }, clockNow)
  }

  // What the system gave this VA to call, in the order to call it. P907: the next booked call, then the rest of
  // today's bookings. Nothing else (no queue, no leads).
  const todo = useMemo(() => [
    ['Next call', day.next ? [fromItem(day.next)] : []],
    ['Booked today', (day.later || []).map(fromItem)],
  ].filter(([, rows]) => rows.length), [day.next, day.later])

  const resolve = req => {
    if (!req) return null
    const { kind, id } = typeof req === 'string' ? { kind: 'call', id: req } : req
    if (kind === 'call') { const k = calls.find(x => x.id === id); return k ? fromCall(k) : null }
    if (kind === 'task') { const t = tasks.find(x => x.id === id); return t ? fromTask(t) : null }
    if (kind === 'client') {
      const k = calls.find(x => x.client_id === id && OPEN.includes(x.status))
      const t = tasks.find(x => x.client_id === id && x.due !== 'done')
      return k ? fromCall(k) : t ? fromTask(t) : null
    }
    return null
  }

  // A ring: the server's offer on a real line, else the sample call ringing in from the frame. Both last 15 s.
  // P907: the sample's next call can be any booking, so a ring is a call row or a booked servicing call.
  const ringCall = !call && !offer && ringId ? calls.find(x => x.id === ringId) : null
  const ringTask = !call && !offer && ringId && !ringCall ? tasks.find(x => x.id === ringId) : null
  const ring = ringCall || ringTask
  const ringWho = ringCall ? { ...fromCall(ringCall), ringKind: 'call_in' } : ringTask ? { ...fromTask(ringTask), ringKind: 'call_in' } : null

  const offerWho = !call && offer ? { key: `o-${offer.id}`, kind: offer.leadId ? 'lead' : 'call', id: offer.leadId || offer.policyId, role: offer.leadId ? 'lead' : 'client', name: offer.name, number: offer.last4 ? `…${offer.last4}` : '', state: offer.state, reason: RING_KIND[offer.kind] || 'Call', ringKind: offer.kind, callSid: offer.callSid, leadId: offer.leadId, notes: offer.detail?.notes || '' } : null
  const ringing = ringWho || offerWho
  const ringKey = offer ? `o-${offer.id}` : ringId || null
  const offerAt = offer?.at ?? null
  const [ringAt, setRingAt] = useState(null)
  useEffect(() => {
    if (!ringKey) return undefined
    const at = offerAt ?? Date.now()
    const t = setTimeout(() => { setRingAt(at); presDo({ type: 'ring' }) })
    return () => clearTimeout(t)
  }, [ringKey, offerAt])
  // A ring nobody answered (the frame's 15 s timeout, or Not now) is a missed ring; two in a row → Away + admins told.
  const missedN = missed.length
  const [seenMissed, setSeenMissed] = useState(missedN)
  if (missedN !== seenMissed) { setSeenMissed(missedN); if (missedN > seenMissed) presDo({ type: 'missed' }) }
  const away = pres.status === 'away' && pres.missedRow >= MISSED_TO_AWAY
  const [wasAway, setWasAway] = useState(false)
  if (away !== wasAway) { setWasAway(away); if (away) note(`Set to Away after ${MISSED_TO_AWAY} missed rings · admins told`) }

  const subject = call?.who || ringing
  const theirTime = useTheirTime(subject)

  // P882: a ring that interrupts open work (no one on the line) keeps that work: the page stays as it was under the
  // phone, and "Back to" brings the VA to it after the call.
  const pauseWork = () => {
    const d = document.querySelector('[role="dialog"]:not(.fs-call) :is(h1, h2)')
    const task = { label: d?.textContent?.trim() || 'what you were doing', path: `${loc.pathname}${loc.search}` }
    presDo({ type: 'pause', task })
    rl?.pauseTask(task)
  }

  const begin = who => { act({ type: 'start', who }); setSheet(null); presDo({ type: 'answer' }) }
  const start = who => {
    if (!who) return
    if (call && !call.end) { note('Finish this call first'); return }
    if (call && call.end) { note('Save how the last call went first'); return }
    const c = check(who)
    if (!c.ok) { note(predialLine(c, who.state, clockNow)); return }
    begin(who)
    if (rl) {
      rl.openLine({ leadId: who.kind === 'lead' ? who.id : null, policyId: who.kind !== 'lead' ? who.policyId || who.id : null }, { onEnd: () => act({ type: 'end' }) })
        .then(lineId => act({ type: 'line', lineId }))
        .catch(e => note(e.code === 'predial' ? predialLine({ ok: false, reason: e.reason || 'outside_hours', nextAt: e.next_at || null }, who.state) : e.message))
    }
  }
  const answer = () => {
    pauseWork()
    if (offer) {
      const who = offerWho
      begin(who)
      rl.accept(offer, { onEnd: () => act({ type: 'end' }) })
        .then(info => act({ type: 'line', lineId: info.lineId, callSid: info.callSid }))
        .catch(e => { note(e.message); act({ type: 'end' }) })
      return
    }
    const w = ringWho; onAnswer(); begin(w)
  }
  const decline = () => { if (offer) { rl.pass(offer.id).catch(() => {}); presDo({ type: 'missed' }) } else onDecline() }

  // A Call button elsewhere (a call's drawer, a lead, a servicing step) sets the store's live request: the frame
  // slides this screen in (startReq) and the call starts on that person.
  useEffect(() => { if (live) { onLive(live); hideLive() } }, [live, onLive, hideLive])
  const [seenReq, setSeenReq] = useState(null)
  if (startReq && startReq !== seenReq) {
    setSeenReq(startReq)
    const who = resolve(startReq.req)
    if (who && !call) begin(who)
  }

  const view = ringing ? 'ring' : call ? (call.end ? 'result' : 'call') : 'idle'
  const lineState = view === 'call' ? 'live' : view === 'result' ? 'after' : null
  const since = call?.start ?? null
  useEffect(() => { report?.(lineState, since) }, [lineState, since, report])
  // The call ended: wrap-up starts (the outcome is needed before the VA is Available again).
  const ended = !!call?.end
  useEffect(() => { if (ended) presDo({ type: 'wrap' }) }, [ended])

  // Sample: whoever is added answers after a moment; the live transfer moves on its own (P852 swaps in real events).
  const ringingLegs = call?.parties.filter(p => p.state === 'ringing').map(p => p.id).join('|') || ''
  useEffect(() => {
    if (!ringingLegs || call?.lineId) return undefined
    const ts = ringingLegs.split('|').map((id, i) => setTimeout(() => act({ type: 'answered', id }), 2200 + i * 400))
    return () => ts.forEach(clearTimeout)
  }, [ringingLegs, call?.lineId])
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
    // P897: keyed on the agent's id and duty, not the object: useFulAgents() hands back a new list each render, and the
    // 1-second countdown re-render kept restarting these timers, so the sample check never got past Sent.
  }, [xs, xAgent?.id, xAgent?.duty, call?.xfer?.live])

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

  // P882: every button also steers the real line once there is one (the sample keeps its own state either way).
  const srv = (action, extra) => { if (rl && call?.lineId) rl.send(call.lineId, action, extra).catch(e => note(e.message)) }
  const partyOf = p => (p.role === 'lead' ? 'lead' : p.role === 'client' ? 'client' : p.role)
  const took = call ? clock(((call.end || now) - call.start) / 1000) : ''
  const finish = () => { act({ type: 'clear' }); setSheet(null); setTab('todo') }
  const openRec = who => { if (who?.rec) navigate(who.rec) }

  let body
  if (ringing) {
    const left = ringLeft(ringAt ?? now, now)
    const r = ringing
    body = (
      <div className="fs-cs fs-cs-ring">
        <div className="fs-cs-who">
          <span className="fs-cs-kicker"><span className="fs-cs-pulse" aria-hidden="true" />{RING_KIND[r.ringKind] || 'Incoming call'}<span className="fs-cs-count tp-num" aria-label={`${left} seconds to answer`}>{left}s</span></span>
          <Avatar name={r.name} tone="blue" />
          <b className="fs-cs-name">{r.name}</b>
          <small>{r.reason}</small>
          {theirTime && <small className="fs-ph-tz">{theirTime}</small>}
          {ring && <button type="button" className="fs-cs-rec" onClick={() => openRec(ringWho)}>{ring.agent}'s client · open the call<ArrowUpRight size={13} aria-hidden="true" /></button>}
          {offer?.pullHold && <small className="fs-cs-why">Your carrier hold goes to the next free VA when you answer.</small>}
        </div>
        {!CALLING_ON && !offer && <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" /><span>Calling is off right now. Answer to keep the time and notes here, and dial <b className="tp-num">{ring.client.client_phone}</b> from your phone.</span></p>}
        <p className="tp-sub fs-cs-ringrule">Not answered in {left}s, it goes to the next free VA and counts as a missed ring.</p>
        <div className="fs-cs-ans">
          <span><button type="button" className="fs-rb is-end" aria-label="Not now" onClick={decline}><PhoneOff size={24} /></button><small>Not now</small></span>
          <span><button type="button" className="fs-rb is-go" data-first aria-label={`Answer ${r.name}`} onClick={answer}><PhoneIc size={24} /></button><small>Answer</small></span>
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
    const person = p.role === 'lead' || p.role === 'client'
    const personOn = call.parties.some(x => x.id === p.key)
    const carrierHold = holdOnlyCarrier(call)
    const status = call.held ? `On hold · ${clock(held / 1000)}` : call.muted ? 'Muted' : people > 2 ? `${people} on the call` : 'On the call'
    const btn = (key, label, Icon, on, run, extra = {}) => (
      <span key={key} className="fs-rbw"><button type="button" className={`fs-rb${on ? ' is-on' : ''}${extra.cls ? ` ${extra.cls}` : ''}`} aria-pressed={extra.press === false ? undefined : !!on}
        aria-label={extra.aria || label} disabled={extra.disabled} title={extra.title} onClick={run} {...(extra.first ? { 'data-first': true } : {})}><Icon size={22} /></button><small>{label}</small></span>
    )
    const doDnc = () => {
      act({ type: 'dnc' }); setSheet(null)
      setOpted(s => new Set(s).add(p.number))
      if (rl) rl.doNotCall({ phone: p.number, leadId: isLead ? p.id : null, policyId: p.policyId || null, reason: 'asked_on_call' }).catch(e => note(e.message))
      note('Opted out everywhere: calls, texts and the text system')
    }
    const doHelp = () => {
      act({ type: 'help' })
      if (rl && call.lineId) rl.needHelp(call.lineId).catch(e => note(e.message))
      note('Both admins were pinged. They can listen, whisper or join.')
    }
    const doVoicemail = () => {
      srv('voicemail', { party: partyOf(p) })
      act({ type: 'voicemail', id: p.key })
      note(`Voicemail left for ${p.name.split(' ')[0]}. Their line was dropped`)
    }
    body = (
      <div className="fs-cs">
        <div className="fs-cs-who">
          <Avatar name={p.name} tone="blue" />
          <button type="button" className="fs-cs-name is-link" onClick={() => openRec(p)} aria-label={`Open ${p.name}'s record`}>{p.name}<ArrowUpRight size={15} aria-hidden="true" /></button>
          <small>{p.reason}</small>
          {theirTime && <small className="fs-ph-tz">{theirTime}</small>}
          <p className={`fs-cs-timer tp-num${call.held ? ' is-held' : ''}`} aria-live="off"><span>{status}</span>{took}</p>
        </div>
        {!CALLING_ON && !call.lineId && <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" /><span>Calling is off right now. Dial <b className="tp-num">{p.number}</b> from your phone. This keeps the time, the line and your notes.</span></p>}
        {call.dnc && <p className="fs-cs-band" role="status"><CircleSlash size={15} aria-hidden="true" /><span><b>Opted out everywhere</b><small>No more calls or texts to {p.name.split(' ')[0]}. Say goodbye, then end the call.</small></span></p>}
        {call.help && <p className="fs-cs-band is-help" role="status"><LifeBuoy size={15} aria-hidden="true" /><span><b>Help is on the way</b><small>An admin can listen, whisper to you, or join the call.</small></span></p>}
        {(people > 2 || waiting || pending) && <LineList call={call} onDrop={id => { const x = call.parties.find(q => q.id === id); if (x) srv('end', { party: partyOf(x) }); act({ type: 'drop', id }) }} onMerge={() => { srv('merge'); act({ type: 'merge' }) }} />}
        {call.xfer && <XferCard x={call.xfer} agent={xAgent} now={now}
          onTransfer={() => (real ? real.transfer().catch(e => note(e.message)) : act({ type: 'transfer' }))}
          onBook={() => { onBook?.(p); if (real) { real.book().catch(() => {}); real.clear() } act({ type: 'xferClear' }) }}
          onClear={() => { real?.clear(); act({ type: 'xferClear' }) }} />}
        {call.pad && <div className="fs-ph-tones tp-num" aria-label="Keys pressed">{call.tones || ' '}</div>}
        {call.pad && <div className="fs-pad is-small" aria-label="Keypad for tones">{PAD.map(d => <button key={d} type="button" className="fs-key" onClick={() => { act({ type: 'tone', key: d }); srv('dtmf', { digits: d }) }}>{d}</button>)}</div>}
        {sheet === 'notes' && <Field label="Notes" hint="Saved with the call"><textarea className="tp-input fx-ta" rows={3} placeholder="What happened on the call" value={call.notes} onChange={e => act({ type: 'notes', text: e.target.value })} /></Field>}
        {sheet === 'add' && <AddCaller who={p} on={call.parties} onPick={party => { srv(party.role === 'agent' ? 'ring_agent' : 'ring_carrier', party.role === 'carrier' ? { carrier_id: party.id } : {}); act({ type: 'add', party }); setSheet(null) }} onClose={() => setSheet(null)} />}
        {sheet === 'xfer' && <PickAgent who={p} real={!!real} onCheck={agent => { if (real) real.check().catch(e => note(e.message)); else act({ type: 'check', agent }); setSheet(null) }} onClose={() => setSheet(null)} />}
        {sheet === 'dnc' && (
          <section className="fs-cs-sheet" aria-label="Do not call">
            <header className="fs-cs-sh"><b>Do not call {p.name.split(' ')[0]}?</b><button type="button" className="fx-x" aria-label="Close" onClick={() => setSheet(null)}><X size={15} /></button></header>
            <p className="tp-sub">Stops every call and text to {p.number} right away: booked calls, callbacks, check-in texts and the text system.</p>
            <div className="fs-ph-acts"><button type="button" className="tp-primary fs-cs-dncgo" data-first onClick={doDnc}><Ban size={16} />Do not call</button><button type="button" className="tp-btn ov-ghost" onClick={() => setSheet(null)}>Keep calling</button></div>
          </section>
        )}
        {sheet === 'handoff' && <HandOff call={call} rl={rl} note={note} onDone={h => { act({ type: 'handoff', ...h }); setSheet(null) }} onClose={() => setSheet(null)} />}
        <div className="fs-cs-grid">
          {btn('mute', call.muted ? 'Unmute' : 'Mute', call.muted ? MicOff : Mic, call.muted, () => { rl?.mute(!call.muted); act({ type: 'mute' }) }, { first: true })}
          {btn('pad', 'Keypad', Grid3x3, call.pad, () => act({ type: 'pad' }), { title: 'Tones for carrier menus' })}
          {btn('spk', 'Speaker', Volume2, call.speaker, () => act({ type: 'speaker' }))}
          {btn('hold', call.held ? 'Resume' : 'Hold', call.held ? Play : Pause, call.held, () => { srv(call.held ? 'resume' : 'hold', { party: partyOf(p) }); act({ type: 'hold' }) })}
          {waiting
            ? btn('merge', 'Merge', Merge, false, () => { srv('merge'); act({ type: 'merge' }) }, { press: false, cls: 'is-merge', aria: 'Merge everyone into one call' })
            : btn('add', 'Add caller', UserPlus, sheet === 'add', () => setSheet(s => (s === 'add' ? null : 'add')), { press: false, aria: 'Add a carrier or the agent to the call' })}
          {btn('xfer', 'Transfer', PhoneForwarded, sheet === 'xfer' || xferOpen(call.xfer), () => setSheet(s => (s === 'xfer' ? null : 'xfer')), { press: false, disabled: !isLead || !!call.xfer, title: isLead ? 'Live transfer to the agent' : 'Live transfer is for leads. For a coverage question, Add caller → the agent' })}
          {btn('notes', 'Notes', NotebookPen, sheet === 'notes', () => setSheet(s => (s === 'notes' ? null : 'notes')), { press: false })}
          {btn('help', 'Need help', LifeBuoy, !!call.help, doHelp, { press: false, disabled: !!call.help, aria: 'Need help: ping both admins' })}
        </div>
        <div className="fs-cs-more">
          {carrierHold && <button type="button" className="tp-primary fx-accent" onClick={() => setSheet('handoff')}><ArrowRightLeft size={16} />Hand off hold</button>}
          {person && personOn && <button type="button" className="fx-pillbtn" onClick={doVoicemail} title="Leaves the voicemail message and drops their line"><Voicemail size={14} />Voicemail</button>}
          {person && <button type="button" className="fx-pillbtn fs-cs-dnc" disabled={call.dnc} onClick={() => setSheet('dnc')}><Ban size={14} />{call.dnc ? 'Opted out' : 'Do not call'}</button>}
        </div>
        <div className="fs-cs-endrow"><span className="fs-rbw"><button type="button" className="fs-rb is-end is-big" aria-label="End the call" onClick={() => { srv('end_all'); rl?.hangUp(); act({ type: 'end' }) }}><PhoneOff size={26} /></button><small>End</small></span></div>
      </div>
    )
  } else if (call) {
    body = <Result call={call} took={took} agent={xAgent} pres={pres} now={now}
      onMore={() => { presDo({ type: 'more' }); rl?.wrapMore().catch(() => {}) }}
      save={r => {
        const p = call.who
        if (p.callId && (r.pick === 'cancelled' || r.pick === 'no_answer')) {
          if (r.pick === 'cancelled') { markCall(p.callId, 'cancelled', { confirmation: r.conf.trim().toUpperCase(), notes: r.notes }); note('Cancelled. Saved with the confirmation number') }
          else { markCall(p.callId, 'no_answer', { notes: r.notes || 'No answer.' }); note(`No answer logged for ${p.name.split(' ')[0]}`) }
        } else note(`Call with ${p.name} logged · you're Available`)
        const word = CALL_WORD[r.pick] || r.pick
        presDo({ type: 'done', outcome: word })
        rl?.wrapDone(word).catch(() => {})
        setLog(l => [{ id: `d-${Date.now()}`, callId: p.callId || null, name: p.name, number: p.number, outcome: word, tone: /cancel|reached|transfer/i.test(word) ? 'cancelled' : 'no_answer', when: `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, who: p }, ...l])
        finish()
      }} />
  } else {
    const recent = [
      ...log,
      ...missed.map(m => calls.find(k => k.id === m.id)).filter(Boolean).map((k, i) => ({ id: `m-${k.id}-${i}`, name: k.name, number: k.client.client_phone, outcome: 'Missed', tone: 'no_answer', when: 'Today, just now', who: fromCall(k), missed: true })),
      // P897: a call saved from the phone is already in `log`, so its call row isn't listed a second time
      ...calls.filter(k => (!OPEN.includes(k.status) || k.status === 'no_answer') && !log.some(e => e.callId === k.id)).sort((a, b) => b.day - a.day).map(k => ({ id: k.id, name: k.name, number: k.client.client_phone, outcome: CALL_WORD[k.status], tone: k.status, when: k.day === 5 ? `Today, ${k.time}` : `Nov ${k.day}, ${k.time}`, who: fromCall(k) })),
    ]
    body = (
      <>
        <div className="fs-ph-tabs" role="tablist" aria-label="Phone">
          {[['todo', 'To call', ListTodo], ['recent', 'Recent', History]].map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`fs-ph-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)} {...(tab === k ? { 'data-first': true } : {})}><I size={15} aria-hidden="true" />{l}</button>)}
        </div>
        {tab === 'todo' ? (
          <>
            {pres.paused && (
              <button type="button" className="fs-ph-back is-task" onClick={() => { const to = pres.paused.path; presDo({ type: 'resume' }); rl?.pauseTask(null); slideAway(); navigate(to) }}>
                <Undo2 size={15} aria-hidden="true" /><span className="tp-grow"><b>Back to: {pres.paused.label}</b><small>A call came in while you were on it. Your draft is where you left it.</small></span>
              </button>
            )}
            <p className="tp-sub fs-ph-rule">Calls come in, or start from what you were given here. You don't dial numbers yourself.</p>
            {todo.length === 0 && <p className="fx-calm">Nothing to call right now. Calls that come in ring here.</p>}
            {todo.map(([head, rows]) => (
              <section key={head} className="fs-ph-group" aria-label={head}>
                <h3 className="fs-ph-gh">{head}<span className="tp-num">{rows.length}</span></h3>
                <ul className="tp-list fs-ph-todo">{rows.map(w => { const c = check(w); return <TodoRow key={w.key} w={w} block={c.ok ? null : predialLine(c, w.state, clockNow)} onCall={() => start(w)} onOpen={() => openRec(w)} /> })}</ul>
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
  const head = ringing ? 'A call is coming in' : onCall ? `On a call · ${took}` : view === 'result' ? 'How did it go?' : CALLING_ON || rl ? 'Ready' : 'Calling is off right now'
  const lesson = ringing ? 'answer' : call ? 'logging' : 'dialer'
  // Available / Away: only between calls (a ring, a call and the wrap-up set it themselves).
  const busy = ['ringing', 'on_call', 'wrap'].includes(pres.status) || !!call || !!ringing
  const presTo = pres.status === 'away' || pres.status === 'offline' ? 'available' : 'away'

  // Portaled to <body> like the record drawers. No scrim: the page behind stays usable and never moves.
  return createPortal(
    <div className="tp fx-layer fs-call-layer">
      <section ref={box} className={`fs-call${open ? ' is-in' : ''}${onCall || ringing ? ' is-live' : ''}`} role="dialog" aria-label="Phone" aria-hidden={!open}>
        <button type="button" className="fs-call-tab" aria-label={call && !call.end ? 'Slide the phone away. The call keeps going' : 'Slide the phone away'} title={call && !call.end ? 'Slide away (the call keeps going)' : 'Slide away'} onClick={slideAway}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <header className="fs-ph-h">
          <span className={`fs-ph-ic${ringing || onCall ? ' is-live' : ''}`} aria-hidden="true"><PhoneIc size={16} /></span>
          <span className="tp-grow"><b>Phone</b><small>{head}</small></span>
          <button type="button" className={`fs-ph-pres is-${pres.status}`} disabled={busy}
            aria-label={`Status: ${PRESENCE_WORDS[pres.status]}.${busy ? '' : ` Set to ${PRESENCE_WORDS[presTo]}`}`}
            title={busy ? 'Set by the call' : `Set to ${PRESENCE_WORDS[presTo]}`}
            onClick={() => { presDo({ type: 'set', status: presTo }); rl?.setStatus(presTo) }}>
            <i aria-hidden="true" />{PRESENCE_WORDS[pres.status]}
          </button>
          <HelpDot lesson={lesson} />
        </header>
        <div className="fs-ph-b">{body}</div>
      </section>
    </div>,
    document.body,
  )
}

function TodoRow({ w, block, onCall, onOpen }) {
  return (
    <li className={`fs-ph-row${block ? ' is-blocked' : ''}`}>
      <button type="button" className="fx-mrow" onClick={onOpen} aria-label={`Open ${w.name}'s record`}>
        <Avatar name={w.name} /><span className="tp-grow"><b>{w.name}</b><small>{w.reason}</small>{block ? <small className="fs-ph-block"><CircleSlash size={12} aria-hidden="true" />{block}</small> : <small className="tp-num">{w.when}</small>}</span>
      </button>
      <button type="button" className="fs-rb is-go is-sm" aria-label={block ? `Can't call ${w.name} now: ${block}` : `Call ${w.name}`} title={block || `Call ${w.name.split(' ')[0]}`} disabled={!!block} onClick={onCall}><PhoneIc size={16} /></button>
    </li>
  )
}

// P882 — Hand off hold: a carrier hold with no client goes to the next free VA with the menu path and notes. If no VA
// is free (shift end), ask the admins for overtime, or book it as a callback (the client gets an automatic text).
function HandOff({ call, rl, note, onDone, onClose }) {
  const [path, setPath] = useState(call.tones ? `Pressed ${call.tones}` : '')
  const [notes, setNotes] = useState(call.notes || '')
  const [noOne, setNoOne] = useState(false)
  const carrier = call.parties.find(p => p.role === 'carrier')
  const go = async () => {
    if (rl && call.lineId) {
      try {
        const r = await rl.handoff(call.lineId, { carrier: carrier?.name, menu_path: path, notes })
        if (r?.no_one) { setNoOne(true); return }
      } catch (e) { note(e.message); return }
    }
    note('Handed off to the next free VA')
    onDone({ path, notes })
  }
  return (
    <section className="fs-cs-sheet" aria-label="Hand off hold">
      <header className="fs-cs-sh"><b>Hand off the {carrier?.name || 'carrier'} hold</b><button type="button" className="fx-x" aria-label="Close" onClick={onClose}><X size={15} /></button></header>
      <p className="tp-sub">The next free VA takes your place on hold and gets these. You leave the call.</p>
      <Field label="Menu path" hint="The keys you pressed to get here"><input data-first value={path} placeholder="e.g. 2, then 4, then 0" onChange={e => setPath(e.target.value)} /></Field>
      <Field label="Notes for the next VA"><textarea className="tp-input fx-ta" rows={2} value={notes} placeholder="What the carrier needs once they pick up" onChange={e => setNotes(e.target.value)} /></Field>
      {noOne ? (
        <>
          <p className="fs-cs-why" role="note">No VA is free to take it.</p>
          <div className="fs-ph-acts">
            <button type="button" className="tp-primary fx-accent" onClick={() => { rl?.overtime(call.lineId, 30).catch(e => note(e.message)); note('Overtime asked for. You stay on the hold until an admin answers'); onClose() }}><Timer size={16} />Ask for overtime</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => { rl?.send(call.lineId, 'end_all').catch(() => {}); note('Booked as a callback on the Schedule. The client gets an automatic text'); onDone({ path, notes }) }}>Book a callback</button>
          </div>
        </>
      ) : <div className="fs-ph-acts"><button type="button" className="tp-primary fx-accent" onClick={go}><ArrowRightLeft size={16} />Hand off</button></div>}
    </section>
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
  const { data: AGENTS } = useFulAgents()
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
  const { data: AGENTS } = useFulAgents()
  const can = a => a.duty && !SAMPLE_REACH[a.id]
  const [agent, setAgent] = useState((AGENTS.find(can) || AGENTS[0])?.id)
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
// P882 wrap-up: the outcome is required before the VA is Available again (no Skip). 60 seconds, +60 s at a time (each
// one counted); past 3 minutes the admins are told.
const FREE = ['Reached them', 'No answer', 'Left a voicemail']
function Result({ call, took, agent, pres, now, onMore, save }) {
  const p = call.who
  const transferred = call.outcome === 'transferred'
  const handed = call.outcome === 'handed_off'
  const free = call.dnc ? ['Asked not to be called', ...FREE] : FREE
  const opts = transferred ? [[`Transferred to ${agent?.name || 'the agent'}`, `Transferred to ${agent?.name.split(' ')[0] || 'the agent'}`]]
    : handed ? [['Handed off the hold', 'Handed off the hold']]
      : p.callId ? [['cancelled', 'Cancelled'], ['no_answer', 'No answer']] : free.map(f => [f, f])
  const [pick, setPick] = useState(call.vm && !p.callId ? 'Left a voicemail' : opts[0][0])
  const [conf, setConf] = useState('')
  const [notes, setNotes] = useState(call.notes || '')
  const ready = !!pick && (!p.callId || pick !== 'cancelled' || conf.trim().length >= 4)
  const left = wrapLeft(pres, now)
  const over = left != null && left < 0
  const stuck = wrapStuck(pres, now)
  return (
    <div className="fs-ph-call">
      <div className="fs-ph-who"><Avatar name={p.name} /><span className="tp-grow"><b>{p.name}</b><small>Call ended · {took}{heldFor(call) ? ` · on hold ${clock(heldFor(call) / 1000)}` : ''}</small></span></div>
      {left != null && (
        <div className={`fs-cs-wrap${over ? ' is-over' : ''}`} role="timer" aria-live="off">
          <Timer size={15} aria-hidden="true" />
          <span className="tp-grow"><b>Wrap-up <span className="tp-num">{over ? `over by ${clock(-left / 1000)}` : clock(left / 1000)}</span></b>
            <small>{stuck ? 'Wrap-up passed 3 minutes, so the admins were told.' : 'Save the outcome to be Available for the next call.'}{pres.wrapExtra ? ` · +60 s used ${pres.wrapExtra}×` : ''}</small></span>
          <button type="button" className="fx-pillbtn" onClick={onMore} aria-label="60 more seconds"><Plus size={13} />60 s</button>
        </div>
      )}
      <div className="tp-field"><span>How did it go?</span>
        <PillTabs role="radiogroup" label="How did it go?" className="fx-chips" itemClass="fx-chip" value={pick} onChange={setPick} items={opts.map(([v, l]) => ({ key: v, label: <b>{l}</b> }))} />
      </div>
      {p.callId && pick === 'cancelled' && <Field label="Confirmation number" hint="From the carrier, on the call"><input data-first value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>}
      <Field label="Notes" hint={p.agent ? `${p.agent.split(' ')[0]} sees these` : undefined}><textarea className="tp-input fx-ta" rows={3} placeholder="What happened on the call" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <div className="fs-ph-acts">
        <button type="button" className="tp-primary fx-accent" data-first disabled={!ready} onClick={() => save({ pick, conf, notes })}><CircleCheck size={16} />Save · Available</button>
      </div>
    </div>
  )
}
