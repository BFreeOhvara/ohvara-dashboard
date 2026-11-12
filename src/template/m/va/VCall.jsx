import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Mic, MicOff, Grid3x3, Volume2, Building2, Check, Pause, Play, NotebookPen, PhoneOff } from 'lucide-react'
import { useFulActions, useFulClients, useFulClock, useFulSource, useFulThreads } from '../../ful/data'
import { newCall, callReducer } from '../../ful/callLine'
import { fromItem } from '../../ful/callWho'
import { whyShort, whyLine, stepsOf } from '../../ful/callSteps'
import { useRealLine } from '../../../hooks/useRealLine'
import { callGate } from '../../../lib/callOpen'
import { useCallOpenMin } from '../../../hooks/useCallOpen'
import { PAD } from '../../../components/fulfillment/phoneIcons'
import { clockOf } from '../../../lib/callSlots'
import { useNote } from '../../kit'
import { useExit } from '../../motion'
import { BottomSheet, Ini } from '../AppKit'
import { CallCtx } from './vaStore'
import { useVaNow } from './useVaNow'
import { OUTCOMES, outcomePlan, carrierLine, carrierPhone, carrierId, draftWords, firstName, callTimer, holdTitle, forLine } from './vaModel'

// P975 — the call, the heart of the VA app. One call at a time, on the SAME engine as the desktop VA phone
// (ful/Phone.jsx): the call state is ful/callLine's reducer, the person is ful/callWho's, and once calling is on
// (recovery_config.voice_live) every button also drives the real line (hooks/useRealLine: open the line, mute, hold,
// keypad tones, ring the carrier, merge, hang up). Until then the screen keeps the time, the line and the notes.
//   Brief (a bottom sheet) → Start call → the call screen (full, dark) → End → the result sheet.
// Ending a call ALWAYS opens the result sheet and it can't be closed without a pick (the desktop rule, P946): no scrim
// tap, no swipe down, no Escape. A pick saves through the desktop's own actions (vaModel outcomePlan) and the agent
// sees it at once. If the app is closed with the sheet up, it comes back on the next open (kept on this phone).
const PENDING = 'ohvara-va-pending-result'
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null') } catch { return null } }
const writePending = v => { try { if (v) localStorage.setItem(PENDING, JSON.stringify(v)); else localStorage.removeItem(PENDING) } catch { /* private window */ } }

function useTick(on) {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => { if (!on) return undefined; const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t) }, [on])
  return n
}

