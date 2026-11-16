// Prompt 767 → P1023 — the bell's pure logic. The rows are written only by the database (notify(), migration 282:
// exactly Brayden's per-role lists); this file says how each type looks, where it opens, the Today / Yesterday /
// Earlier groups, and the sample rows test accounts see (one of each type for their role).

// ── The lists (migration 282). Settings and the sample bell follow these. ─────────────────────────────────────
export const ROLE_TYPES = {
  agent: ['live_transfer', 'appointment_booked', 'appointment_soon', 'transfer_missed', 'appointment_rebooked',
    'client_payment_failed', 'billing_charge_failed', 'message'],
  fulfillment: ['va_ring', 'new_client', 'task_due', 'va_save_call', 'call_soon', 'call_handed_to_you', 'call_not_started',
    'message', 'client_request', 'shift_soon', 'missed_strike', 'paid', 'pay_problem'],
  admin: ['agent_ready', 'billing_payment_problem', 'message', 'rep_strikes', 'payout_problem', 'job_failed', 'bug_report',
    'time_to_hire'],
}

// The phone kit's kinds (template/m/appModel NOTE_KIND: icon + colour) for each type.
export const TYPE_KIND = {
  live_transfer: 'live', appointment_booked: 'booking', appointment_soon: 'booking', transfer_missed: 'live',
  appointment_rebooked: 'moved', client_payment_failed: 'risk', billing_charge_failed: 'payment', message: 'message',
  va_ring: 'live', new_client: 'sold', task_due: 'todo', va_save_call: 'save', call_soon: 'booking',
  call_handed_to_you: 'live', call_not_started: 'risk', client_request: 'todo', shift_soon: 'booking', missed_strike: 'risk',
  paid: 'drafted', pay_problem: 'payment',
  agent_ready: 'sold', billing_payment_problem: 'payment', rep_strikes: 'risk', payout_problem: 'payment', job_failed: 'risk',
  bug_report: 'todo', time_to_hire: 'moved',
}
export const kindOf = type => TYPE_KIND[type] || 'todo'

// The settings list when the server's isn't there (sample accounts): label, phone push, email, can it be muted.
export const TYPE_INFO = {
  live_transfer: ['Live transfer', true, false, false],
  appointment_booked: ['New appointment booked', true, false, true],
  appointment_soon: ['Appointment in 15 minutes', true, false, true],
  transfer_missed: ['Missed live transfer', true, false, true],
  appointment_rebooked: ['Rebooked on your calendar', true, false, true],
  client_payment_failed: ['Client’s payment failed', true, false, false],
  billing_charge_failed: ['Your payment failed', true, true, false],
  message: ['New message', true, false, true],
  va_ring: ['Incoming call', true, false, false],
  new_client: ['New client to service', true, false, true],
  task_due: ['Task due soon', true, false, true],
  va_save_call: ['Client’s payment failed: save call', true, false, false],
  call_soon: ['Booked call in 5 minutes', true, false, true],
  call_handed_to_you: ['Booked call handed to you', true, false, true],
  call_not_started: ['Booked call not started', true, false, false],
  client_request: ['Client request', true, false, true],
  shift_soon: ['Shift starts in 15 minutes', true, false, true],
  missed_strike: ['Missed clock-in or strike', true, false, true],
  paid: ['Pay sent', false, false, true],
  pay_problem: ['Pay problem', true, false, true],
  agent_ready: ['New agent ready for a campaign', true, false, true],
  billing_payment_problem: ['Agent’s payment failed', true, false, false],
  rep_strikes: ['VA strike', true, false, true],
  payout_problem: ['VA pay problem', true, false, true],
  job_failed: ['Something broke', true, true, true],
  bug_report: ['Bug report', false, false, true],
  time_to_hire: ['Time to hire', false, false, true],
}
export function sampleSettings(role) {
  return (ROLE_TYPES[role] || []).map(type => {
    const [label, push, email, can_mute] = TYPE_INFO[type]
    return { type, label, push, bell: !['live_transfer', 'va_ring'].includes(type), email, email_on: email, can_mute, muted: false }
  })
}
// What a settings row says about where it arrives.
export function whereWords(r) {
  const parts = []
  if (r.push && !r.muted) parts.push('Phone')
  if (r.bell) parts.push('Bell')
  if (r.email && r.email_on && !r.muted) parts.push('Email')
  if (!r.bell && r.push) return r.type === 'live_transfer' ? 'Rings your phone, Yes / No' : 'Rings in the app'
  return parts.join(' + ') || 'Bell'
}

