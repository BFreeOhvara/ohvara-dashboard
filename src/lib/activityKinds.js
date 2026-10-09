import { CalendarCheck, PhoneCall, PhoneMissed, CircleCheck, CalendarArrowUp, Undo2, Pencil } from 'lucide-react'

// Prompt 718 — policy_events.kind on the Activity page: filter label, pill
// text, colour tokens and icon. Kinds reuse the status colours (a booking is
// the same blue here as on My Pipeline); Moved has its own violet. Prompt 730:
// Edited (Change a booking fixed a detail) shares Moved's violet.
export const EVENT_KINDS = ['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited']
export const EVENT_KIND = {
  booked:      { label: 'Booked',    pill: 'Booked',      base: '--ov-st-booked',    icon: CalendarCheck },
  in_progress: { label: 'Calls',     pill: 'In progress', base: '--ov-st-needs',     icon: PhoneCall },
  no_answer:   { label: 'No answer', pill: 'No answer',   base: '--ov-st-noanswer',  icon: PhoneMissed },
  cancelled:   { label: 'Cancelled', pill: 'Cancelled',   base: '--ov-st-cancelled', icon: CircleCheck },
  moved:       { label: 'Moved',     pill: 'Moved',       base: '--ov-kind-moved',   icon: CalendarArrowUp },
  edited:      { label: 'Edited',    pill: 'Edited',      base: '--ov-kind-moved',   icon: Pencil },
}
export const kindMeta = kind => EVENT_KIND[kind] || EVENT_KIND.moved

// Prompt 733 — the Activity box and the feed's status pill count each event once, by
// the status it shows. Moved and Edited events have no row or pill of their own: they
// count (and read) as the status the client is in now (My Pipeline's tabOf). No current
// status falls back to Booked, since a call being moved or fixed means it was booked.
export const ACTIVITY_ROWS = ['booked', 'in_progress', 'no_answer', 'cancelled', 'needs']
const ROW_META = {
  booked:      EVENT_KIND.booked,
  in_progress: EVENT_KIND.in_progress,
  no_answer:   EVENT_KIND.no_answer,
  cancelled:   EVENT_KIND.cancelled,
  needs:       { label: 'Needs attention', pill: 'Needs attention', base: '--ov-st-needs' },
}
const TAB_ROW = { booked: 'booked', noAnswer: 'no_answer', needs: 'needs', cancelled: 'cancelled' }
export function activityRow(kind, tab) {
  if (kind === 'moved' || kind === 'edited') return TAB_ROW[tab] || 'booked'
  return kind in ROW_META ? kind : 'booked'
}
export const rowMeta = row => ROW_META[row] || ROW_META.booked
export function rowTone(row) {
  const b = rowMeta(row).base
  return { fg: `var(${b})`, tint: `var(${b}-tint)`, edge: `var(${b}-edge)` }
}

export function kindTone(kind) {
  const b = kindMeta(kind).base
  return { fg: `var(${b})`, tint: `var(${b}-tint)`, edge: `var(${b}-edge)` }
}

// Icons by kind, plus the back arrow for a booking that came back from
// another status. eventIconKey picks one for an event.
export const EVENT_ICON = Object.fromEntries([
  ...EVENT_KINDS.map(k => [k, EVENT_KIND[k].icon]),
  ['rebook', Undo2],
])
export const eventIconKey = e => (e.kind === 'booked' && e.rebook ? 'rebook' : e.kind in EVENT_KIND ? e.kind : 'moved')
