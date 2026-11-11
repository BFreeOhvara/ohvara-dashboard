// P955 — the admin side of "pick what you need": each agent's products (Leads · Servicing · Reactivation, any mix),
// a removal waiting for the next bill date, Setup tickets only for Leads, and Revenue split by product. No React and
// no Supabase, so node --test reads it (src/adminshell/p955.test.js). The words and order come from lib/products.js;
// the data from migration 268 (agent_billing_plans.picked / picked_next / picked_next_from / leads_setup_at, and
// admin_billing_revenue's by_product + counts).
import { ORDER, PRODUCTS, norm, has, monthly } from '../lib/products.js'
import { PRICES } from '../lib/priceBook.js'

// One tone per product, from the chip tones the kit already has.
export const PRODUCT_TONE = { leads: 'blue', servicing: 'teal', reactivation: 'violet' }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// What an agent has. Before migration 268 is read (or its row is missing): servicing-only plans stay servicing,
// everyone else has Leads (the same backfill the migration runs).
export const pickedOf = a => {
  const p = norm(a?.picked)
  if (p.length) return p
  return a?.plan === 'servicing' ? ['servicing'] : ['leads']
}
export const hasLeads = a => has(pickedOf(a), 'leads')

// '2026-12-09' (or a Date-able string) → 'Dec 9'. Text that isn't a date passes through.
export function shortDay(v) {
  if (!v) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  if (!m) return String(v)
  return `${MON[Number(m[2]) - 1]} ${Number(m[3])}`
}

// The chips for an agent: one per product they have, in the one order, and which of them end at the next bill date.
export function productChips(a) {
  const picked = pickedOf(a)
  const next = a?.pickedNext ? norm(a.pickedNext) : null
  const on = shortDay(a?.pickedNextFrom)
  return picked.map(k => ({ key: k, label: PRODUCTS[k].label, tone: PRODUCT_TONE[k], ends: next && !next.includes(k) ? on : null }))
}
// "Leads · Reactivation" (the row's chip text, also the screen reader line).
export const chipsText = a => productChips(a).map(c => c.label).join(' · ')
// "Servicing ends Dec 9" lines for a waiting removal (none when nothing is waiting).
export const endingLines = a => productChips(a).filter(c => c.ends).map(c => `${c.label} ends ${c.ends}`)

// The monthly plan fee an agent pays (dollars): the lead plan by band with Leads, plus Servicing's own price.
// Reactivation has no monthly. plans = data.js PLANS.
export function planPriceOf(a, plans) {
  const p = pickedOf(a)
  const lead = p.includes('leads') ? plans[a.plan]?.price || 0 : 0
  const svc = p.includes('servicing') ? (p.includes('leads') ? PRICES.servicingOnly : plans.servicing?.price ?? PRICES.servicingOnly) : 0
  return lead + svc
}
// The plan line for a row: { label, sub }.
export function planLineOf(a, plans) {
  const p = pickedOf(a)
  if (p.includes('leads')) return { label: plans[a.plan]?.label || 'Lead plan', sub: null, leads: true }
  if (p.includes('servicing')) return { label: 'Servicing', sub: `$${PRICES.servicingOnly} a month · up to ${PRICES.servicingBase} clients`, leads: false }
  return { label: 'No monthly plan', sub: 'Reactivation lists only', leads: false }
}
export const NO_PLAN = { label: 'No monthly plan', price: 0, sub: 'Reactivation only' }

// ── Setup tickets: only for Leads ────────────────────────────────────────────
// A ticket needs Leads in what they bought, and the Leads part paid: the sign-up with Leads, or (Leads added later in
// Billing) that product_add charge. leadsPaid: false = the plan row says the Leads setup isn't paid yet (real:
// agent_billing_plans.leads_setup_at is null); undefined = not known, so the older paid tick decides.
export const needsTicket = (c, isPaid) => hasLeads(c) && isPaid(c) && c.leadsPaid !== false

// ── Real data: agent_billing_plans rows merged onto the store ───────────────
// rows: [{ agent_id, picked, picked_next, picked_next_from, signed_up_at, setup_paid_at, leads_setup_at }] or null
// (not loaded / not migrated yet: nothing changes, the fallbacks above apply).
export function withProducts(state, rows) {
  if (!state || !Array.isArray(rows)) return state
  const by = new Map(rows.map(r => [r.agent_id, r]))
  const fields = r => (r ? { picked: norm(r.picked), pickedNext: r.picked_next || null, pickedNextFrom: r.picked_next_from || null, signedUpAt: r.signed_up_at || null } : {})
  const agents = (state.agents || []).map(a => ({ ...a, ...fields(by.get(a.id)) }))
  const onboard = (state.onboard || []).map(c => {
    const r = by.get(c.id)
    if (!r) return c
    const picked = norm(r.picked)
    const leadsPaid = !!r.leads_setup_at
    // Leads added after a Servicing sign-up: the ticket's 'paid' step is that product_add charge.
    const leadsAdded = picked.includes('leads') && leadsPaid && r.setup_paid_at && r.leads_setup_at && r.leads_setup_at > r.setup_paid_at
    return { ...c, ...fields(r), leadsPaid, leadsAdded: leadsAdded ? { on: shortDay(r.leads_setup_at) } : null }
  })
  return { ...state, agents, onboard }
}