// ── Links ────────────────────────────────────────────────────────────────────────────────────────────────────
// Only app paths are followed.
export const safeLink = link => (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null)

// Older rows were written with the old portal's addresses; this sends them to today's pages.
export function appLink(link, role) {
  const l = safeLink(link)
  if (!l) return null
  if (role === 'agent') {
    if (l === '/billing' || l.startsWith('/billing?')) return '/agent/billing'
    if (l === '/clients') return '/agent/clients'
  }
  if (role === 'fulfillment') {
    const open = /^\/fulfillment\/desk\?open=([0-9a-f-]{36})/i.exec(l)
    if (open) return `/fulfillment/calendar/${open[1]}`
    if (l === '/fulfillment/desk' || l === '/fulfillment/servicing') return '/fulfillment/calendar'
  }
  if (role === 'admin') {
    if (l.startsWith('/admin/users')) return '/admin/agents'
    if (l.startsWith('/admin/payouts')) return '/admin/fulfillment'
  }
  return l
}

// ── Days and times ───────────────────────────────────────────────────────────────────────────────────────────
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

// A row as the bell shows it (the phone kit's NoteRow shape too).
export function toItem(n, role, now = new Date()) {
  return {
    id: n.id, type: n.type, kind: kindOf(n.type), title: n.title || n.message || 'Notification', what: n.detail || '',
    time: timeLabel(n.created_at, now), group: dayOf(n.created_at, now).toLowerCase(), to: appLink(n.link, role),
    unread: !n.read, needs: !!n.needs_action, at: n.created_at,
  }
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

// Legacy bell (components/notifications/NotificationBell.jsx): icon key + tone per type.
const LEGACY_ICON = { live: 'phone', booking: 'cal', moved: 'cal', risk: 'flag', payment: 'wallet', message: 'msg', sold: 'join', todo: 'clock', save: 'phone', drafted: 'wallet' }
const LEGACY_TONE = { live: 'teal', booking: 'blue', moved: 'blue', risk: 'red', payment: 'red', message: 'blue', sold: 'green', todo: 'amber', save: 'amber', drafted: 'green' }
export const TYPE_LOOK = Object.fromEntries(Object.entries(TYPE_KIND).map(([t, k]) => [t, { icon: LEGACY_ICON[k] || 'bell', tone: LEGACY_TONE[k] || 'blue' }]))
export const lookOf = type => TYPE_LOOK[type] || { icon: 'bell', tone: 'blue' }

// ── Sample rows: one of each type for the role, so a test account sees the whole list. ───────────────────────
const SAMPLE_ROWS = {
  agent: [
    ['appointment_soon', 'In 15 minutes: Sarah M.', '2:00 PM · Mortgage protection', '/agent/calendar', 0.1, true],
    ['transfer_missed', 'You missed Tom R.’s transfer', 'We booked Tom for Tue 2:00 PM.', '/agent/leads', 1, false],
    ['appointment_booked', 'Booked: Sarah M., Tue 2:00 PM', 'Mortgage protection', '/agent/leads', 2, false],
    ['client_payment_failed', 'Linda M.’s policy payment didn’t go through', 'Our team is on it.', '/agent/clients', 3, false],
    ['message', 'New message from Vic (Ohvara)', 'Linda’s carrier confirmed the new draft date.', '/messages', 5, false],
    ['appointment_rebooked', 'We rebooked Carla J. on your calendar: Fri 9:00 AM', 'Final expense', '/agent/calendar', 26, false],
    ['billing_charge_failed', 'Your card was declined', 'Leads are paused until it’s fixed. Update your card and we try again straight away.', '/agent/billing', 50, false],
  ],
  fulfillment: [
    ['call_not_started', 'Your 2:00 PM call hasn’t started', 'Sarah M. · 5 minutes late. Start it now or it moves to another VA.', '/fulfillment/calendar', 0.05, true],
    ['call_soon', 'Call Sarah Miller in 5 minutes', '2:00 PM · Mutual of Omaha · Call client unlocks now', '/fulfillment/calendar', 0.2, false],
    ['va_save_call', 'Linda M.’s payment failed', 'Save call needed by tomorrow 10:00 AM · Dana Walker’s client', '/fulfillment/pipeline', 0.6, true],
    ['new_client', 'New client: Sarah M. (Dana Walker’s)', 'Welcome call due today 4:00 PM', '/fulfillment/pipeline', 1, true],
    ['task_due', 'Cancel Sarah M.’s old policy, due today', 'The new policy is in force: issued Nov 10, first payment cleared Nov 14.', '/fulfillment/pipeline', 1.5, true],
    ['client_request', 'Client request: Change Tom R.’s beneficiary', 'From Dana Walker · due tomorrow 11:00 AM', '/fulfillment/pipeline', 2, false],
    ['call_handed_to_you', 'Ann L.’s call is yours now', 'It was booked for 1:00 PM. Call now.', '/fulfillment/calendar', 3, false],
    ['shift_soon', 'Your shift starts at 9:00 AM', 'In 15 minutes. Clock in when you start.', '/fulfillment/schedule', 7, false],
    ['message', 'New message from Dana Walker', 'Can you call Linda before 5? She’s free now.', '/messages', 8, false],
    ['missed_strike', 'You haven’t clocked in', 'Your shift started at 9:00 AM. Open the app and go Available.', '/fulfillment/schedule', 27, false],
    ['paid', 'Pay sent: $420.00', 'It lands in your bank in 1 to 2 days.', '/fulfillment/pay', 30, false],
    ['pay_problem', 'Your pay couldn’t be sent', 'Add your bank details to get paid.', '/fulfillment/pay', 75, false],
  ],
  admin: [
    ['job_failed', 'Something broke: Phone alerts aren’t sending', 'It failed 3 times today (job notify-push).', '/admin', 0.1, false],
    ['agent_ready', 'New agent ready: Dana Walker', 'Launch Dana Walker’s Mortgage protection campaign', '/admin/setup', 0.5, true],
    ['billing_payment_problem', 'A plan payment failed', 'Marcus Lee: card declined', '/admin/billing', 2, true],
    ['message', 'New message from Dana Walker', 'Where do I see my leads for today?', '/admin/messages', 3, false],
    ['bug_report', 'Bug report from Vic Ames', 'The calendar is blank after I switch weeks.', '/admin/bugs', 6, true],
    ['rep_strikes', 'Vic Ames hit 3 strikes in 30 days', 'Missed booked calls on Nov 2, Nov 9 and today.', '/admin/fulfillment', 26, false],
    ['payout_problem', 'Payout problem: Jo Park', 'No bank details on file.', '/admin/fulfillment', 30, false],
    ['time_to_hire', 'Next week needs about one more VA', '46 hours of booked work, 40 hours on the rota.', '/admin/fulfillment', 52, false],
  ],
}
export function sampleRows(role, now = new Date()) {
  return (SAMPLE_ROWS[role] || SAMPLE_ROWS.agent).map(([type, title, detail, link, hoursAgo, needs], i) => ({
    id: `sample-${role}-${i}`, type, title, detail, link, needs_action: needs, read: hoursAgo > 20,
    created_at: new Date(now.getTime() - hoursAgo * 3600e3).toISOString(),
  }))
}
