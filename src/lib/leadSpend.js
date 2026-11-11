// P884 — the real billing calls the agent side (P848) and admin side (P858) wire when Show sample data is off. The
// money rules live in the database (supabase/migrations/237_billing_engine.sql); Stripe charges go through the
// lead-spend edge function (test mode only until Brayden's live switch). Bank and card numbers never pass through here.
//
// Agent:  loadBilling(db)                    my_billing(): plan, status, what runs, balance, spend, week, membership
//                                            (P909: + next_charge, card, credit, founding, settings)
//         cardCheck(db)                      P909 lead-spend card_check: records the default card (brand + last 4)
//         addedClientsQuote(db, n)           P909 billing_added_clients_quote: Add clients' count and cost
//         setLeadProduct(db, { daily, mode, hours, tz })  P889 lead_product_set: ONE daily spend + how they take
//                                            leads; the server splits it (agents never see the split). A raise is
//                                            charged by the next lead-spend run (every 15 minutes).
//         setSpend(db, { appts, live })      P884 lead-spend set_spend (per type). Superseded by setLeadProduct.
//         payNow(db) / pauseSpend(db, bool)  lead-spend pay_now / pause
//         planState(db) / planQuote(db, tier) P921 my_plan_state / billing_plan_quote: the plan, a scheduled
//                                            downgrade, the billing month, an upgrade going through or declined
//         changePlan(db, { tier, daily })    P921 lead-spend plan_change: up = the prorated difference charged now
//                                            (result 'paid' | 'failed' | 'due'); down = from the next bill; same = Undo
// Admin:  adminBilling(db, agentId), setupSet, adjustBalance, savePriceBook. P914: no pilot, so the pilot switch,
//         the VA cost line and pilot → paid are gone (their functions refuse, migration 252_no_pilot.sql).
// Shape:  toSampleBilling(view) maps the server view onto the sample billing shape the P878 Billing page draws.

import { pricesOf, BOOK, hourText } from './priceBook.js'

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
export const cardCheck = db => invoke(db, { action: 'card_check' })
export const addedClientsQuote = (db, n) => rpc(db, 'billing_added_clients_quote', { p_new: n })
export const planState = db => rpc(db, 'my_plan_state')
export const planQuote = (db, tier) => rpc(db, 'billing_plan_quote', { p_tier: tier })
export const changePlan = (db, { tier, daily = null }) => invoke(db, { action: 'plan_change', tier, daily_cents: daily == null ? null : toCents(daily) })
export const pauseSpend = (db, paused) => invoke(db, { action: 'pause', paused: !!paused })
// P933: sign-up (plan + card + one charge), the Live charging switch, the $1 live check, recent charges.
export const signupQuote = (db, { tier, daily = null }) => invoke(db, { action: 'signup_quote', tier, daily_cents: daily == null ? null : toCents(daily) })
export const signupPay = (db, { tier, daily = null }) => invoke(db, { action: 'signup', tier, daily_cents: daily == null ? null : toCents(daily) })
export const liveCheck = db => invoke(db, { action: 'live_check' })
export const adminCharges = (db, limit = 30) => rpc(db, 'admin_billing_charges', { p_limit: limit })
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
export const setupSet = (db, agentId, { mode, fee = null, months = null }) =>
  rpc(db, 'admin_billing_setup_set', { p_agent: agentId, p_mode: mode, p_fee_cents: fee == null ? null : toCents(fee), p_min_months: months })
export const adjustBalance = (db, agentId, dollars, reason) => rpc(db, 'admin_lead_spend_adjust', { p_agent: agentId, p_cents: toCents(dollars), p_reason: reason })
export const savePriceBook = (db, book, effective, note) => rpc(db, 'admin_price_book_save', { p_book: book, p_effective: effective, p_note: note })
// P909 admin: billing settings (max daily, charge hours, founding lock), one agent's max, revenue with the 12% apart.
export const saveBillingSettings = (db, st) => rpc(db, 'admin_billing_settings_save', {
  p_settings: { max_daily_cents: st.maxDaily == null ? null : toCents(st.maxDaily), charge_hour: st.chargeHour, retry_hour: st.retryHour,
    founding_count: st.foundingCount, founding_months: st.foundingMonths },
})
export const setMaxDaily = (db, agentId, dollars) => rpc(db, 'admin_billing_max_daily_set', { p_agent: agentId, p_cents: dollars == null ? null : toCents(dollars) })
export const adminRevenue = (db, from, to) => rpc(db, 'admin_billing_revenue', { p_from: from, p_to: to })

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
    plan: 'paid', // P914: no pilot
    products: view.products || 'both',
    spend: { daily: d(daily) || 0 },
    pending: next != null ? { daily: d(next), from: sp.next_from } : null,
    take: { mode: lp.mode || 'appts', hours: lp.hours || null, tz: lp.tz || null },
    wallet: { topUp: d(week.collected_cents) || 0, rolled: d(week.rolled_in_cents) || 0, spent: d(spent) || 0, balance: d(view.balance_cents) || 0, week_start: week.week_start },
    // P909: the nightly charge (tonight's, for tomorrow), the card on file, credit, the founding lock, settings.
    nightly: view.next_charge ? {
      at: `Tonight, ${hourText(view.next_charge.at_hour ?? 20)}`, forDay: view.next_charge.for_day, status: view.next_charge.status,
      tonight: { spend: d(view.next_charge.spend_cents), credit: d(view.next_charge.credit_cents), net: d(view.next_charge.net_cents),
        fee: d(view.next_charge.fee_cents), total: d(view.next_charge.total_cents), rate: Number(view.next_charge.fee_rate) || 0 },
      nights: (view.charges || []).filter(c => c.kind === 'nightly').map(c => ({ day: c.for_day, spend: d(c.spend_cents), fee: d(c.fee_cents), status: c.status })),
    } : null,
    card: view.card ? { label: view.card.label, onFile: !!view.card.on_file } : null,
    credit: d(view.credit_cents) || 0, refund: d(view.refund_cents) || 0,
    founding: view.founding?.active ? { no: view.founding.no, until: view.founding.until } : null,
    maxDaily: d(view.settings?.max_daily_cents) ?? null,
    clients: view.membership?.clients ? { total: view.membership.clients.total, sold: view.membership.clients.sold, added: view.membership.clients.added } : null,
    status: st.status, leadSpend: st.lead_spend, runs: st,
    payment: { failed: st.lead_spend === 'stopped_payment' || st.status === 'past_due' || st.status === 'suspended' },
    paused: st.status === 'paused' ? {} : null,
    graceUntil: view.grace_until || null,
    membership: view.membership || null,
    charges: (view.charges || []).map(c => ({ ...c, amount: d(c.cents), spend: c.spend_cents == null ? undefined : d(c.spend_cents), fee: c.fee_cents == null ? undefined : d(c.fee_cents) })),
    prices: pricesOf(view.price_book || BOOK),
  }
}