export function VaCallProvider({ schedule = [], children }) {
  const actions = useFulActions()
  const { data: threads } = useFulThreads()
  const { data: clients } = useFulClients()
  const clock = useFulClock()
  const source = useFulSource()
  const openMin = useCallOpenMin(!!clock.real)
  const note = useNote()
  const rl = useRealLine()
  const [call, act] = useReducer((c, a) => (a.type === 'start' ? newCall(a.who, a.now) : a.type === 'clear' ? null : callReducer(c, a)), null)
  const [item, setItem] = useState(null)     // the booked call this call is for (null: a caller on hold)
  const [brief, setBrief] = useState(null)   // the booked call whose brief is open
  const [pending, setPending] = useState(readPending) // a result still owed from a call that ended before the app closed
  const [held, setHeld] = useState(() => (source === 'sample' ? 2 : 0)) // sample: callers waiting on the line
  const [heldAt] = useState(() => Date.now())

  const { nowMs } = useVaNow()
  const gateOf = useCallback(i => callGate({ iso: i?.iso, done: i?.done, nowMs, lead: openMin }), [nowMs, openMin])
  const lineId = call?.lineId || null
  const srv = useCallback((action, extra) => { if (rl && lineId) rl.send(lineId, action, extra).catch(e => note(e.message)) }, [rl, lineId, note])

  const begin = useCallback((who, it) => {
    if (call) { note(call.end ? 'Save how the last call went first' : 'Finish this call first'); return false }
    setItem(it); setBrief(null)
    act({ type: 'start', who })
    if (rl && !who.offer) {
      rl.openLine({ leadId: who.kind === 'lead' ? who.id : null, policyId: who.kind !== 'lead' ? who.policyId || who.id : null }, { onEnd: () => act({ type: 'end' }) })
        .then(lineId => act({ type: 'line', lineId }))
        .catch(e => note(e.message))
    }
    return true
  }, [call, rl, note])

  const start = useCallback(it => {
    const g = gateOf(it)
    if (!g.open) { note(g.done ? 'This call is done' : `Start call opens at ${clockOf(new Date(g.at).toISOString(), clock.tz)}`); return }
    begin(fromItem(it), it)
  }, [gateOf, begin, note, clock.tz])

  // A caller waiting on the incoming line: the real ring routed to this VA, or the sample's callers on hold.
  const offer = rl?.offer || null
  const holdCount = offer ? 1 : held
  const takeHold = useCallback(() => {
    if (offer) {
      const who = { key: `o-${offer.id}`, kind: offer.leadId ? 'lead' : 'call', id: offer.leadId || offer.policyId, role: offer.leadId ? 'lead' : 'client', name: offer.name, number: offer.last4 ? `…${offer.last4}` : '', state: offer.state, reason: 'Called in', offer: true }
      if (!begin(who, null)) return
      rl.accept(offer, { onEnd: () => act({ type: 'end' }) }).then(info => act({ type: 'line', lineId: info.lineId, callSid: info.callSid })).catch(e => { note(e.message); act({ type: 'end' }) })
      return
    }
    if (held <= 0) return
    const c = clients.find(x => x.stage === 'needs_attention') || clients[0]
    if (!c) return
    const who = { key: `h-${c.id}`, kind: 'callin', id: c.id, role: 'client', name: c.name, number: c.client_phone, state: c.state, city: c.city, agentId: c.agent_id, agent: c.agent, carrier: c.carrier_name, reason: 'Called in · was on hold', clientId: c.id }
    if (begin(who, null)) setHeld(n => n - 1)
  }, [offer, held, clients, begin, rl, note])

  // The call ended: the result is owed, and stays owed (on this phone) until it's picked.
  const ended = !!call?.end
  useEffect(() => {
    if (!ended || !call) return
    const p = { ref: item?.ref || null, name: call.who.name, clientId: call.who.clientId || item?.row?.client_id || null, at: call.end }
    writePending(p)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the owed result is kept on the phone the moment the call ends
    setPending(p)
  }, [ended]) // eslint-disable-line react-hooks/exhaustive-deps

  const owed = useMemo(() => (pending ? { ...pending, item: item && item.ref === pending.ref ? item : schedule.find(s => s.ref === pending.ref) || null } : null), [pending, item, schedule])

  const tellAgent = useCallback((who, clientId, words) => {
    const t = threads.find(x => !x.support && clientId && x.client_id === clientId)
    const text = `${who} needs you: ${words}`
    if (t) actions.sendMessage(t.id, text)
    return !!t
  }, [threads, actions])

  const pick = useCallback(k => {
    if (!owed) return
    const it = owed.item
    const notes = call?.notes || ''
    const plan = outcomePlan(it, k, { tz: it?.tz || clock.tz, notes })
    const first = firstName(owed.name)
    for (const [name, ...args] of plan.run) {
      if (name === 'tellAgent') {
        const told = tellAgent(owed.name, owed.clientId || it?.row?.client_id, notes || (it ? whyShort(it) : 'they called in'))
        if (!told) note(`${first}: the agent is told in Activity`)
      } else if (name === 'bookCallback') {
        const c = clients.find(x => x.id === owed.clientId)
        actions.bookCallback?.({ name: owed.name, phone: c?.client_phone || '', city: c?.city || '', state: c?.state || '', clientId: owed.clientId, agentId: c?.agent_id || null, ...args[0] })
      } else actions[name]?.(...args)
    }
    rl?.wrapDone?.(plan.word).catch?.(() => {})
    writePending(null)
    setPending(null)
    setItem(null)
    act({ type: 'clear' })
    note(`${first}: ${plan.word.toLowerCase()}${k === 'agent' ? ' · the agent sees it now' : ''}`)
  }, [owed, call?.notes, clock.tz, tellAgent, clients, actions, rl, note])

  const value = useMemo(() => ({
    call, act, srv, rl, item, start, takeHold, holdCount, gateOf, nowMs,
    openBrief: it => setBrief(it), needResult: it => { const p = { ref: it.ref, name: it.name, clientId: it.row?.client_id || null, at: Date.now() }; writePending(p); setPending(p) },
  }), [call, srv, rl, item, start, takeHold, holdCount, gateOf, nowMs])

  const holdNow = useTick(holdCount > 0)
  const longest = Math.round((holdNow - heldAt) / 1000) + 100
  return (
    <CallCtx.Provider value={{ ...value, holdLine: holdCount ? holdTitle(holdCount, offer ? 0 : longest) : '' }}>
      {children}
      <BriefSheet it={brief} onClose={() => setBrief(null)} onStart={() => start(brief)} gate={brief ? gateOf(brief) : null} tz={clock.tz} />
      {call && !call.end && <CallScreen call={call} act={act} srv={srv} rl={rl} item={item} />}
      <ResultSheet owed={owed} onPick={pick} />
    </CallCtx.Provider>
  )
}

