// P884 — the real billing calls the agent side (P848) and admin side (P858) wire when Show sample data is off. The
// money rules live in the database (supabase/migrations/p884_billing_engine.sql); Stripe charges go through the
// lead-spend edge function (test mode only until Brayden's live switch). Bank and card numbers never pass through here.
//
// Agent:  loadBilling(db)                    my_billing(): plan, status, what runs, balance, spend, week, membership
//         setLeadProduct(db, { daily, mode, hours, tz })  P889 lead_product_set: ONE daily spend + how they take
//                                            leads; the server splits it (agents never see the split). A raise is
//                                            charged by the next lead-spend run (every 15 minutes).
//         setSpend(db, { appts, live })      P884 lead-spend set_spend (per type). Superseded by setLeadProduct.
//         payNow(db) / pauseSpend(db, bool)  lead-spend pay_now / pause
//         acceptPaid(db, termsVersion)       billing_accept_paid (pilot → paid notice)
// Admin:  adminBilling(db, agentId), pilotSet, vaCostSet, toPaid, setupSet, adjustBalance, savePriceBook
// Shape:  toSampleBilling(view) maps the server view onto the sample billing shape the P878 Billing page draws.

import { pricesOf, BOOK } from './priceBook.js'

const rpc = async (db, name, args) => {
  const { data, error } = await db.rpc(name, args)
  if (error) throw error
  return data
}
const invoke = async (db, body) => {
  const { data, error } = await db.functions.invoke('lead-spend', { body })
  if (error) {
    let detail = null
    try { detail = await error.context?.json?.() } catch { /* no body */ }
    const e = new Error(detail?.error || error.message)
    e.code = detail?.code
    throw e
  }
  return data
}
const toCents = d => Math.round((Number(d) || 0) * 100)

export const loadBilling = db => rpc(db, 'my_billing')
export const setSpend = (db, { appts = 0, live = 0 }) => invoke(db, { action: 'set_spend', appts_cents: toCents(appts), live_cents: toCents(live) })
export const payNow = db => invoke(db, { action: 'pay_now' })
export const pauseSpend = (db, paused) => invoke(db, { action: 'pause', paused: !!paused })
export const acceptPaid = (db, termsVersion, device = typeof navigator !== 'undefined' ? navigator.userAgent : null) =>
  rpc(db, 'billing_accept_paid', { p_terms_version: termsVersion, p_device: device })

export const setLeadProduct = (db, { daily, mode, hours, tz }) =>
  rpc(db, 'lead_product_set', { p_daily_cents: toCents(daily), p_mode: mode, p_hours: hours, p_tz: tz || null })

// P889 admin: the split per agent (form vs call ads), the lock, the change log, and the rules.
export const adminLeadSplit = (db, agentId) => rpc(db, 'admin_lead_split_view', { p_agent: agentId })
export const lockSplit = (db, agentId, { locked, formPct = null, note = null }) =>
  rpc(db, 'admin_lead_split_lock', { p_agent: agentId, p_locked: locked, p_form_pct: formPct, p_note: note })
export const saveSplitRules = (db, rules) => rpc(db, 'admin_lead_split_rules_save', {
  p_rules: { start_form_pct: rules.startFormPct, max_step: rules.maxStep, floor_pct: rules.floorPct, min_sales: rules.minSales,
    call_min_daily_cents: toCents(rules.callMinDaily), hold_within: rules.holdWithin, lookback_weeks: rules.lookbackWeeks,
    call_ads_on: rules.callAdsOn },
})

export const adminBilling = (db, agentId) => rpc(db, 'admin_billing_view', { p_agent: agentId })
export const pilotSet = (db, agentId, { on, start = null, note = null }) => rpc(db, 'admin_billing_pilot_set', { p_agent: agentId, p_on: on, p_start: start, p_note: note })
export const vaCostSet = (db, agentId, { on, rate = null }) => rpc(db, 'admin_billing_va_cost_set', { p_agent: agentId, p_on: on, p_rate_cents: rate == null ? null : toCents(rate) })
export const toPaid = (db, agentId, start) => rpc(db, 'admin_billing_to_paid', { p_agent: agentId, p_start: start })
export const setupSet = (db, agentId, { mode, fee = null, months = null }) =>
  rpc(db, 'admin_billing_setup_set', { p_agent: agentId, p_mode: mode, p_fee_cents: fee == null ? null : toCents(fee), p_min_months: months })
export const adjustBalance = (db, agentId, dollars, reason) => rpc(db, 'admin_lead_spend_adjust', { p_agent: agentId, p_cents: toCents(dollars), p_reason: reason })
export const savePriceBook = (db, book, effective, note) => rpc(db, 'admin_price_book_save', { p_book: book, p_effective: effective, p_note: note })

// The server view → the sample billing fields (dollars). Fields the server doesn't have yet (what each lead type
// bought, saved policies, invoice history) stay with their owners: P848 fills bought/history, P852 saved.
export function toSampleBilling(view) {
  if (!view) return null
  const d = c => (c == null ? null : c / 100)
  const week = view.week || {}
  // P889: my_billing sends one spend line (spend.daily, week.billed_cents); the P884 per-type shape still adds up.
  const spent = week.billed_cents ?? ['appts', 'live'].reduce((t, k) => t + (week.types?.[k]?.billed_cents || 0), 0)
  const sp = view.spend || {}
  const daily = sp.daily ?? ((sp.appts || 0) + (sp.live || 0))
  const next = sp.next == null ? null : typeof sp.next === 'object' ? (sp.next.appts || 0) + (sp.next.live || 0) : sp.next
  const lp = view.lead_product || {}
  const st = view.state || {}
  return {
    plan: view.plan === 'pilot' ? 'pilot' : 'paid',
    products: view.products || 'both',
    spend: { daily: d(daily) || 0 },
    pending: next != null ? { daily: d(next), from: sp.next_from } : null,
    take: { mode: lp.mode || 'appts', hours: lp.hours || null, tz: lp.tz || null },
    wallet: { topUp: d(week.collected_cents) || 0, rolled: d(week.rolled_in_cents) || 0, spent: d(spent) || 0, balance: d(view.balance_cents) || 0, week_start: week.week_start },
    va: view.va_cost ? { on: !!view.va_cost.on, hours: Math.round((view.va_cost.minutes / 60) * 10) / 10, rate: d(view.va_cost.rate_cents) } : { on: false, hours: 0, rate: 0 },
    status: st.status, leadSpend: st.lead_spend, runs: st,
    payment: { failed: st.lead_spend === 'stopped_payment' || st.status === 'past_due' || st.status === 'suspended' },
    paused: st.status === 'paused' ? {} : null,
    graceUntil: view.grace_until || null,
    membership: view.membership || null,
    toPaid: view.to_paid || null,
    charges: (view.charges || []).map(c => ({ ...c, amount: d(c.cents) })),
    prices: pricesOf(view.price_book || BOOK),
  }
}
