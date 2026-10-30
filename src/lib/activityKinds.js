import {
  CalendarCheck, PhoneCall, PhoneMissed, PhoneOutgoing, PhoneForwarded, CircleCheck, CalendarArrowUp, CalendarX, Undo2, Pencil,
  UserPlus, UserCheck, Send, MessageCircleReply, ClipboardCheck, ShieldCheck, ArrowRightLeft, ReceiptText, TrendingUp, CirclePause,
} from 'lucide-react'

// Prompt 718 — the Activity page's kinds: label, pill text, colour tokens and icon.
// Prompt 730: Edited shares Moved's violet. The type filter (every kind
// agent_activity_feed() returns, migration 185) follows the approved Activity mockup:
// "No-show" for no_answer, "Leads" not Inbounds, In progress moves from amber to the
// Calls colour, and amber stays on No-show, the one row that needs the agent.
// `base` is the colour token family (base, base-tint, base-edge); billing rows are
// neutral, so they name their tint and edge.
export const EVENT_KINDS = [
  'inbound', 'text_auto', 'text_reply', 'va_call', 'in_progress', 'transferred', 'booked', 'moved', 'no_answer', 'edited', 'reassigned',
  'outcome', 'sold', 'servicing', 'cancelled',
  'billing_subscription', 'billing_spend_change', 'billing_spend_pause',
]
const NEUTRAL = { base: '--ov-mid', tint: '--ov-neutral-tint', edge: '--ov-neutral-edge' }
export const EVENT_KIND = {
  booked:      { label: 'Booked',            pill: 'Booked',      base: '--ov-st-booked',    icon: CalendarCheck },
  in_progress: { label: 'In progress',       pill: 'In progress', base: '--ov-kind-call',    icon: PhoneCall },
  no_answer:   { label: 'No-show',           pill: 'No-show',     base: '--ov-st-needs',     icon: CalendarX },
  cancelled:   { label: 'Cancelled',         pill: 'Cancelled',   base: '--ov-st-cancelled', icon: CircleCheck },
  moved:       { label: 'Moved',             pill: 'Moved',       base: '--ov-kind-moved',   icon: CalendarArrowUp },
  edited:      { label: 'Edited',            pill: 'Edited',      base: '--ov-kind-moved',   icon: Pencil },
  reassigned:  { label: 'Reassigned',        pill: 'Reassigned',  base: '--ov-kind-moved',   icon: ArrowRightLeft },
  inbound:     { label: 'Lead came in',      pill: 'New lead',    base: '--ov-kind-lead',    icon: UserPlus },
  text_auto:   { label: 'Text sent (auto)',  pill: 'Auto text',   base: '--ov-kind-text',    icon: Send },
  text_reply:  { label: 'Text reply',        pill: 'Text reply',  base: '--ov-kind-text',    icon: MessageCircleReply },
  va_call:     { label: 'VA call, reached',  pill: 'VA reached',  base: '--ov-kind-call',    icon: PhoneOutgoing },
  transferred: { label: 'Transferred',       pill: 'Transferred', base: '--ov-kind-call',    icon: PhoneForwarded },
  outcome:     { label: 'Outcome marked',    pill: 'Outcome',     base: '--ov-st-noanswer',  icon: ClipboardCheck },
  sold:        { label: 'Sold, now a client', pill: 'Sold',       base: '--ov-kind-client',  icon: UserCheck },
  servicing:   { label: 'Servicing task',    pill: 'Servicing',   base: '--ov-kind-client',  icon: ShieldCheck },
  billing_subscription: { label: 'Weekly charge',             pill: 'Billing', ...NEUTRAL, icon: ReceiptText },
  billing_spend_change: { label: 'Weekly lead spend changed', pill: 'Billing', ...NEUTRAL, icon: TrendingUp },
  billing_spend_pause:  { label: 'Lead spend paused',         pill: 'Billing', ...NEUTRAL, icon: CirclePause },
}
// A VA call that did not reach the client reads as its own row (grey, missed-call icon).
const VA_MISSED = { label: 'VA call, not reached', pill: 'Not reached', base: '--ov-st-noanswer', icon: PhoneMissed }

// An unknown kind falls back to Moved's look (the old behaviour).
const toneOf = m => ({ fg: `var(${m.base})`, tint: `var(${m.tint || `${m.base}-tint`})`, edge: `var(${m.edge || `${m.base}-edge`})` })
export const kindMeta = kind => EVENT_KIND[kind] || EVENT_KIND.moved
// What a feed item shows: kindMeta, except a VA call with reason not_reached.
export const itemMeta = item => (item.kind === 'va_call' && item.reason === 'not_reached' ? VA_MISSED : kindMeta(item.kind))
export const itemTone = item => toneOf(itemMeta(item))

