import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone, Mic, MicOff, Grid3x3, Volume2, Building2, Check, Pause, Play, NotebookPen, PhoneOff, Plus, ChevronDown, Search, Delete } from 'lucide-react'
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
import { CARRIER_CATALOG, findCarrier, matchCarriers } from '../../../lib/carriers/catalog'
import { CallCtx } from './vaStore'
import { useVaNow } from './useVaNow'
import { OUTCOMES, outcomePlan, carrierLine, draftWords, firstName, callTimer, holdTitle, forLine } from './vaModel'

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
  const [mini, setMini] = useState(false)    // P982: the call screen swiped down to the green pill
  const [phone, setPhone] = useState(false)  // P982: the dialer

  const { nowMs } = useVaNow()
  const gateOf = useCallback(i => callGate({ iso: i?.iso, done: i?.done, nowMs, lead: openMin }), [nowMs, openMin])
  const lineId = call?.lineId || null
  const srv = useCallback((action, extra) => { if (rl && lineId) rl.send(lineId, action, extra).catch(e => note(e.message)) }, [rl, lineId, note])

  const begin = useCallback((who, it) => {
    if (call) { note(call.end ? 'Save how the last call went first' : 'Finish this call first'); return false }
    setItem(it); setBrief(null); setMini(false); setPhone(false)
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

  // P982: the dialer. Someone on file: their booked call when it's open now, else a call to them. A number not on file
  // only runs while calling is off (the screen keeps time and notes); the live line never dials a free number.
  const dial = useCallback(({ digits, client }) => {
    if (client) {
      const booked = schedule.find(i => !i.done && (i.row?.client_id === client.id || i.row?.client?.id === client.id) && gateOf(i).open)
      if (booked) { begin(fromItem(booked), booked); return }
      begin({ key: `p-${client.id}`, kind: 'callin', id: client.id, role: 'client', name: client.name, number: client.client_phone, state: client.state, city: client.city, agentId: client.agent_id, agent: client.agent, carrier: client.carrier_name, reason: 'You called them', clientId: client.id }, null)
      return
    }
    if (rl) { note('The Ohvara line only calls clients and leads on file'); return }
    begin({ key: `d-${digits}`, kind: 'dial', role: 'client', name: fmtPhone(digits), number: fmtPhone(digits), reason: 'Dialed from the keypad' }, null)
  }, [schedule, gateOf, begin, rl, note])

  const value = useMemo(() => ({
    call, act, srv, rl, item, start, takeHold, holdCount, gateOf, nowMs, mini,
    openPhone: () => (call && !call.end ? setMini(false) : setPhone(true)),
    openBrief: it => setBrief(it), needResult: it => { const p = { ref: it.ref, name: it.name, clientId: it.row?.client_id || null, at: Date.now() }; writePending(p); setPending(p) },
  }), [call, srv, rl, item, start, takeHold, holdCount, gateOf, nowMs, mini])

  const holdNow = useTick(holdCount > 0)
  const longest = Math.round((holdNow - heldAt) / 1000) + 100
  return (
    <CallCtx.Provider value={{ ...value, holdLine: holdCount ? holdTitle(holdCount, offer ? 0 : longest) : '' }}>
      {children}
      <BriefSheet it={brief} onClose={() => setBrief(null)} onStart={() => start(brief)} gate={brief ? gateOf(brief) : null} tz={clock.tz} />
      {phone && !call && <PhoneScreen onClose={() => setPhone(false)} onDial={dial} />}
      {call && !call.end && !mini && <CallScreen call={call} act={act} srv={srv} rl={rl} item={item} onMin={() => setMini(true)} />}
      {call && !call.end && mini && <CallPill call={call} onOpen={() => setMini(false)} />}
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

// ── The call screen (P982: iPhone style) ─────────────────────────────────────────────────────────────────────────
// Big name + timer on top, one 3×2 grid of round buttons (Speaker, Mute, Hold / Keypad, Add, Notes), End centred
// below. Keypad swaps the grid for a 3×4 dial pad in the same spot, with "Hide" beside End to bring the buttons back.
// Add (+) opens a small sheet: a carrier (the brief's suggested one first) or another number, rung and merged into a
// 3-way call on the same stack as before. Notes: the system's note for this call on top, the VA's own notes below.
// Swipe down (or the chevron) minimises the screen to a green pill at the top; the call keeps going.
const digitsOf = s => String(s || '').replace(/\D/g, '')
const fmtPhone = s => {
  const d = digitsOf(s).replace(/^1(?=\d{10}$)/, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`
  return s
}
const KEY_LETTERS = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' }
const keyLabel = k => (k === '*' ? 'Star' : k === '#' ? 'Pound' : k)

function useSwipeDown(onDone, on = true) {
  const ref = useRef(null)
  const d = useRef(null)
  const moved = useRef(false)
  const reset = el => { el.style.transition = ''; el.style.transform = '' }
  const handlers = on ? {
    onPointerDown: e => { if (e.target.closest('textarea, input, .ma-sheet')) return; d.current = { y: e.clientY, x: e.clientX, t: Date.now(), dy: 0 }; moved.current = false },
    onPointerMove: e => {
      const g = d.current
      const el = ref.current
      if (!g || !el) return
      g.dy = Math.max(0, e.clientY - g.y)
      if (!moved.current && g.dy > 8 && g.dy > Math.abs(e.clientX - g.x)) moved.current = true
      if (moved.current) { el.style.transition = 'none'; el.style.transform = `translate3d(0, ${g.dy}px, 0)` }
    },
    onPointerUp: () => {
      const g = d.current
      const el = ref.current
      d.current = null
      if (!g || !el || !moved.current) return
      const fast = g.dy / Math.max(1, Date.now() - g.t) > 0.6
      if (g.dy > 120 || (fast && g.dy > 40)) { el.style.transition = 'transform .22s var(--ma-ease)'; el.style.transform = 'translate3d(0, 100%, 0)'; setTimeout(onDone, 200) } else reset(el)
    },
    onPointerCancel: () => { d.current = null; if (ref.current) reset(ref.current) },
    onClickCapture: e => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false } },
  } : {}
  return { ref, handlers }
}

function Pad({ onKey }) {
  return (
    <div className="va-pad" role="group" aria-label="Keypad">
      {PAD.map(k => (
        <button key={k} type="button" className="va-key ma-press" aria-label={keyLabel(k)} onClick={() => onKey(k)}>
          <b>{k}</b>{KEY_LETTERS[k] && <small>{KEY_LETTERS[k]}</small>}
        </button>
      ))}
    </div>
  )
}

function CallScreen({ call, act, srv, rl, item, onMin }) {
  const now = useTick(true)
  const note = useNote()
  const [sheet, setSheet] = useState(null) // 'add' | 'notes'
  const who = call.who
  const carrierName = who.carrier || item?.row?.old_carrier || item?.row?.carrier || item?.row?.client?.carrier_name || ''
  const added = call.parties.find((p, i) => i > 0)
  const merged = added?.state === 'line'
  const ringing = !!added && added.state !== 'line'
  const partyOf = p => (p.role === 'lead' ? 'lead' : p.role === 'client' ? 'client' : p.role)
  const { ref, handlers } = useSwipeDown(onMin, !sheet)

  // Sample: whoever was added picks up after a moment (a real line reports its own legs). Then the 3-way merge.
  const ringingIds = call.parties.filter(p => p.state === 'ringing').map(p => p.id).join('|')
  useEffect(() => {
    if (!ringingIds || call.lineId) return undefined
    const ts = ringingIds.split('|').map((id, i) => setTimeout(() => act({ type: 'answered', id }), 2200 + i * 400))
    return () => ts.forEach(clearTimeout)
  }, [ringingIds, call.lineId, act])
  const waiting = call.parties.some(p => p.state === 'waiting')
  useEffect(() => { if (waiting) { srv('merge'); act({ type: 'merge' }) } }, [waiting, srv, act])

  const addParty = p => {
    setSheet(null)
    if (added) return
    if (p.role === 'carrier') srv('ring_carrier', { carrier_id: p.id })
    else if (p.role === 'agent') srv('ring_agent')
    else if (call.lineId) { note('The Ohvara line only rings numbers on file: a carrier or the agent'); return }
    act({ type: 'add', party: p })
  }
  const heldMs = call.held ? now - (call.heldSince || now) : 0
  const took = callTimer(now - call.start)
  const end = () => { srv('end_all'); rl?.hangUp?.(); act({ type: 'end' }) }
  const btn = (key, label, Icon, on, run, extra = {}) => (
    <button key={key} type="button" className={`va-cb ma-press${on ? ' is-on' : ''}${extra.tone ? ` is-${extra.tone}` : ''}`} aria-pressed={extra.press === false ? undefined : !!on} aria-label={extra.aria || label} onClick={run} disabled={extra.disabled}>
      <span className="va-cb-i"><Icon size={28} strokeWidth={1.9} aria-hidden="true" /></span><small>{label}</small>
    </button>
  )
  const status = call.held ? `On hold · ${callTimer(heldMs)}` : call.muted ? `Muted · ${took}` : took
  const tones = call.pad && call.tones
  return createPortal(
    <div ref={ref} className={`tp fx ma-layer va-call${call.pad ? ' is-pad' : ''}`} role="dialog" aria-modal="true" aria-label={`On a call with ${who.name}`} {...handlers}>
      <div className="va-call-top">
        <button type="button" className="va-call-min ma-press" aria-label="Minimise the call" onClick={onMin}><ChevronDown size={30} strokeWidth={2.2} aria-hidden="true" /></button>
        <small className="va-call-line">{merged ? 'Ohvara line · 3-way call' : 'Ohvara line'}</small>
        <i aria-hidden="true" />
      </div>
      <div className="va-call-who">
        <b className={`va-call-name${tones ? ' is-tones' : ''}`} aria-live={tones ? 'polite' : undefined}>{tones ? call.tones : who.name}</b>
        <span className="va-call-timer" aria-live="off">{tones ? who.name : status}</span>
        {!call.pad && <span className="va-call-what">{forLine(item ? whyShort(item) : who.reason, who.agent)}</span>}
        {merged && <span className="va-call-merged" role="status">3-way · {added.name} joined</span>}
        {ringing && <span className="va-call-merged is-ringing" role="status">Calling {added.name}…</span>}
        {!call.lineId && !call.pad && <p className="va-call-off">Calling is off right now. Dial <b>{who.number || 'them'}</b> from your phone. This keeps the time, the line and your notes.</p>}
      </div>
      <div className="va-call-mid">
        {call.pad
          ? <Pad onKey={k => { act({ type: 'tone', key: k }); srv('dtmf', { digits: k }) }} />
          : (
            <div className="va-call-grid">
              {btn('spk', 'Speaker', Volume2, call.speaker, () => act({ type: 'speaker' }))}
              {btn('mute', 'Mute', call.muted ? MicOff : Mic, call.muted, () => { rl?.mute?.(!call.muted); act({ type: 'mute' }) })}
              {btn('hold', call.held ? 'Resume' : 'Hold', call.held ? Play : Pause, call.held, () => { srv(call.held ? 'resume' : 'hold', { party: partyOf(who) }); act({ type: 'hold' }) })}
              {btn('pad', 'Keypad', Grid3x3, false, () => act({ type: 'pad' }), { press: false })}
              {btn('add', merged ? 'Added' : ringing ? 'Calling…' : 'Add', merged ? Check : Plus, merged, () => setSheet('add'), { press: false, tone: merged ? 'sage' : null, aria: added ? `${added.name} is ${merged ? 'on the call' : 'ringing'}` : 'Add someone to the call', disabled: !!added })}
              {btn('notes', 'Notes', NotebookPen, !!call.notes, () => setSheet('notes'), { press: false })}
            </div>
          )}
      </div>
      <div className="va-call-endrow">
        <span aria-hidden="true" />
        <button type="button" className="va-end ma-press" aria-label="End call" onClick={end}><PhoneOff size={32} aria-hidden="true" /></button>
        {call.pad ? <button type="button" className="va-hide" onClick={() => act({ type: 'pad' })}>Hide</button> : <span aria-hidden="true" />}
      </div>
      <AddSheet open={sheet === 'add'} onClose={() => setSheet(null)} onPick={addParty} suggested={carrierName} agent={who.agent} />
      <NotesSheet open={sheet === 'notes'} onClose={() => setSheet(null)} call={call} act={act} item={item} carrier={carrierName} />
    </div>,
    document.body,
  )
}

// Add (+): a carrier (searchable, each with its service line; the suggested one from the brief first) or another
// number (the agent on file, or one typed in). The real line only rings numbers on file (fulfillment-call has no free
// dialing), so a typed number joins on sample and while calling is off; on a live line it says why not.
function AddSheet({ open, onClose, onPick, suggested, agent }) {
  const [tab, setTab] = useState('carrier')
  const [q, setQ] = useState('')
  const [num, setNum] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const sug = suggested ? findCarrier(suggested) : null
  const list = useMemo(() => {
    const all = q.trim() ? matchCarriers(q, 40).map(h => h.carrier) : CARRIER_CATALOG.slice().sort((a, b) => a.sort_rank - b.sort_rank).slice(0, 40)
    return sug && !q.trim() ? [sug, ...all.filter(c => c.id !== sug.id)] : all
  }, [q, sug])
  const d = digitsOf(num)
  return (
    <BottomSheet open={open} onClose={onClose} label="Add to the call" tall className="va-over">
      <p className="ma-sheet-t">Add to the call</p>
      <div className="va-seg" role="tablist" aria-label="Who to add">
        <button type="button" role="tab" aria-selected={tab === 'carrier'} className={tab === 'carrier' ? 'is-on' : ''} onClick={() => setTab('carrier')}>Carrier</button>
        <button type="button" role="tab" aria-selected={tab === 'number'} className={tab === 'number' ? 'is-on' : ''} onClick={() => setTab('number')}>Another number</button>
      </div>
      {tab === 'carrier' ? <>
        <label className="va-find"><Search size={18} aria-hidden="true" /><input type="search" placeholder="Search carriers" aria-label="Search carriers" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="ma-glass ma-list va-carriers">
          {list.map(c => (
            <button key={c.id} type="button" className={`ma-row${sug && c.id === sug.id ? ' is-sug' : ''}`} onClick={() => onPick({ id: c.id, name: c.name, role: 'carrier', number: c.service_phone })}>
              <span className="ma-sym is-sky" aria-hidden="true"><Building2 size={16} /></span>
              <span className="ma-grow"><b>{c.name}</b><small>{sug && c.id === sug.id ? 'Suggested from the brief · ' : ''}{carrierLine(c.name, today)}{c.service_phone ? ` · ${fmtPhone(c.service_phone)}` : ''}</small></span>
              <Plus size={18} className="ma-chev" aria-hidden="true" />
            </button>
          ))}
          {!list.length && <p className="ma-hint">No carrier by that name.</p>}
        </div>
      </> : <>
        {agent && (
          <div className="ma-glass ma-list">
            <button type="button" className="ma-row" onClick={() => onPick({ id: 'agent', name: agent, role: 'agent' })}>
              <span className="ma-sym is-sage" aria-hidden="true"><Phone size={16} /></span>
              <span className="ma-grow"><b>{agent}</b><small>The agent · their phone on file</small></span>
              <Plus size={18} className="ma-chev" aria-hidden="true" />
            </button>
          </div>
        )}
        <label className="va-num"><span>Phone number</span>
          <input type="tel" inputMode="tel" autoComplete="off" placeholder="(555) 555-0100" value={num} onChange={e => setNum(e.target.value)} />
        </label>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={d.length < 7} onClick={() => onPick({ id: `num-${d}`, name: fmtPhone(d), role: 'other', number: d })}>
          <Phone size={18} aria-hidden="true" />Call and merge
        </button>
      </>}
    </BottomSheet>
  )
}

// Notes: what the system knows about this call (goal, the carrier to add, draft day) on top, the VA's own notes below.
// They travel with the result pick; on a booked call they're also saved to the client when the sheet closes.
function NotesSheet({ open, onClose, call, act, item, carrier }) {
  const actions = useFulActions()
  const row = item?.row || {}
  const c = row.client || {}
  const day = item?.iso ? new Date(item.iso).toISOString().slice(0, 10) : null
  const sysNote = row.brief?.note || ''
  const saved = useRef(call.notes)
  const close = () => {
    const id = item?.ref || item?.id
    if (item?.kind === 'call' && id && call.notes !== saved.current) { actions.saveCallNotes?.(id, call.notes); saved.current = call.notes }
    onClose()
  }
  return (
    <BottomSheet open={open} onClose={close} label="Call notes" className="va-over">
      <p className="ma-sheet-t">Notes</p>
      <div className="va-todo is-butter va-sysnote">
        <b>From Ohvara</b>
        <p>{item ? whyLine(row) : call.who.reason || 'A call with no booking.'}</p>
        <div className="va-facts">
          <span><small>Carrier to add</small><b>{carrier || 'Not given'}</b></span>
          <span><small>Their line</small><b>{carrier ? carrierLine(carrier, day) : 'Not given'}</b></span>
          <span><small>Draft day</small><b>{draftWords(c.draft_day || row.brief?.replaces?.draft_day)}</b></span>
          <span><small>Agent</small><b>{call.who.agent || item?.agent || 'Not given'}</b></span>
        </div>
        {sysNote && <p className="va-sysnote-x">{sysNote}</p>}
      </div>
      <label className="va-mynotes"><span>Your notes · saved to {firstName(call.who.name) || 'the client'}</span>
        <textarea rows={5} value={call.notes} placeholder="What happened on the call" onChange={e => act({ type: 'notes', text: e.target.value })} />
      </label>
      <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" onClick={close}>Done</button>
    </BottomSheet>
  )
}

// The green pill while the call screen is minimised: name + timer, above everything; a tap opens the call again.
function CallPill({ call, onOpen }) {
  const now = useTick(true)
  const t = callTimer(now - call.start)
  return createPortal(
    <button type="button" className="va-pill ma-press" aria-label={`Back to the call with ${call.who.name}, ${t}`} onClick={onOpen}>
      <Phone size={15} aria-hidden="true" /><b>{call.who.name}</b><span>{call.held ? 'On hold' : t}</span>
    </button>,
    document.body,
  )
}

// ── The phone (P982): the dialer a VA opens from Today ───────────────────────────────────────────────────────────
// A keypad with the number on top; as they type, the client on file with that number shows. Calling someone on file
// starts their call (their booked call when it's open now). The live line never dials a free number.
function PhoneScreen({ onClose, onDial }) {
  const { data: clients } = useFulClients()
  const [num, setNum] = useState('')
  const d = digitsOf(num)
  const match = d.length >= 7 ? clients.find(c => { const cd = digitsOf(c.client_phone); return cd && (cd.endsWith(d) || d.endsWith(cd.slice(-10))) }) || null : null
  const { ref, handlers } = useSwipeDown(onClose)
  return createPortal(
    <div ref={ref} className="tp fx ma-layer va-call va-phone" role="dialog" aria-modal="true" aria-label="Phone" {...handlers}>
      <div className="va-call-top">
        <button type="button" className="va-call-min ma-press" aria-label="Close the phone" onClick={onClose}><ChevronDown size={30} strokeWidth={2.2} aria-hidden="true" /></button>
        <small className="va-call-line">Phone · Ohvara line</small>
        <i aria-hidden="true" />
      </div>
      <div className="va-call-who va-phone-num">
        <b className="va-call-name is-tones" aria-live="polite">{d ? fmtPhone(d) : ' '}</b>
        <span className="va-call-timer">{match ? `${match.name} · client${match.agent ? ` of ${match.agent}` : ''}` : d.length >= 7 ? 'Not on file' : 'Type a number'}</span>
      </div>
      <div className="va-call-mid"><Pad onKey={k => setNum(n => (n + k).slice(0, 15))} /></div>
      <div className="va-call-endrow">
        <span aria-hidden="true" />
        <button type="button" className="va-dial ma-press" aria-label={match ? `Call ${match.name}` : 'Call'} disabled={d.length < 3} onClick={() => onDial({ digits: d, client: match })}><Phone size={30} aria-hidden="true" /></button>
        {d ? <button type="button" className="va-hide" aria-label="Delete a digit" onClick={() => setNum(n => digitsOf(n).slice(0, -1))}><Delete size={26} aria-hidden="true" /></button> : <span aria-hidden="true" />}
      </div>
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
