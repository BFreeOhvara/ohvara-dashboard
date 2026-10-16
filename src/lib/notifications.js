// Prompt 767 — the notifications panel's pure logic: which icon and colour
// each type gets, the Today / Yesterday / Earlier groups, the time label and
// the two tabs. The rows themselves are written only by the database
// (migration 146, notify()); the list of types is brain/Ohvara Notifications
// Plan.md in the vault.

// Icon key (NotificationBell.jsx maps it to a lucide icon) and tone (a
// --nt-<tone> colour pair in index.css) per type.
export const TYPE_LOOK = {
  // Agent
  policy_cancelled:      { icon: 'win',    tone: 'teal' },
  client_no_answer:      { icon: 'missed', tone: 'amber' },
  call_missed_rebooking: { icon: 'cal',    tone: 'blue' },
  client_unreachable:    { icon: 'phone',  tone: 'purple' },
  needs_attention:       { icon: 'flag',   tone: 'amber' },
  weekly_limit:          { icon: 'gauge',  tone: 'amber' },
  payment_failed:        { icon: 'wallet', tone: 'red' },
  // Fulfillment
  call_booked:           { icon: 'cal',    tone: 'blue' },
  call_soon:             { icon: 'phone',  tone: 'teal' },
  call_not_started:      { icon: 'clock',  tone: 'red' },
  paid:                  { icon: 'wallet', tone: 'green' },
  pay_problem:           { icon: 'wallet', tone: 'red' },
  missed_strike:         { icon: 'flag',   tone: 'amber' },
  // Admin
  needs_listen:          { icon: 'listen', tone: 'amber' },
  rep_missed_call:       { icon: 'missed', tone: 'red' },
  rep_strikes:           { icon: 'flag',   tone: 'red' },
  payout_problem:        { icon: 'wallet', tone: 'red' },
  agent_payment_failed:  { icon: 'wallet', tone: 'red' },
  capacity_low:          { icon: 'team',   tone: 'amber' },
  job_failed:            { icon: 'bolt',   tone: 'red' },
  invite_accepted:       { icon: 'join',   tone: 'green' },
  // Shared
  message:               { icon: 'msg',    tone: 'blue' },
  live_room:             { icon: 'video',  tone: 'blue' },
}
export const lookOf = type => TYPE_LOOK[type] || { icon: 'bell', tone: 'blue' }

const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// 'TODAY' | 'YESTERDAY' | 'EARLIER', on the viewer's clock.
export function dayOf(iso, now = new Date()) {
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) return 'TODAY'
  const y = new Date(now); y.setDate(y.getDate() - 1)
  return dayKey(d) === dayKey(y) ? 'YESTERDAY' : 'EARLIER'
}

// "4:22 PM" today, "Thu" within the week, "Oct 3" before that.
export function timeLabel(iso, now = new Date()) {
  const d = new Date(iso)
  if (dayOf(iso, now) === 'TODAY') return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "Needs you": things to act on that haven't been opened yet.
export const needsYou = n => !!n.needs_action && !n.read

export function shownFor(rows, tab) {
  return tab === 'needs' ? rows.filter(needsYou) : rows
}

// Newest first, in Today / Yesterday / Earlier; empty groups dropped.
export function groupByDay(rows, now = new Date()) {
  const order = ['TODAY', 'YESTERDAY', 'EARLIER']
  const sorted = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  return order
    .map(label => ({ label, items: sorted.filter(n => dayOf(n.created_at, now) === label) }))
    .filter(g => g.items.length)
}

// Only app paths are followed.
export const safeLink = link => (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null)
