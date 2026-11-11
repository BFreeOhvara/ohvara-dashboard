// P918 — a VA's booked call can be started only at its time. Start call turns on N minutes before the booked time
// (admin Settings → Pay rules, app_settings.va_call_open_minutes, 5 when the column isn't there yet) and stays on
// until the call is done or rebooked. Before that the button shows the time it opens. Incoming calls always ring.
// No React, no network (node tests). The sample mode keeps the admin's number in this browser (shared by the admin
// and VA previews), the real mode reads app_settings.

import { practiceOn } from './practice.js'

export const OPEN_MIN_DEFAULT = 5
const KEY = 'ohvara-va-call-open-min'

// A number of minutes from a setting, or the default when it's missing or out of range (0 to 60).
export function openMinutes(v) {
  if (v === null || v === undefined || v === '') return OPEN_MIN_DEFAULT
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 60 ? Math.round(n) : OPEN_MIN_DEFAULT
}

// Can this booked call be started now? { open, done, at (ms the button turns on), left (minutes to go) }.
// A call with no booked time (not a booking) is always open; a done one never is.
export function callGate({ iso, done = false, nowMs, lead = OPEN_MIN_DEFAULT }) {
  if (done) return { open: false, done: true, at: null, left: 0 }
  // P948: in the practice copy every call can be started (nothing dials), so a walkthrough works at any time of day.
  if (practiceOn()) return { open: true, done: false, at: null, left: 0 }
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return { open: true, done: false, at: null, left: 0 }
  const at = t - openMinutes(lead) * 60e3
  return { open: nowMs >= at, done: false, at, left: Math.max(0, Math.ceil((at - nowMs) / 60e3)) }
}

// The sample store for the admin's number (this browser only).
const subs = new Set()
const read = () => { try { return openMinutes(globalThis.localStorage?.getItem(KEY)) } catch { return OPEN_MIN_DEFAULT } }
let cur = null
export const sampleOpenMin = {
  get: () => (cur == null ? (cur = read()) : cur),
  set: v => { cur = openMinutes(v); try { globalThis.localStorage?.setItem(KEY, String(cur)) } catch { /* private window */ } subs.forEach(f => f()) },
  subscribe: f => { subs.add(f); return () => subs.delete(f) },
}
