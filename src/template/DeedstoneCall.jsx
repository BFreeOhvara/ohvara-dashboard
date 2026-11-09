import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Phone, PhoneOff, Smartphone } from 'lucide-react'
import { Drawer } from './kit'
import { useDeedstone } from './data'
import { paths } from './paths'
import { telOf } from './phoneMask.js'
import { stepOf, endWords, NOT_ON_YET } from '../lib/deedstoneCall'
import { DeedstoneCallCtx as Ctx, useDeedstoneCall } from './deedstoneCtx'
import './deedstone916.css'

// P916 — Call through Deedstone, for every Call in the agent portal (lead and client pop-ups on desktop, the phone
// build's Call buttons). Tapping Call rings the agent's own connected phone first; they answer and press 1, and the
// client is dialed from the agent's Deedstone number, so the client only ever sees "Deedstone Insurance". One sheet
// shows where the call is. No phone connected → the sheet says so and links to Settings. Before calling goes live
// (voice_live off) the sheet offers the old tap-to-call so agents are never stuck.


const settingsCalls = () => `${paths.settings()}?tab=calls`
// Which of the three steps (your phone, them, talking) a call row is on.
const STEP_AT = { calling_agent: 0, agent_on: 0, calling_client: 1, live: 2 }

export function DeedstoneCallProvider({ children }) {
  const ds = useDeedstone()
  const [cur, setCur] = useState(null)   // { target, id, err, starting, open }
  const row = ds.useCall(cur?.id ?? null)

  const start = useCallback(async target => {
    if (!target) return
    setCur({ target, id: null, err: null, starting: true, open: true })
    try {
      const r = await ds.call(target)
      setCur(c => (c && c.target === target ? { ...c, id: r.call_id, starting: false } : c))
    } catch (e) {
      setCur(c => (c && c.target === target ? { ...c, starting: false, err: { code: e.code || 'error', message: e.message, next_at: e.next_at ?? null } } : c))
    }
  }, [ds])

  const close = useCallback(() => setCur(c => (c ? { ...c, open: false } : c)), [])
  const hangup = async () => {
    if (cur?.id) { try { await ds.hangup(cur.id) } catch { /* the row closes from the phone side too */ } }
  }

  const t = cur?.target
  const ended = row?.status === 'ended'
  let title = ''
  let sub = ''
  let body = null
  let footer = null
  if (cur?.err) {
    const code = cur.err.code
    if (code === 'no_agent_phone') {
      title = 'Connect your phone first'
      sub = `Deedstone calls ring your phone, then dial ${t?.name?.split(' ')[0] || 'them'}.`
      body = <p className="ds-note">They see Deedstone Insurance, never your own number. It takes a minute: we call you with a code.</p>
      footer = <Link to={settingsCalls()} className="tp-primary fx-accent" onClick={close}><Smartphone size={16} aria-hidden="true" />Connect your phone</Link>
    } else if (NOT_ON_YET.includes(code)) {
      title = 'Deedstone calling isn’t on yet'
      sub = 'Until it is, call from your own phone.'
      footer = t?.phone ? <a href={telOf(t.phone)} className="tp-primary fx-accent ds-tel" onClick={close}><Phone size={16} aria-hidden="true" />Call from my phone</a> : null
    } else {
      title = 'Can’t call now'
      sub = cur.err.message?.replace(/^Can't call now: /, '') || 'Try again in a moment.'
      if (cur.err.next_at) body = <p className="ds-note">It can go after <b>{new Date(cur.err.next_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</b> your time.</p>
    }
  } else if (cur) {
    const st = cur.starting || !row ? stepOf('calling_agent', t?.name) : ended ? { title: 'Call ended', sub: endWords(row.end_reason, t?.name) } : stepOf(row.status, t?.name)
    title = st.title
    sub = st.sub
    body = (
      <ol className="ds-steps" aria-label="Call progress">
        {['Your phone', t?.name?.split(' ')[0] || 'Them', 'Talking'].map((label, i) => {
          const at = ended ? 3 : STEP_AT[row?.status] ?? 0
          return <li key={label} className={i < at ? 'is-done' : i === at ? 'is-now' : ''}><i aria-hidden="true">{i + 1}</i>{label}</li>
        })}
      </ol>
    )
    footer = ended || cur.starting
      ? <button type="button" className="tp-btn ov-ghost" onClick={close}>Done</button>
      : <button type="button" className="tp-btn ds-hang" onClick={hangup}><PhoneOff size={16} aria-hidden="true" />Hang up</button>
  }

  return (
    <Ctx.Provider value={start}>
      {children}
      <Drawer open={!!cur?.open} onClose={close} center title={title} sub={sub} footer={footer}>
        {body}
        {!cur?.err && <p className="ds-brand"><Phone size={13} aria-hidden="true" />They see <b>Deedstone Insurance</b></p>}
      </Drawer>
    </Ctx.Provider>
  )
}

// A Call button that goes through Deedstone (falls back to tap-to-call outside the agent shell).
export function DeedstoneCallButton({ target, className, children, label, onCall, stop = false }) {
  const start = useDeedstoneCall()
  if (!target?.phone) return null
  if (!start) {
    return <a href={telOf(target.phone)} className={className} aria-label={label} onClick={e => { if (stop) e.stopPropagation(); onCall?.() }}>{children}</a>
  }
  return (
    <button type="button" className={className} aria-label={label} onClick={e => { if (stop) e.stopPropagation(); onCall?.(); start(target) }}>
      {children}
    </button>
  )
}
