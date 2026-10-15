// Prompt 753 / 764 — My pay: the numbers behind the hero, the cancels list,
// the payouts list and the Get paid to card. Pure functions, so the page and
// the harness agree. Pay is per verified cancel (migration 145); each cancel
// carries its own amount. Nothing here is a source of truth for what gets
// paid: the Monday pay run recomputes that in the database.

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// 'YYYY-MM-DD' in the viewer's local time (pay weeks are keyed by their Monday).
export function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const fromIsoDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }

// ── cancels ────────────────────────────────────────────────────────────────

export const isVerified = c => c.status === 'verified' || c.status === 'verified_by_admin'

// What a rep sees for each status: never transcripts, recordings or quotes.
export function cancelView(c) {
  if (c.status === 'verified') return { kind: 'verified', label: 'Verified', note: 'Carrier confirmed on the call' }
  if (c.status === 'verified_by_admin') return { kind: 'verified', label: 'Verified', note: 'Brayden listened · paid' }
  if (c.status === 'checking') return { kind: 'checking', label: 'Checking', note: 'AI is listening · a few minutes' }
  if (c.status === 'not_paid') return { kind: 'off', label: 'Not paid', note: 'Brayden listened · not paid' }
  return { kind: 'listen', label: 'Needs a listen', note: c.reason === 'no_recording' ? 'No recording · with Brayden' : 'Not clear on the call · with Brayden' }
}

// Totals for a set of cancels (void rows are never fetched).
export function cancelTotals(list) {
  const t = { count: 0, verified: 0, checking: 0, listen: 0, notPaid: 0, verifiedCents: 0, checkingCents: 0 }
  for (const c of list) {
    if (c.status === 'void') continue
    t.count++
    if (isVerified(c)) { t.verified++; t.verifiedCents += c.amount_cents }
    else if (c.status === 'checking') { t.checking++; t.checkingCents += c.amount_cents }
    else if (c.status === 'needs_listen') t.listen++
    else if (c.status === 'not_paid') t.notPaid++
  }
  return { ...t, earnedCents: t.verifiedCents + t.checkingCents }
}

// The hero's day bars: Mon–Fri (plus a weekend day only if it has cancels),
// each stacked verified / checking / needs a listen. Days after today are
// dashed placeholders.
export function cancelsByDay(list, period, now) {
  const today = new Date(now)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(period.start.getFullYear(), period.start.getMonth(), period.start.getDate() + i)
    const mine = list.filter(c => sameDay(new Date(c.logged_at), date))
    const t = cancelTotals(mine)
    const isToday = sameDay(date, today)
    return { date, short: DAY_SHORT[i], isToday, future: !isToday && date > today, verified: t.verified, checking: t.checking, listen: t.listen, n: t.verified + t.checking + t.listen }
  })
  return days.filter((d, i) => i < 5 || d.n > 0)
}

// "Today", "Tue 13"
export function dayLabel(d, now) {
  const n = new Date(now)
  if (sameDay(d, n)) return 'Today'
  const y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  return `${DAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}`
}
export const timeLabel = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'

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
  const n = p.cancels ? `${p.cancels} cancel${p.cancels === 1 ? '' : 's'}` : null
  const sub = p.status === 'paid' ? [n, p.paid_to ? `to ${p.paid_to}` : 'sent'].filter(Boolean).join(' · ')
    : p.status === 'failed' ? (p.failure_reason || "Didn't go through")
      : p.status === 'held' ? (p.failure_reason || 'On hold')
        : p.status === 'approved' ? `Sending${dest ? ` to ${dest}` : ''}`
          : p.sub || (thisWeek ? 'This week · verified by Sunday' : 'Paid Monday')
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
