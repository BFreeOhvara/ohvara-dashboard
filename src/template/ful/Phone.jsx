import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Phone as PhoneIc, PhoneOff, Mic, MicOff, Pause, Play, Grid3x3, Delete, History, X, CircleCheck, PhoneMissed, ChevronLeft, Search } from 'lucide-react'
import { useFulCalls, useFulClients, useFulActions } from './data'
import { Avatar, Field, PillTabs, useNote } from '../kit'
import { useExit } from '../motion'
import { useClientZone } from '../useClientZone'
import { clockOf, zoneAbbr } from '../../lib/callSlots'
import { clock } from '../../lib/portalPhone'
import { PAD } from '../../components/fulfillment/phoneIcons'
import LiveCall, { SERVICE_LINE } from './LiveCall'
import { CALL_WORD } from './words'
import { fp } from './paths'
import { HelpDot } from '../../fulshell/training/HelpDot'

// P872 — docked at the bottom right like a chat widget (a bottom sheet on a phone), not beside the rail. The X hides
// the panel to a round phone button (badged for a ring or missed calls); during a call it only minimises to a pill with
// the caller and the timer, and never hangs up (that stays the red button). It does not block the page: no scrim.
// The frame owns open / ringing / missed (./phoneDock); this file owns the call.
// P857 — the VA's in-app phone, back from the old portal (PortalPhone + MyCalls + CallDrawer, before P845) in the
// shell's glass style. One panel beside the rail (a bottom sheet on a phone): dial pad and client search, recent
// calls with their outcomes, the in-call screen (mute, hold, keypad, hang up, a timer, the client's name and their
// local time), then the same result + notes step as Start call. A live call rings in this same panel.
// Calling stays OFF (recovery_config.voice_live): the call screen keeps the time and the notes while the VA dials
// from a phone, and says so. Sample info only; nothing leaves the browser. Same timer format (lib/portalPhone clock)
// and keypad (phoneIcons PAD) as the old phone.
const CALLING_ON = false

const digits = s => String(s || '').replace(/\D/g, '')
const pretty = s => {
  const d = digits(s).replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s
}
const OPEN = ['booked', 'no_answer']

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
  if (!who) return ''
  if (!tz) return who.state ? 'Their time: not known yet' : 'Their time: unknown number'
  const iso = new Date(now).toISOString()
  return `${clockOf(iso, tz)} ${zoneAbbr(tz, iso)}, their time${who.city ? ` (${who.city}, ${who.state})` : ''}`
}

const fromCall = k => ({
  key: `k-${k.id}`, name: k.name, number: k.client.client_phone, state: k.client.state, city: k.client.city, tz: k.tz || null,
  sub: `${k.agent}'s client · closing ${k.old_carrier}`, callId: OPEN.includes(k.status) ? k.id : null, carrier: k.old_carrier, notes: k.notes || '',
})

