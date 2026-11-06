import { BOOK_DAYS } from './carriers'

// P847 — the call-time step's value (CallTime.jsx): { mode: 'none' | 'exact' | 'window', day, time, window }.
export const WINDOWS = ['Weekday mornings', 'Weekday afternoons', 'Weekday evenings', 'Any time on weekdays']
export const EMPTY_CALL_TIME = { mode: 'none', day: 5, time: '', window: WINDOWS[0] }

// An exact time is only "set" once one of the day's open slots is picked; a window or "let the team set it" always is.
export function callTimeReady(v, slots) { return v.mode !== 'exact' || (!!v.time && slots.includes(v.time)) }

// One line for summaries and notes.
export function callTimeText(v, va) {
  if (v.mode === 'exact') return `${BOOK_DAYS.find(d => d[1] === v.day)?.[0]}, Nov ${v.day}, ${v.time}${va ? ` with ${va.name}` : ''}`
  if (v.mode === 'window') return `Best time: ${v.window.toLowerCase()}`
  return 'The team sets the time'
}