// ── The brief ────────────────────────────────────────────────────────────────────────────────────────────────────
function BriefSheet({ it, onClose, onStart, gate, tz }) {
  const row = it?.row || {}
  const c = row.client || {}
  const carrier = row.old_carrier || row.carrier || c.carrier_name || ''
  const day = it?.iso ? new Date(it.iso).toISOString().slice(0, 10) : null
  const steps = it ? stepsOf(row).slice(0, 3) : []
  return (
    <BottomSheet open={!!it} onClose={onClose} label="Call brief">
      {it && <>
        <div className="va-brief-h">
          <Ini name={it.name} tone="sky" size={48} />
          <span className="ma-grow"><b>{it.name}</b><small>{it.time} · {whyShort(it)}</small></span>
        </div>
        <div className="va-facts">
          <span><small>Agent</small><b>{it.agent || 'Not given'}</b></span>
          <span><small>Carrier</small><b>{carrier || 'Not given'}</b></span>
          <span><small>Carrier line</small><b>{carrierLine(carrier, day)}</b></span>
          <span><small>Draft day</small><b>{draftWords(c.draft_day || row.brief?.replaces?.draft_day)}</b></span>
        </div>
        <div className="va-todo is-butter">
          <b>What to do on this call</b>
          <p>{whyLine(row)}</p>
          {steps.length > 0 && <ol>{steps.map(s => <li key={s.key}>{s.title}</li>)}</ol>}
        </div>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={!gate?.open} onClick={onStart}>
          <Phone size={18} aria-hidden="true" />{gate?.open ? 'Start call' : gate?.done ? 'Done' : `Opens at ${clockOf(new Date(gate.at).toISOString(), tz)}`}
        </button>
      </>}
    </BottomSheet>
  )
}