// ── Revenue by product ───────────────────────────────────────────────────────
export const SPLIT_KEYS = ['leads', 'servicing', 'reactivation', 'setup']
export const SPLIT_LABEL = { leads: 'Leads', servicing: 'Servicing', reactivation: 'Reactivation', setup: 'Setup fees' }

// How many agents have each product (sample or real store's agents, comped included: they still have it).
export function productCounts(agents = []) {
  const out = Object.fromEntries(ORDER.map(k => [k, 0]))
  for (const a of agents) for (const k of pickedOf(a)) out[k] += 1
  return out
}

// Sample: the period's plan fees (moneyFor's `servicing`, the plan fees of every plan) shared out by each paying
// agent's plan prices, Leads' share plus the booking desk; setup as is; reactivation lists paid in the period.
// p = moneyFor(s, period). Dollars. Leads + Servicing = plan fees + booking desk exactly.
export function sampleSplit({ p, agents = [], plans, reactivation = 0 }) {
  const paying = agents.filter(a => !a.comped && a.billing?.status !== 'past_due')
  let leadPlans = 0
  let all = 0
  for (const a of paying) {
    const price = planPriceOf(a, plans)
    const svc = has(pickedOf(a), 'servicing') ? (hasLeads(a) ? PRICES.servicingOnly : price) : 0
    leadPlans += price - svc
    all += price
  }
  const leadShare = all > 0 ? Math.round((p.servicing * leadPlans) / all) : p.servicing
  return {
    amounts: { leads: leadShare + p.leadFee, servicing: p.servicing - leadShare, reactivation, setup: p.setup },
    counts: productCounts(agents),
  }
}

// Real: admin_billing_revenue's totals (cents) → dollars.
export function realSplit(view) {
  if (!view?.by_product) return null
  const d = c => Math.round(Number(c || 0)) / 100
  const b = view.by_product
  const c = view.counts || {}
  return {
    amounts: { leads: d(b.leads), servicing: d(b.servicing), reactivation: d(b.reactivation), setup: d(b.setup) },
    counts: { leads: Number(c.leads || 0), servicing: Number(c.servicing || 0), reactivation: Number(c.reactivation || 0) },
  }
}

// The rows the Revenue tile shows, and their total.
export function splitRows(split) {
  if (!split) return { rows: [], total: 0 }
  const rows = SPLIT_KEYS.map(k => ({ key: k, label: SPLIT_LABEL[k], amount: split.amounts[k] || 0, agents: k === 'setup' ? null : split.counts?.[k] ?? 0 }))
  return { rows, total: Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100 }
}

// The period's dates for admin_billing_revenue (clock = lib/admReal realClock).
export function periodRange(period, clock) {
  if (!clock?.todayIso) return null
  if (period === 'week') return { from: clock.weekStartIso, to: clock.todayIso }
  if (period === 'month') return { from: clock.monthStartIso, to: clock.todayIso }
  const [y, m] = clock.monthStartIso.split('-').map(Number)
  const from = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`
  const to = new Date(Date.parse(`${clock.monthStartIso}T12:00:00Z`) - 864e5).toISOString().slice(0, 10)
  return { from, to }
}

// ── Revenue › Charges: what a charge was ─────────────────────────────────────
export const CHARGE_KIND = { nightly: 'Lead spend', signup: 'Sign-up', plan_month: 'Plan', plan_upgrade: 'Plan upgrade', live_check: '$1 live check', reactivation: 'Reactivation list', product_add: 'Added a product' }
// product_add: the server's note starts "Added Servicing …", "Added Reactivation …" or "Added <tier> plan …" (Leads).
export function chargeWhat(c) {
  if (c?.kind !== 'product_add') return CHARGE_KIND[c?.kind] || c?.kind || ''
  const ps = norm(c.products)
  const named = ps.length === 1 ? ps[0] : null
  const note = String(c.note || '')
  const key = named || (/^Added Servicing/i.test(note) ? 'servicing' : /^Added Reactivation/i.test(note) ? 'reactivation' : /^Added /i.test(note) ? 'leads' : null)
  return key ? `Added ${PRODUCTS[key].label}` : CHARGE_KIND.product_add
}

// Re-exported for screens that only need these.
export { monthly, norm }
