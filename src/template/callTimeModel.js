import { BOOK_DAYS } from './carriers'
import { zoneAbbr } from '../lib/callSlots'

// P847 — the call-time step's value (CallTime.jsx): { mode: 'none' | 'exact' | 'window', day, time, window }.
// P854: + iso (the instant), tz (the client's zone) and vaId (who the 30-minute rule gave it to); time is the client's.
export const WINDOWS = ['Weekday mornings', 'Weekday afternoons', 'Weekday evenings', 'Any time on weekdays']
export const EMPTY_CALL_TIME = { mode: 'none', day: 5, time: '', window: WINDOWS[0], iso: null, tz: null, vaId: null }

// An exact time is only "set" once an open slot is picked (CallTime drops a stale one); a window or "let the team set
// it" always is.
export function callTimeReady(v) { return v.mode !== 'exact' || (!!v.time && !!v.iso && !!v.tz) }

// One line for summaries and notes.
export function callTimeText(v, va) {
  if (v.mode === 'exact') return `${BOOK_DAYS.find(d => d[1] === v.day)?.[0]}, Nov ${v.day}, ${v.time}${v.tz ? ` ${zoneAbbr(v.tz, v.iso)}` : ''} (client's time)${va ? ` with ${va.name}` : ''}`
  if (v.mode === 'window') return `Best time: ${v.window.toLowerCase()}`
  return 'The team sets the time'
}