// Prompt 733 — the status model behind the Activity box's old rows: each event counts
// once, by the status it shows. Moved, Edited and Reassigned events count as the status
// the client is in now (My Pipeline's tabOf); no current status falls back to Booked,
// since a call being moved or fixed means it was booked. The page's box now counts by
// filter group (groupCounts below); this model stays for anything that reads a status.
export const ACTIVITY_ROWS = ['booked', 'in_progress', 'no_answer', 'cancelled', 'needs', 'inbound']
const ROW_META = {
  booked:      EVENT_KIND.booked,
  in_progress: { label: 'Calls', pill: 'In progress', base: '--ov-st-needs', icon: PhoneCall },
  no_answer:   { label: 'No answer', pill: 'No answer', base: '--ov-st-noanswer', icon: PhoneMissed },
  cancelled:   EVENT_KIND.cancelled,
  needs:       { label: 'Needs attention', pill: 'Needs attention', base: '--ov-st-needs' },
  inbound:     { label: 'Inbounds', pill: 'Inbound', base: '--ov-kind-moved' },
}
const TAB_ROW = { booked: 'booked', noAnswer: 'no_answer', needs: 'needs', cancelled: 'cancelled' }
// Prompt 760: Reassigned (admin gave the call to another Fulfillment person) counts the same way.
export function activityRow(kind, tab) {
  if (kind === 'moved' || kind === 'edited' || kind === 'reassigned') return TAB_ROW[tab] || 'booked'
  return kind in ROW_META ? kind : 'booked'
}
export const rowMeta = row => ROW_META[row] || ROW_META.booked
export function rowTone(row) {
  return toneOf(rowMeta(row))
}

export const kindTone = kind => toneOf(kindMeta(kind))

// Icons by kind, plus the back arrow for a booking that came back from
// another status. eventIconKey picks one for an event.
export const EVENT_ICON = Object.fromEntries([
  ...EVENT_KINDS.map(k => [k, EVENT_KIND[k].icon]),
  ['rebook', Undo2],
])
export const eventIconKey = e => (e.kind === 'booked' && e.rebook ? 'rebook' : e.kind in EVENT_KIND ? e.kind : 'moved')

// ── Type filter (the Activity page's chips) ─────────────────────────────────
// Each kind belongs to exactly one group. A chip shows only when one of its kinds
// can happen today (PENDING_KINDS have no source yet), so Billing stays hidden
// until billing events are written. Servicing rows sit under Clients.
export const FILTER_GROUPS = [
  { key: 'leads', label: 'Leads', base: '--ov-kind-lead', kinds: ['inbound'],
    empty: 'No new leads on this day. Each lead shows here the moment it comes in.' },
  { key: 'texts', label: 'Texts', base: '--ov-kind-text', kinds: ['text_auto', 'text_reply'],
    empty: 'No texts on this day. The automatic texts we send and the replies people send back show here.' },
  { key: 'calls', label: 'Calls', base: '--ov-kind-call', kinds: ['va_call', 'in_progress', 'transferred'],
    empty: 'No calls on this day. VA calls, live transfers and calls in progress show here, reached or not.' },
  { key: 'bookings', label: 'Bookings', base: '--ov-st-booked', kinds: ['booked', 'moved', 'no_answer', 'edited', 'reassigned'],
    empty: 'No bookings on this day. Booked, moved and no-show appointments show here.' },
  { key: 'outcomes', label: 'Outcomes', base: '--ov-st-noanswer', kinds: ['outcome'],
    empty: 'No outcomes on this day. When you mark someone Sold, Follow up or Not interested, it shows here.' },
  { key: 'clients', label: 'Clients', base: '--ov-kind-client', kinds: ['sold', 'servicing', 'cancelled'],
    empty: 'No client updates on this day. New clients, servicing steps and old-policy cancellations show here.' },
  { key: 'billing', label: 'Billing', ...NEUTRAL, kinds: ['billing_subscription', 'billing_spend_change', 'billing_spend_pause'],
    empty: 'No billing changes on this day. Your weekly charges and any change to your lead spend show here.' },
]
export const PENDING_KINDS = ['billing_subscription', 'billing_spend_change', 'billing_spend_pause']
export const EMPTY_ALL = 'Nothing yet today. New leads, texts, calls, bookings and client updates show up here as they happen.'
export const EMPTY_MANY = 'Nothing for these filters on this day. Try another day, or clear the filter.'

export const groupOf = kind => FILTER_GROUPS.find(g => g.kinds.includes(kind))?.key || null
export const groupTone = g => toneOf(g)
// Groups with at least one kind that has a source: the chips (and box rows) that show.
export const visibleGroups = () => FILTER_GROUPS.filter(g => g.kinds.some(k => !PENDING_KINDS.includes(k)))

// Rows per group key over the day's whole feed (chip counts and the Activity box).
export function groupCounts(items) {
  const counts = Object.fromEntries(FILTER_GROUPS.map(g => [g.key, 0]))
  for (const i of items) {
    const g = groupOf(i.kind)
    if (g) counts[g] += 1
  }
  return counts
}

// `selected` is a list of group keys; empty means All. Tapping a chip adds or removes
// its group, and every visible chip on is the same as All.
export function toggleGroup(selected, key) {
  const next = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]
  return next.length >= visibleGroups().length ? [] : next
}
// Group keys from the URL, in chip order, ignoring anything that is not a visible group.
export function parseSelected(raw) {
  const want = new Set(String(raw || '').split(',').filter(Boolean))
  return visibleGroups().map(g => g.key).filter(k => want.has(k))
}
export function filterItems(items, selected) {
  if (!selected.length) return items
  const kinds = new Set(FILTER_GROUPS.filter(g => selected.includes(g.key)).flatMap(g => g.kinds))
  return items.filter(i => kinds.has(i.kind))
}
