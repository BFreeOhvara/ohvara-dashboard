import { shiftSegments, scheduledHours } from './payPeriod'

// Prompt 753 — My pay: the numbers behind the hero chart, the shift ruler,
// the payouts list and the Get paid to card. Pure functions, so the page and
// the harness agree. Hours come from the schedule (lib/payPeriod.js); money
// already earned is hours × rate; nothing here is a source of truth for what
// gets paid (the server recomputes that, migration 138).

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// 'YYYY-MM-DD' in the viewer's local time (pay weeks are keyed by their Monday).
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const fromIsoDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

// One entry per day of the period, Mon..Sun: scheduled (full) and worked so
// far (done) hours, the shift times, and whether it's today / over / off.
// `segments` defaults to the uniform schedule; the harness passes its own.
export function weekDays(period, now, segments) {
  const today = new Date(now)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i)
    const seg = segments.find(s => sameDay(s.start, date))
    const isToday = sameDay(date, today)
    return {
      date, letter: DAY_LETTERS[i], short: DAY_SHORT[i], isToday,
      off: !seg, start: seg?.start ?? null, end: seg?.end ?? null,
      full: seg?.full ?? 0, done: seg?.hours ?? 0,
      past: !isToday && date < today,
    }
  })
}

export function payWeek(pay, period, now, segments = shiftSegments(pay, period, now)) {
  const days = weekDays(period, now, segments)
  const worked = days.reduce((s, d) => s + d.done, 0)
  const scheduled = segments.length ? days.reduce((s, d) => s + d.full, 0) : scheduledHours(pay)
  const rate = pay?.hourly_rate_cents ?? null
  return {
    days,
    worked,
    scheduled,
    left: scheduled != null ? Math.max(0, scheduled - worked) : null,
    rate,
    earned: rate != null ? Math.round(worked * rate) : null,
    // Brayden hasn't set a rate or a shift: no money to show.
    unset: rate == null || !pay?.shift_start,
  }
}

// "30h", "4/8h", "—"
export const dayHoursLabel = d => (d.off ? '—' : d.done >= d.full ? `${trimH(d.full)}h` : `${trimH(d.done)}/${trimH(d.full)}h`)
const trimH = h => (Math.round(h * 10) / 10).toString()

// "10a", "12:30p"
export function shortTime(d) {
  const h = d.getHours(), m = d.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h >= 12 ? 'p' : 'a'}`
}

// The shift ruler runs 8a–8p, widened to fit any shift outside it.
export function rulerRange(days) {
  let lo = 8, hi = 20
  for (const d of days) {
    if (d.off) continue
    lo = Math.min(lo, d.start.getHours())
    hi = Math.max(hi, d.end.getHours() + (d.end.getMinutes() ? 1 : 0))
  }
  if ((hi - lo) % 2) hi += 1
  return { lo, hi }
}
export const hourFrac = (d, { lo, hi }) => ((d.getHours() + d.getMinutes() / 60) - lo) / (hi - lo) * 100
export function rulerTicks({ lo, hi }) {
  const out = []
  for (let h = lo; h <= hi; h += 2) out.push({ x: (h - lo) / (hi - lo) * 100, label: `${h % 12 === 0 ? 12 : h % 12}${h >= 12 && h < 24 ? 'p' : 'a'}` })
  return out
}

// The Monday after the week = pay day.
export const payDayOf = period => period.end

// ── the payout account ─────────────────────────────────────────────────────

// Mirrors statusOf in supabase/functions/_shared/fulfillmentPayouts.ts.
export function accountStatus(a) {
  if (!a) return 'none'
  if (!a.details_submitted) return 'incomplete'
  if (a.payouts_enabled && a.transfers_active && !(a.requirements_due || []).length && a.last4) return 'ready'
  return 'action_needed'
}

export const destination = a => (a?.last4 ? `${a.bank_name || 'Bank'} •••• ${a.last4}` : null)

// Stripe's requirement keys, in words a rep understands.
export function requirementText(due = [], disabledReason = null) {
  const has = re => due.some(k => re.test(k))
  if (has(/^external_account/)) return 'Add the bank account your pay goes to.'
  if (has(/verification\.(additional_)?document/)) return 'Stripe needs a photo of your ID.'
  if (has(/ssn_last_4|id_number/)) return 'Stripe needs your Social Security number.'
  if (has(/address/)) return 'Stripe needs your home address.'
  if (has(/dob/)) return 'Stripe needs your date of birth.'
  if (has(/tos_acceptance/)) return 'Accept Stripe\'s terms to get paid.'
  if (due.length) return 'Stripe needs a few more details before it can pay you.'
  if (disabledReason) return 'Stripe has paused payouts while it checks your details.'
  return 'Stripe is still checking your details.'
}

// ── the payouts list ───────────────────────────────────────────────────────

export const PAYOUT_STATUS = {
  upcoming: { label: 'Upcoming', tone: 'warn' },
  approved: { label: 'Sending', tone: 'warn' },
  paid: { label: 'Paid', tone: 'up' },
  failed: { label: 'Failed', tone: 'bad' },
  held: { label: 'On hold', tone: 'warn' },
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const md = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// "Oct 5 – 11", "Sep 28 – Oct 4"
export function weekRange(startIso, endIso) {
  const a = fromIsoDay(startIso), b = fromIsoDay(endIso)
  return a.getMonth() === b.getMonth() ? `${md(a)} – ${b.getDate()}` : `${md(a)} – ${md(b)}`
}

export function payoutRow(p, now, account) {
  const start = fromIsoDay(p.period_start)
  const end = fromIsoDay(p.period_end)
  const payDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1)
  const tile = p.status === 'paid' && p.paid_at ? new Date(p.paid_at) : payDay
  const thisWeek = new Date(now) >= start && new Date(now) < payDay
  const dest = p.paid_to || destination(account)
  const sub = p.status === 'paid' ? (p.paid_to ? `To ${p.paid_to}` : 'Sent')
    : p.status === 'failed' ? (p.failure_reason || 'Didn\'t go through')
      : p.status === 'held' ? (p.failure_reason || 'On hold')
        : p.status === 'approved' ? `Sending${dest ? ` to ${dest}` : ''}`
          : thisWeek ? 'This week · after Brayden approves' : 'Waiting on Brayden\'s approval'
  return {
    id: p.id, mon: MON[tile.getMonth()], day: tile.getDate(), week: weekRange(p.period_start, p.period_end),
    sub, amount: p.amount_cents, status: PAYOUT_STATUS[p.status] || PAYOUT_STATUS.upcoming,
  }
}

export function paidThisMonth(payouts, now) {
  const n = new Date(now)
  return payouts.reduce((s, p) => {
    if (p.status !== 'paid' || !p.paid_at) return s
    const d = new Date(p.paid_at)
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() ? s + p.amount_cents : s
  }, 0)
}

// 1099s: Stripe files them by Jan 31 for the year before. "Download 1099"
// turns on once a form can exist: a paid week in an earlier year and it's
// past Jan 31 of the year after.
export function form1099(payouts, now) {
  const n = new Date(now)
  const paidYears = payouts.filter(p => p.status === 'paid' && p.paid_at).map(p => new Date(p.paid_at).getFullYear())
  const past = paidYears.filter(y => y < n.getFullYear() && n >= new Date(y + 1, 0, 31))
  const year = past.length ? Math.max(...past) : n.getFullYear()
  return { year, ready: past.length > 0, readyBy: new Date(year + 1, 0, 31) }
}