// ── The call screen ──────────────────────────────────────────────────────────────────────────────────────────────
function CallScreen({ call, act, srv, rl, item }) {
  const now = useTick(true)
  const [notes, setNotes] = useState(false)
  const who = call.who
  const carrierName = who.carrier || item?.row?.old_carrier || item?.row?.carrier || ''
  const carrierParty = call.parties.find(p => p.role === 'carrier')
  const merged = carrierParty?.state === 'line'
  const ringing = carrierParty && carrierParty.state !== 'line'
  const partyOf = p => (p.role === 'lead' ? 'lead' : p.role === 'client' ? 'client' : p.role)

  // Sample: the carrier picks up after a moment (a real line reports its own legs). Then the 3-way merge.
  const ringingIds = call.parties.filter(p => p.state === 'ringing').map(p => p.id).join('|')
  useEffect(() => {
    if (!ringingIds || call.lineId) return undefined
    const ts = ringingIds.split('|').map((id, i) => setTimeout(() => act({ type: 'answered', id }), 2200 + i * 400))
    return () => ts.forEach(clearTimeout)
  }, [ringingIds, call.lineId, act])
  const waiting = call.parties.some(p => p.state === 'waiting')
  useEffect(() => { if (waiting) { srv('merge'); act({ type: 'merge' }) } }, [waiting, srv, act])

  const addCarrier = () => {
    if (carrierParty) return
    const id = carrierId(carrierName) || `carrier-${carrierName || 'line'}`
    srv('ring_carrier', { carrier_id: id })
    act({ type: 'add', party: { id, name: carrierName || 'Carrier', role: 'carrier', number: carrierPhone(carrierName) } })
  }
  const heldMs = call.held ? now - (call.heldSince || now) : 0
  const took = callTimer(now - call.start)
  const end = () => { srv('end_all'); rl?.hangUp?.(); act({ type: 'end' }) }
  const btn = (key, label, Icon, on, run, extra = {}) => (
    <button key={key} type="button" className={`va-cb ma-press${on ? ' is-on' : ''}${extra.tone ? ` is-${extra.tone}` : ''}`} aria-pressed={extra.press === false ? undefined : !!on} aria-label={extra.aria || label} onClick={run} disabled={extra.disabled}>
      <span className="va-cb-i"><Icon size={24} aria-hidden="true" /></span><small>{label}</small>
    </button>
  )
  return createPortal(
    <div className="tp fx ma-layer va-call" role="dialog" aria-modal="true" aria-label={`On a call with ${who.name}`}>
      <small className="va-call-line">{merged ? 'Ohvara line · 3-way call' : 'Ohvara line · client line'}</small>
      <span className="va-call-av"><Ini name={who.name} tone="sky" size={96} /></span>
      <b className="va-call-name">{who.name}</b>
      <span className="va-call-what">{forLine(item ? whyShort(item) : who.reason, who.agent)}</span>
      {merged && <span className="va-call-merged" role="status">3-way · {carrierParty.name} line joined</span>}
      {ringing && <span className="va-call-merged is-ringing" role="status">Calling {carrierParty.name}…</span>}
      <span className="va-call-timer" aria-live="off">{call.held ? `On hold · ${callTimer(heldMs)}` : call.muted ? `Muted · ${took}` : took}</span>
      {!call.lineId && <p className="va-call-off">Calling is off right now. Dial <b>{who.number || 'them'}</b> from your phone. This keeps the time, the line and your notes.</p>}
      {notes && (
        <label className="va-call-notes"><span>Notes · saved with the call</span>
          <textarea rows={3} value={call.notes} placeholder="What happened on the call" onChange={e => act({ type: 'notes', text: e.target.value })} />
        </label>
      )}
      {call.pad && !notes && (
        <div className="va-pad" aria-label="Keypad for carrier menus">
          {PAD.map(d => <button key={d} type="button" className="va-key ma-press" onClick={() => { act({ type: 'tone', key: d }); srv('dtmf', { digits: d }) }}>{d}</button>)}
        </div>
      )}
      <div className="va-call-grid">
        {btn('mute', call.muted ? 'Muted' : 'Mute', call.muted ? MicOff : Mic, call.muted, () => { rl?.mute?.(!call.muted); act({ type: 'mute' }) })}
        {btn('pad', 'Keypad', Grid3x3, call.pad, () => { setNotes(false); act({ type: 'pad' }) })}
        {btn('spk', 'Speaker', Volume2, call.speaker, () => act({ type: 'speaker' }))}
        {btn('carrier', merged ? 'Carrier on' : ringing ? 'Calling…' : 'Add carrier', merged ? Check : Building2, merged, addCarrier, { press: false, tone: merged ? 'sage' : null, aria: merged ? `${carrierParty.name} is on the call` : `Call ${carrierName || 'the carrier'} and merge them in`, disabled: !!carrierParty })}
        {btn('hold', call.held ? 'Resume' : 'Hold', call.held ? Play : Pause, call.held, () => { srv(call.held ? 'resume' : 'hold', { party: partyOf(who) }); act({ type: 'hold' }) }, { tone: call.held ? 'butter' : null })}
        {btn('notes', 'Notes', NotebookPen, notes, () => { if (call.pad) act({ type: 'pad' }); setNotes(n => !n) }, { press: false })}
      </div>
      <button type="button" className="va-end ma-press" aria-label="End call" onClick={end}><PhoneOff size={30} aria-hidden="true" /></button>
    </div>,
    document.body,
  )
}

// ── The result sheet: it can't be closed without a pick ─────────────────────────────────────────────────────────
function ResultSheet({ owed, onPick }) {
  const [shown] = useExit(!!owed)
  const [shake, setShake] = useState(0)
  const sheet = useRef(null)
  useEffect(() => {
    if (!owed) return undefined
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShake(n => n + 1) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [owed])
  useEffect(() => { if (owed) requestAnimationFrame(() => sheet.current?.querySelector('button')?.focus()) }, [owed])
  if (!shown || !owed) return null
  const first = firstName(owed.name)
  return createPortal(
    <div className="tp fx ma-layer va-result" role="presentation">
      <div className="ma-scrim" aria-hidden="true" onClick={() => setShake(n => n + 1)} />
      <section ref={sheet} key={shake} className={`ma-sheet${shake ? ' va-shake' : ''}`} role="dialog" aria-modal="true" aria-label={`How did the call with ${first} go?`}>
        <p className="ma-sheet-t">How did the call with {first} go?</p>
        <p className={`ma-sheet-s${shake ? ' is-need' : ''}`}>{shake ? 'Pick one to close the call.' : 'Pick one to close the call. The agent sees it right away.'}</p>
        {OUTCOMES.map(o => (
          <button key={o.key} type="button" className="ma-pick" data-result={o.key} onClick={() => onPick(o.key)}>
            <span className={`ma-pick-ic is-${o.tone}`} aria-hidden="true">{o.sym}</span>
            <span className="ma-grow"><b>{o.label}</b><small>{o.sub}</small></span>
          </button>
        ))}
      </section>
    </div>,
    document.body,
  )
}
