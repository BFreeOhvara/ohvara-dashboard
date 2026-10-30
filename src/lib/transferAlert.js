// The in-portal live-transfer alert (Agent Portal Rework step 4; phone push waits for FCM).
// help-transfer dials the agent's phone and marks help_calls 'transferring'; this rings the
// portal at the same time. Pure logic, no React: components/agent/TransferAlert wires it up.
import { isDutyMissing } from './duty.js'

export const POLL_MS = 4000
export const RING_MS = 45000

// The caller's own transfer (migration 182_my_incoming_transfer): one row or null, and
// { missing: true } while the function isn't in the database yet.
export async function myIncomingTransfer(db) {
  const { data, error } = await db.rpc('my_incoming_transfer')
  if (error) {
    if (isDutyMissing(error)) return { missing: true }
    throw error
  }
  return (Array.isArray(data) ? data[0] : data) || null
}

// The alert's line. caller_label is a first name or 'New caller', never a number.
export const alertText = row => `Live call for you: ${row?.caller_label || 'New caller'}. We're calling your phone now. Pick up.`

// Polls fetchRow every `every` ms, only while active and while the tab is visible. A row
// shows the alert and starts ring() (which returns a stop function); the ring stops when the
// row is gone, on dismiss, when the agent goes inactive, or after `ringFor` ms. A missing
// function stops polling for good, silently. onChange(row | null) drives the view.
export function transferWatch({ fetchRow, ring, onChange, doc, timers = globalThis, every = POLL_MS, ringFor = RING_MS }) {
  let active = false
  let missing = false
  let poll = null
  let shown = null
  let dismissed = null
  let stopRing = null
  let ringCap = null
  let busy = false

  const visible = () => !doc || doc.visibilityState !== 'hidden'

  function silence() {
    if (ringCap) { timers.clearTimeout(ringCap); ringCap = null }
    if (stopRing) { const s = stopRing; stopRing = null; try { s() } catch { /* already stopped */ } }
  }
  // The same call on the next poll changes nothing (and doesn't ring again after the cap).
  function show(row) {
    if ((row?.help_call_id ?? null) === (shown?.help_call_id ?? null)) return
    shown = row
    onChange?.(row)
    silence()
    if (!row) return
    try { stopRing = ring?.() || null } catch { stopRing = null }
    ringCap = timers.setTimeout(() => { ringCap = null; silence() }, ringFor)
  }

  async function tick() {
    if (!active || missing || busy || !visible()) return
    busy = true
    try {
      const got = await fetchRow()
      if (!active) return
      if (got?.missing) { missing = true; halt(); return }
      show(got && got.help_call_id !== dismissed ? got : null)
    } catch {
      // A failed poll keeps what is showing; the next one decides.
    } finally {
      busy = false
    }
  }
  function halt() {
    if (poll) { timers.clearInterval(poll); poll = null }
  }
  function start() {
    if (poll || !active || missing || !visible()) return
    poll = timers.setInterval(tick, every)
    tick()
  }
  function onVisibility() {
    if (visible()) start()
    else halt()
  }
  doc?.addEventListener?.('visibilitychange', onVisibility)

  return {
    setActive(on) {
      if (on === active) return
      active = on
      if (on) start()
      else { halt(); if (shown) show(null) }
    },
    dismiss() {
      if (!shown) return
      dismissed = shown.help_call_id
      show(null)
    },
    stop() {
      active = false
      halt()
      silence()
      doc?.removeEventListener?.('visibilitychange', onVisibility)
    },
  }
}

// A phone-style ring with Web Audio: two tones (440 + 480 Hz), 2s on, 4s off. Returns a stop
// function. If audio is blocked (no tap yet, autoplay policy) it stays silent; the alert
// still shows.
let shared = null
export function audioContext() {
  if (typeof window === 'undefined') return null
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  try { shared = shared || new Ctx() } catch { return null }
  if (shared.state === 'suspended') shared.resume().catch(() => {})
  return shared
}

export function playRing() {
  const ctx = audioContext()
  if (!ctx) return () => {}
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(ctx.destination)
  const tones = [440, 480].map(f => {
    const o = ctx.createOscillator()
    o.frequency.value = f
    o.connect(out)
    o.start()
    return o
  })
  const burst = () => {
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(0, t)
    out.gain.linearRampToValueAtTime(0.12, t + 0.05)
    out.gain.setValueAtTime(0.12, t + 1.95)
    out.gain.linearRampToValueAtTime(0, t + 2)
  }
  burst()
  const loop = setInterval(burst, 6000)
  return () => {
    clearInterval(loop)
    try {
      out.gain.cancelScheduledValues(ctx.currentTime)
      out.gain.setValueAtTime(0, ctx.currentTime)
      tones.forEach(o => o.stop())
      out.disconnect()
    } catch { /* already stopped */ }
  }
}
