// P955 — Billing → Your products, the pure part (no React, so node --test reads it). The words, prices and rules come
// from src/lib/products.js; this works out each product's state for one billing record, the quote lines, the remove
// confirm words, the sample quote (the server's billing_product_quote shape, in cents) and the nav filter.

import { PRICES, servicingOnlyPrice } from '../lib/priceBook.js'
import { ORDER, PRODUCTS, norm, monthly, navFor, afterRemove } from '../lib/products.js'
import { REACT_DEFAULTS } from '../lib/reactivation.js'

// What the agent bought. A record from before P955 has only products (one word): servicing = Servicing only.
export function pickedOf(b) {
  if (Array.isArray(b?.picked) && b.picked.length) return norm(b.picked)
  return b?.products === 'servicing' ? ['servicing'] : ['leads']
}
// The old one-word products, as the server's trigger keeps it (Leads in = both, else servicing).
export const productsWord = picked => (norm(picked).includes('leads') ? 'both' : 'servicing')

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const at = s => new Date(`${String(s).slice(0, 10)}T12:00:00`)
// '2026-12-01' → 'Tue, Dec 1'
export const dayWords = s => (s ? at(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '')
const daysBetween = (a, b) => Math.round((at(b) - at(a)) / 86400000)

// One product's state: on, off, ending (a removal waits for the next bill date: Keep undoes it) or starting (Reactivation
// comes in when the last monthly product ends).
export function stateOf(b, key) {
  const picked = pickedOf(b)
  const next = Array.isArray(b?.next) ? norm(b.next) : null
  if (picked.includes(key)) return next && !next.includes(key) ? { kind: 'ending', on: b.nextFrom } : { kind: 'on' }
  if (next && next.includes(key)) return { kind: 'starting', on: b.nextFrom }
  return { kind: 'off' }
}

const money = n => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`
export const cents = c => money((Number(c) || 0) / 100)

// What an On product costs, in the words of its row.
export function costOf(b, key) {
  if (key === 'leads') {
    const t = PRICES.tiers.find(x => x.key === b?.tier) || PRICES.tiers[1]
    return { big: `${money(t.monthly)} a month`, sub: `${t.label} plan, plus your daily lead spend` }
  }
  if (key === 'servicing') {
    const n = b?.clients?.total || 0
    return { big: `${money(servicingOnlyPrice(n))} a month`, sub: n > PRICES.servicingBase ? `${n} clients` : `Up to ${PRICES.servicingBase} clients` }
  }
  return { big: `${money(REACT_DEFAULTS.priceCents / 100)} a lead`, sub: 'Per list, when you send one. Nothing monthly' }
}

// The rows of the products card, in the shared order.
export const productRows = b => ORDER.map(key => ({ ...PRODUCTS[key], state: stateOf(b, key) }))

// Remove: never the last product (the server refuses: Reactivation alone is the account).
export const canRemove = (b, key) => stateOf(b, key).kind === 'on' && !(key === 'reactivation' && pickedOf(b).length === 1)

// The remove confirm, in plain words. ends = the next bill date (iso), for Leads or Servicing.
export function removeWords(b, key, ends = b?.planMonth?.next || b?.nextFrom) {
  if (key === 'reactivation') return { title: 'Remove Reactivation?', lines: ['Lists already paid keep calling.', 'You can add it again any time.'], button: 'Remove now' }
  const left = afterRemove(Array.isArray(b?.next) ? b.next : pickedOf(b), key)
  const lines = [`Ends on ${dayWords(ends)}. You keep it until then.`]
  if (!monthly(left)) lines.push('After that nothing is charged monthly. You keep your portal and Reactivation: you pay per list, when you send one.')
  if (key === 'leads') lines.push(`New leads stop then. The ${money(PRICES.setupFee)} setup fee isn’t refunded.`)
  return { title: `Remove ${PRODUCTS[key].label}?`, lines, button: `Remove on ${dayWords(ends)}` }
}

// The server's quote as rows: [label, cents, sub?]. The last one is the total.
export function quoteLines(q) {
  if (!q) return []
  const out = []
  if (q.setup_cents > 0) out.push({ key: 'setup', label: 'Setup (one time)', cents: q.setup_cents })
  if (q.plan_cents > 0 || q.monthly_cents > 0) {
    out.push({ key: 'plan', label: q.prorated ? `${q.label}, ${q.days_left} days left this month` : `${q.label}, first month`, cents: q.plan_cents,
      sub: q.prorated ? `Then ${cents(q.monthly_cents)} a month from ${dayWords(q.bill_to)}` : `Then ${cents(q.monthly_cents)} a month` })
  }
  const days = q.days?.length || 0
  if (days > 0) out.push({ key: 'leads', label: `First ${days} days of leads`, cents: (q.spend_cents || 0) + (q.fee_cents || 0), desk: true })
  out.push({ key: 'total', label: 'Charged today', cents: q.total_cents || 0 })
  return out
}

// The sample's quote, in the server's shape. A running bill month (Leads or Servicing on) = the days left of it,
// otherwise a full month from today. Setup: Leads unless Leads was set up before; Servicing only if no setup was paid.
export function sampleQuote(b, { product, tier = null, daily = null }) {
  if (product === 'reactivation') return { product, label: 'Reactivation', setup_cents: 0, plan_cents: 0, monthly_cents: 0, days: [], spend_cents: 0, fee_cents: 0, total_cents: 0, prorated: false }
  const running = monthly(pickedOf(b))
  const m = b?.planMonth || { today: '2026-11-02', start: '2026-11-01', next: '2026-12-01' }
  const daysIn = daysBetween(m.start, m.next)
  const left = daysBetween(m.today, m.next)
  const setupC = Math.round(PRICES.setupFee * 100)
  let monthlyC, label, setup, extra = { days: [], spend_cents: 0, fee_cents: 0 }, tierKey = 'servicing'
  if (product === 'servicing') {
    monthlyC = Math.round(PRICES.servicingOnly * 100); label = 'Servicing'
    setup = b?.setupPaid ? 0 : setupC
  } else {
    const t = PRICES.tiers.find(x => x.key === tier) || PRICES.tiers[1]
    tierKey = t.key; monthlyC = Math.round(t.monthly * 100); label = t.label
    setup = b?.leadsSetupPaid ? 0 : setupC
    const d = Math.max(PRICES.paidMinDaily, Math.min(t.to, Number(daily) || t.from))
    const spend = d * 100 * 2
    const start = at(m.today)
    extra = { days: [1, 2].map(k => iso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + k))), spend_cents: spend, fee_cents: Math.round(spend * PRICES.leadFee), daily_cents: d * 100 }
  }
  const plan = running ? Math.max(0, Math.round(monthlyC * left / Math.max(daysIn, 1))) : monthlyC
  const to = running ? m.next : iso(new Date(at(m.today).getFullYear(), at(m.today).getMonth() + 1, at(m.today).getDate()))
  return { product, tier: tierKey, label, monthly_cents: monthlyC, plan_cents: plan, prorated: running, days_left: running ? left : null, days_in_month: running ? daysIn : null,
    bill_from: running ? m.start : m.today, bill_to: to, setup_cents: setup, fee_rate: PRICES.leadFee, ...extra,
    total_cents: setup + plan + extra.spend_cents + extra.fee_cents }
}

// The daily spend range of a plan band (never under the paid minimum).
export const bandRange = t => ({ lo: Math.max(t.from, PRICES.paidMinDaily), hi: t.to })
export const clampDaily = (t, d) => { const { lo, hi } = bandRange(t); return Math.max(lo, Math.min(hi, Number(d) || lo)) }

// Failure words (SignupCheckout's FAIL_WORDS, for adding a product). Every one says nothing was charged.
export const FAIL_WORDS = {
  details_missing: 'Finish your details above first. Nothing was charged.',
  already_have: 'You already have it. Nothing was charged.',
  pending_removal: 'It’s set to end on your next bill date. Press Keep instead. Nothing was charged.',
  no_card: 'Add a card first, in Payment method. Nothing was charged.',
  test_account: 'This is a test account. Test accounts are never charged.',
  not_signed_up: 'Finish signing up first. Nothing was charged.',
  only_product: 'It’s your only product. Add another first.',
}
export const failWords = e => FAIL_WORDS[e?.code || e?.hint] || (e?.message ? `${e.message.replace(/\.?$/, '.')} Nothing was charged.` : 'Something went wrong. Nothing was charged.')
// productAdd's result, for a note or the drawer's error.
export function addResultWords(r, label) {
  if (!r) return { ok: false, text: 'Something went wrong. Nothing was charged.' }
  if (r.status === 'paid' || r.status === 'added') return { ok: true, text: `${label} added.` }
  if (r.status === 'failed') return { ok: false, text: r.failure || 'Your card was declined. Nothing was charged. Update your card and try again.' }
  if (r.skipped) return { ok: false, text: 'Payments aren’t switched on yet. Nothing was charged.' }
  return { ok: true, text: `${label} is being added. It shows here once the payment goes through.` }
}

// The nav for what they bought: tabs without a key always show.
export const tabsFor = (tabs, picked, opts) => { const on = navFor(picked, opts); return tabs.filter(t => !t.key || on.has(t.key)) }
