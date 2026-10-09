import { CalendarCheck, PhoneCall, PhoneMissed, CircleCheck, CalendarArrowUp, Undo2 } from 'lucide-react'

// Prompt 718 — policy_events.kind on the Activity page: filter label, pill
// text, colour tokens and icon. Kinds reuse the status colours (a booking is
// the same blue here as on My Pipeline); Moved has its own violet.
export const EVENT_KINDS = ['booked', 'in_progress', 'no_answer', 'cancelled', 'moved']
export const EVENT_KIND = {
  booked:      { label: 'Booked',    pill: 'Booked',      base: '--ov-st-booked',    icon: CalendarCheck },
  in_progress: { label: 'Calls',     pill: 'In progress', base: '--ov-st-needs',     icon: PhoneCall },
  no_answer:   { label: 'No answer', pill: 'No answer',   base: '--ov-st-noanswer',  icon: PhoneMissed },
  cancelled:   { label: 'Cancelled', pill: 'Cancelled',   base: '--ov-st-cancelled', icon: CircleCheck },
  moved:       { label: 'Moved',     pill: 'Moved',       base: '--ov-kind-moved',   icon: CalendarArrowUp },
}
export const kindMeta = kind => EVENT_KIND[kind] || EVENT_KIND.moved

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