export default function FulPhone({ open, onOpen, onClose, ringId, onAnswer, onDecline, onLine, missed = [], badge = null, live, onLive, startReq }) {
  const { data: calls } = useFulCalls()
  const { data: clients } = useFulClients()
  const { markCall, hideLive } = useFulActions()
  const note = useNote()
  const navigate = useNavigate()
  const [tab, setTab] = useState('pad')
  const [entry, setEntry] = useState('')
  const [who, setWho] = useState(null)       // the person picked, before the call
  const [call, setCall] = useState(null)     // { who, start, muted, held, pad, tones, end }
  const [log, setLog] = useState([])         // calls dialed by number this visit (no call record of their own)
  const [shown, leaving] = useExit(open, 200)
  const box = useRef(null)
  const dockBtn = useRef(null)
  const now = useNow(call && !call.end ? 1000 : 60000)

  const targetOf = c => {
    const k = calls.find(x => x.client_id === c.id && OPEN.includes(x.status))
    return k ? fromCall(k) : { key: `c-${c.id}`, name: c.name, number: c.client_phone, state: c.state, city: c.city, sub: `${c.agent}'s client · ${c.carrier_name}`, callId: null }
  }
  const ring = ringId && !call ? calls.find(x => x.id === ringId) : null
  const subject = call?.who || (ring ? fromCall(ring) : who)
  const theirTime = useTheirTime(subject)

  // Start call on a call's drawer sets the store's live id: the frame opens this panel on that person (startReq).
  useEffect(() => { if (live) { onLive(live); hideLive() } }, [live, onLive, hideLive])
  const [seenReq, setSeenReq] = useState(null)
  if (startReq && startReq !== seenReq) {
    setSeenReq(startReq)
    const k = calls.find(x => x.id === startReq.id)
    if (k && !call) { setWho(fromCall(k)); setEntry('') }
  }

  const view = ring ? 'ring' : call ? (call.end ? 'result' : 'call') : who ? 'ready' : `pad-${tab}`
  const lineState = view === 'call' ? 'live' : view === 'result' ? 'after' : null
  useEffect(() => { onLine?.(lineState) }, [lineState, onLine])

  // Hide the panel and hand focus to the round button / pill, so the keyboard does not get lost. Never hangs up.
  const hide = () => { onClose(); requestAnimationFrame(() => dockBtn.current?.focus()) }
  // Esc minimises only while you are in the phone: it is not modal, so Esc elsewhere belongs to the page.
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape' && box.current?.contains(document.activeElement)) { e.stopPropagation(); onClose(); requestAnimationFrame(() => dockBtn.current?.focus()) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
  // Focus the first thing to do in each view (Answer, Hang up, the search box...).
  useEffect(() => {
    if (!open) return undefined
    const t = requestAnimationFrame(() => box.current?.querySelector('[data-first]')?.focus())
    return () => cancelAnimationFrame(t)
  }, [open, view])

  const q = entry.trim().toLowerCase()
  const isNumber = q && !/[a-z]/.test(q)
  const matches = useMemo(() => {
    if (!q) return []
    const d = digits(q)
    return clients.filter(c => (isNumber ? d.length >= 3 && digits(c.client_phone).includes(d) : `${c.name} ${c.agent}`.toLowerCase().includes(q))).slice(0, 5)
  }, [q, isNumber, clients])
  const recent = useMemo(() => [
    ...log,
    ...missed.map(m => calls.find(k => k.id === m.id)).filter(Boolean).map((k, i) => ({ id: `m-${k.id}-${i}`, name: k.name, number: k.client.client_phone, outcome: 'Missed', tone: 'no_answer', when: 'Today, just now', k })),
    ...calls.filter(k => !OPEN.includes(k.status) || k.status === 'no_answer').sort((a, b) => b.day - a.day).map(k => ({ id: k.id, name: k.name, number: k.client.client_phone, outcome: CALL_WORD[k.status], tone: k.status, when: k.day === 5 ? `Today, ${k.time}` : `Nov ${k.day}, ${k.time}`, k })),
  ], [log, calls, missed])

  const press = key => setEntry(e => (/[a-z]/i.test(e) ? key : e + key))
  const dialTarget = () => {
    const c = matches.length === 1 || (isNumber && digits(q).length >= 10) ? clients.find(x => digits(x.client_phone) === digits(q).replace(/^1(?=\d{10}$)/, '')) : null
    return c ? targetOf(c) : { key: `n-${digits(q)}`, name: pretty(q), number: pretty(q), sub: 'A number you typed', callId: null }
  }
  const canDial = isNumber && digits(q).length >= 10
  const start = target => { setCall({ who: target, start: Date.now(), muted: false, held: false, pad: false, tones: '', end: null }); setWho(null); setEntry('') }
  const answer = () => { const t = fromCall(ring); onAnswer(); start(t) }
  const later = () => onDecline()
  const openCall = () => { const id = ring.id; onAnswer(); onClose(); navigate(fp('schedule', id)) }
  const hangUp = () => setCall(c => ({ ...c, end: Date.now() }))
  const finish = () => { setCall(null); setTab('recent') }
  const took = call ? clock(((call.end || now) - call.start) / 1000) : ''

  let body
  if (ring) {
    body = <LiveCall k={ring} theirTime={theirTime} onAnswer={answer} onLater={later} onOpen={openCall} />
  } else if (call && !call.end) {
    const p = call.who
    const set = patch => setCall(c => ({ ...c, ...patch }))
    body = (
      <div className="fs-ph-call">
        <div className="fs-ph-who"><Avatar name={p.name} tone="blue" /><span className="tp-grow"><b>{p.name}</b><small>{p.sub}</small><small className="fs-ph-tz">{theirTime}</small></span></div>
        <p className={`fs-ph-timer tp-num${call.held ? ' is-held' : ''}`} aria-live="off"><span>{call.held ? 'On hold' : call.muted ? 'Muted' : 'On the call'}</span>{took}</p>
        {!CALLING_ON && <p className="fx-calm fs-off"><PhoneOff size={16} aria-hidden="true" /><span>Calling is off right now. Dial <b className="tp-num">{p.number}</b>{p.carrier ? <> (or {p.carrier}: <b className="tp-num">{SERVICE_LINE}</b>)</> : null} from your phone. This keeps the time and your notes.</span></p>}
        {call.pad && <div className="fs-ph-tones tp-num" aria-label="Keys pressed">{call.tones || ' '}</div>}
        {call.pad && <div className="fs-pad is-small">{PAD.map(d => <button key={d} type="button" className="fs-key" onClick={() => set({ tones: call.tones + d })}>{d}</button>)}</div>}
        <div className="fs-ph-ctl">
          <button type="button" className="fs-ctl" data-first aria-pressed={call.muted} onClick={() => set({ muted: !call.muted })}>{call.muted ? <MicOff size={20} /> : <Mic size={20} />}<span>{call.muted ? 'Unmute' : 'Mute'}</span></button>
          <button type="button" className="fs-ctl" aria-pressed={call.held} onClick={() => set({ held: !call.held })}>{call.held ? <Play size={20} /> : <Pause size={20} />}<span>{call.held ? 'Resume' : 'Hold'}</span></button>
          <button type="button" className="fs-ctl" aria-pressed={call.pad} onClick={() => set({ pad: !call.pad })}><Grid3x3 size={20} /><span>Keypad</span></button>
          <button type="button" className="fs-ctl is-end" onClick={hangUp}><PhoneOff size={20} /><span>Hang up</span></button>
        </div>
      </div>
    )
  } else if (call) {
    body = <Result call={call} took={took} onDone={finish} save={(r) => {
      const p = call.who
      if (p.callId) {
        if (r.pick === 'cancelled') { markCall(p.callId, 'cancelled', { confirmation: r.conf.trim().toUpperCase(), notes: r.notes }); note('Cancelled. It shows on Pay as checking') }
        else { markCall(p.callId, 'no_answer', { notes: r.notes || 'No answer.' }); note(`No answer logged for ${p.name.split(' ')[0]}`) }
      } else {
        setLog(l => [{ id: `d-${Date.now()}`, name: p.name, number: p.number, outcome: r.pick, tone: r.pick === 'Reached them' ? 'cancelled' : 'no_answer', when: `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`, target: p }, ...l])
        note(`Call with ${p.name} logged`)
      }
      finish()
    }} />
  } else if (who) {
    body = (
      <div className="fs-ph-call">
        <button type="button" className="fs-ph-back" onClick={() => setWho(null)}><ChevronLeft size={16} />Dial pad</button>
        <div className="fs-ph-who"><Avatar name={who.name} tone="blue" /><span className="tp-grow"><b>{who.name}</b><small>{who.sub}</small><small className="fs-ph-tz">{theirTime}</small></span></div>
        <dl className="fx-facts"><div><dt>Phone</dt><dd className="tp-num">{who.number}</dd></div>{who.carrier && <div><dt>{who.carrier} service line</dt><dd className="tp-num">{SERVICE_LINE}</dd></div>}</dl>
        <button type="button" className="tp-primary fx-accent fs-ph-dial" data-first onClick={() => start(who)}><PhoneIc size={17} />Call {who.name.split(' ')[0]}</button>
        {!CALLING_ON && <p className="tp-sub fs-ph-offline">Calling is off right now. The call screen keeps the time and your notes.</p>}
      </div>
    )
  } else {
    body = (
      <>
        <div className="fs-ph-tabs" role="tablist" aria-label="Phone">
          {[['pad', 'Keypad', Grid3x3], ['recent', 'Recent', History]].map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`fs-ph-tab${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)}><I size={15} aria-hidden="true" />{l}</button>)}
        </div>
        {tab === 'pad' ? (
          <div className="fs-ph-pad">
            <label className="fs-ph-entry"><Search size={16} aria-hidden="true" />
              <input data-first className="tp-num" value={entry} onChange={e => setEntry(e.target.value)} placeholder="Name or number" aria-label="Search a client by name or number"
                onKeyDown={e => { if (e.key === 'Enter' && canDial) start(dialTarget()) }} />
              {entry && <button type="button" className="fs-ph-del" aria-label="Delete a digit" onClick={() => setEntry(e => e.slice(0, -1))}><Delete size={17} /></button>}
            </label>
            {matches.length > 0 && (
              <ul className="tp-list fs-ph-res" aria-label="Matching clients">
                {matches.map(c => <li key={c.id}><button type="button" className="fx-mrow" onClick={() => { setWho(targetOf(c)); setEntry('') }}><Avatar name={c.name} /><span className="tp-grow"><b>{c.name}</b><small className="tp-num">{c.client_phone} · {c.agent}'s client</small></span></button></li>)}
              </ul>
            )}
            {(isNumber || !q) && <div className="fs-pad">{PAD.map(d => <button key={d} type="button" className="fs-key" onClick={() => press(d)}>{d}</button>)}</div>}
            {q && !isNumber && !matches.length && <p className="fx-calm">No client by that name.</p>}
            <button type="button" className="tp-primary fx-accent fs-ph-dial" disabled={!canDial} onClick={() => start(dialTarget())}><PhoneIc size={17} />Call</button>
          </div>
        ) : (
          <ul className="tp-list fs-ph-recent" aria-label="Recent calls">
            {recent.map(r => (
              <li key={r.id}>
                <button type="button" className="fx-mrow" onClick={() => { setWho(r.k ? fromCall(r.k) : r.target); setTab('pad') }}>
                  <Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small className="tp-num">{r.when} · {r.number}</small></span>
                  <span className={`fs-st is-${r.tone}`}>{r.tone === 'no_answer' ? <PhoneMissed size={12} aria-hidden="true" /> : null}{r.outcome}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  const onCall = !!(call && !call.end)
  const status = ring ? 'A call is coming in' : onCall ? `On a call · ${took}` : call ? 'How did it go?' : CALLING_ON ? 'Ready' : 'Calling is off right now'
  const lesson = ring ? 'answer' : call ? 'logging' : 'dialer'

  // Closed: the pill while a call is on (or its result is not saved yet), else the round button with its badge.
  const dock = open ? null : call ? (
    <button ref={dockBtn} type="button" className={`fs-dock fs-dock-pill${onCall ? ' is-live' : ''}`} onClick={onOpen}
      aria-label={onCall ? `Back to the call with ${call.who.name}, ${took}` : `Save the result of the call with ${call.who.name}`}>
      <span className="fs-dock-dot" aria-hidden="true"><PhoneIc size={14} /></span>
      <span className="fs-dock-t"><b>{call.who.name}</b><small className="tp-num">{onCall ? (call.held ? `On hold · ${took}` : took) : 'Call ended · save the result'}</small></span>
    </button>
  ) : (
    <button ref={dockBtn} type="button" className={`fs-dock fs-dock-btn${badge ? ` is-${badge.kind}` : ''}`} onClick={onOpen}
      aria-label={badge ? `Phone, ${badge.label}` : 'Phone'} title="Phone">
      <PhoneIc size={20} aria-hidden="true" />
      {badge && <span className="fx-badge" aria-hidden="true">{badge.n}</span>}
    </button>
  )

  // Portaled to <body> like the old PortalPhone and the record drawers. No scrim: the page stays usable around it.
  return createPortal(
    <div className={`tp fx-layer fs-dock-layer${leaving ? ' is-leaving' : ''}`}>
      {shown && (
        <section ref={box} className="fx-menu fs-phone" role="dialog" aria-label="Phone">
          <header className="fs-ph-h">
            <span className={`fs-ph-ic${ring || onCall ? ' is-live' : ''}`} aria-hidden="true"><PhoneIc size={16} /></span>
            <span className="tp-grow"><b>Phone</b><small>{status}</small></span>
            <HelpDot lesson={lesson} />
            <button type="button" className="fx-x" aria-label={call ? 'Minimise the phone. The call keeps going' : 'Close the phone'} title={call ? 'Minimise (does not hang up)' : 'Close'} onClick={hide}>
              <X size={16} />
            </button>
          </header>
          <div className="fs-ph-b">{body}</div>
        </section>
      )}
      {dock}
    </div>,
    document.body,
  )
}

// After the call: the same result and notes step as Start call (a cancellation call: Cancelled with the carrier's
// confirmation number, or No answer). A number typed in has no call record, so it keeps a simple outcome.
const FREE = ['Reached them', 'No answer', 'Left a voicemail']
function Result({ call, took, save, onDone }) {
  const p = call.who
  const [pick, setPick] = useState(p.callId ? 'cancelled' : FREE[0])
  const [conf, setConf] = useState('')
  const [notes, setNotes] = useState(p.notes || '')
  const ready = !p.callId || pick !== 'cancelled' || conf.trim().length >= 4
  const opts = p.callId ? [['cancelled', 'Cancelled'], ['no_answer', 'No answer']] : FREE.map(f => [f, f])
  return (
    <div className="fs-ph-call">
      <div className="fs-ph-who"><Avatar name={p.name} /><span className="tp-grow"><b>{p.name}</b><small>Call ended · {took}</small></span></div>
      <div className="tp-field"><span>How did it go?</span>
        <PillTabs role="radiogroup" label="How did it go?" className="fx-chips" itemClass="fx-chip" value={pick} onChange={setPick} items={opts.map(([v, l]) => ({ key: v, label: <b>{l}</b> }))} />
      </div>
      {p.callId && pick === 'cancelled' && <Field label="Confirmation number" hint="From the carrier, on the call"><input data-first value={conf} placeholder="e.g. GL-301977" onChange={e => setConf(e.target.value)} /></Field>}
      <Field label="Notes" hint={p.callId ? 'The agent sees these' : undefined}><textarea className="tp-input fx-ta" rows={3} placeholder="What happened on the call" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      <div className="fs-ph-acts">
        <button type="button" className="tp-primary fx-accent" data-first disabled={!ready} onClick={() => save({ pick, conf, notes })}><CircleCheck size={16} />Save result</button>
        <button type="button" className="tp-btn ov-ghost" onClick={onDone}>Skip</button>
      </div>
    </div>
  )
}
