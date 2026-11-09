// P878 — lead spend and membership tiers (brain/ohvara/How Ohvara Works.md "Pricing direction" and the
// P875 decisions). Pure functions, no imports, so Billing, Setup, Results and the tests share one set of numbers.
// P909: the prices are final (price book version 3, src/lib/priceBook.js): a plan by daily spend band, plus 12% of
// lead spend, charged nightly to the card on file. The planning estimates stay drafts until real data replaces them.
//
// The model (P889, one lead product): the agent sets ONE daily spend and How you take leads (Appointments only, or
// Appointments + live transfers with live-call hours). 100% of it goes to finding their leads. P914: no pilot,
// every agent pays from day one: a monthly plan by daily spend band plus 12% of the spend. Spend is charged each night
// for the next day (P909); what the ads didn't spend comes off the next night's charge. The form/call split behind it is admin only (src/lib/leadSplit.js); at
// launch call ads are off (P901), so all spend goes to form ads and live transfers come from form leads.
// spend = { daily } dollars a day. The old per-type shape { appts, live } still reads (dailyTotal adds them up).

import { PRICES, SETTINGS, nightlyCharge, extraClients } from '../lib/priceBook.js'
import { effectiveSplit, SPLIT_RULES } from '../lib/leadSplit.js'

// Planning estimates (drafts, replaced by real data).
export const EST = {
  // ready: of the form leads a transfer agent gets, the share ready to talk now inside live-call hours (transferred
  // live after Check agent instead of booked). P901: with call ads off, every live transfer comes from these.
  appts: { perLead: 25, booked: 0.35, show: 0.6, close: 0.4, ready: 0.15 },
  live: { perCall: 55, delivered: 0.7, close: 0.3 },
}

// Plans by total daily spend: Starter, Growth, Pro (P909, final). The prices come from the one price source
// (src/lib/priceBook.js = billing_price_book version 3), never from here.
export const TIERS = PRICES.tiers
export const SERVICING_ONLY = PRICES.servicingOnly
export const PAID_MIN_DAILY = PRICES.paidMinDaily
export const SETUP_FEE = PRICES.setupFee
export const LEAD_FEE = PRICES.leadFee
export const MAX_DAILY = SETTINGS.maxDaily
export const INCLUDED_ADDED = PRICES.includedAdded
export const SLIDER = { min: 0, max: MAX_DAILY, step: 5 }
export const feeWords = `${Math.round(LEAD_FEE * 100)}%`
export const FEE_WHY = 'covers the AI calls and the team working every lead'
export const RECOMMENDED = 'Most full-time agents spend $100 to $150 a day. Starting out or part-time: $50 to $75.'

export const dailyTotal = spend => (spend?.daily != null ? Number(spend.daily) || 0 : (spend?.appts || 0) + (spend?.live || 0))
export const weeklyTotal = spend => dailyTotal(spend) * 7

// Under the first band reads as the first plan, over the last (an admin raise) as the last.
export function tierOf(daily) {
  const d = Math.round(daily)
  return TIERS.find(t => d >= t.from && (t.to == null || d <= t.to)) || (d > (TIERS.at(-1).to ?? Infinity) ? TIERS.at(-1) : TIERS[0])
}

// P920: Change plan. The spend slider only moves inside the current plan's band, so dragging can never change the
// monthly price. The slider steps by $5, so its ends are the first and last $5 step inside the band (Growth $76-200
// runs $80 to $200). Switching plan moves the daily spend to the nearest spot inside the new band.
export function bandOf(tier, max = MAX_DAILY) {
  const lo = Math.max(PAID_MIN_DAILY, Math.ceil(tier.from / SLIDER.step) * SLIDER.step)
  const hi = Math.min(max, Math.floor((tier.to ?? max) / SLIDER.step) * SLIDER.step)
  return { lo, hi }
}
export const bandText = tier => `$${tier.from}–${tier.to ?? MAX_DAILY}`
export const switchDaily = (daily, tier) => { const { lo, hi } = bandOf(tier); return Math.max(lo, Math.min(hi, Math.round(daily / SLIDER.step) * SLIDER.step)) }

// Where a daily total sits on the tier bands (0..1 across 0..SLIDER.max), for the band marks on the slider.
export const bandShare = v => Math.max(0, Math.min(1, v / SLIDER.max))

// What a daily spend buys in a week, on the planning estimates. Low/high is ±25% around the estimate, whole numbers.
// mode = how the agent takes leads; transfer agents are estimated on the split that runs today (agents never see it;
// at launch that's all form ads). Transfer agents' form leads that are ready now go live instead of being booked.
const band = x => ({ low: Math.max(0, Math.floor(x * 0.75)), high: Math.ceil(x * 1.25), mid: x })
export function expected(spend, mode, rules = SPLIT_RULES) {
  const one = spend?.daily != null
  const split = one ? effectiveSplit({ daily: spend.daily, mode: mode || 'both' }, rules) : { form: spend?.appts || 0, call: spend?.live || 0 }
  const a = split.form * 7
  const l = split.call * 7
  const leads = a / EST.appts.perLead
  const ready = one && (mode || 'both') === 'both' ? leads * EST.appts.ready : 0
  const booked = (leads - ready) * EST.appts.booked
  const calls = l / EST.live.perCall
  const delivered = calls * EST.live.delivered + ready
  return {
    appts: { leads: band(leads), booked: band(booked), sold: band(booked * EST.appts.show * EST.appts.close) },
    live: { calls: band(calls), delivered: band(delivered), sold: band(delivered * EST.live.close) },
    soldMonth: band((booked * EST.appts.show * EST.appts.close + delivered * EST.live.close) * 4.33),
  }
}
export const rangeWords = r => (r.high === 0 ? 'none' : r.low === r.high ? `about ${r.high}` : `${r.low} to ${r.high}`)

// The appointment calendar has to have room: about 1.5 open 30-minute slots a week for each expected booking.
export const slotsNeeded = (spend, mode) => Math.ceil(expected(spend, mode).appts.booked.high * 1.5)
export function openSlotsPerWeek(week) {
  // week: { Mon: { on, start, end } ... } with 'H:MM AM' clocks.
  const min = c => { const m = /(\d+):(\d+)\s*(AM|PM)/.exec(c || ''); return m ? ((Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 0 }
  return Object.values(week || {}).reduce((n, d) => n + (d.on ? Math.max(0, Math.floor((min(d.end) - min(d.start)) / 30)) : 0), 0)
}
export const roomFor = (spend, week, booked = 0, mode) => openSlotsPerWeek(week) - booked >= slotsNeeded(spend, mode)

// The monthly bill, about a month (30.4 days): plan + lead spend + 12% of it, plus extra
// clients (lead plans: added clients over 50; servicing only: clients over 100). clients = { added, total }.
export function monthlyBill({ spend, products = 'both', clients = null }) {
  const leadSpend = Math.round(dailyTotal(spend) * 30.4)
  if (products === 'servicing') {
    const x = extraClients(clients?.total ?? 0, PRICES.servicingBase)
    return { leadSpend: 0, fee: 0, membership: SERVICING_ONLY, extra: x.extra, over: x.over, total: SERVICING_ONLY + x.extra, tier: null }
  }
  const tier = tierOf(dailyTotal(spend))
  const fee = Math.round(leadSpend * LEAD_FEE)
  const x = extraClients(clients?.added ?? 0, INCLUDED_ADDED)
  return { leadSpend, fee, membership: tier.monthly, extra: x.extra, over: x.over, total: tier.monthly == null ? null : leadSpend + fee + tier.monthly + x.extra, tier }
}

// Add clients (P909): what adding n more does to the bill.
export function addedQuote(b, n) {
  if (!b) return null
  const svc = b.products === 'servicing'
  const included = svc ? PRICES.servicingBase : INCLUDED_ADDED
  const now = svc ? b.clients?.total ?? 0 : b.clients?.added ?? 0
  const after = now + (Number(n) || 0)
  const change = extraClients(after, included).extra - extraClients(now, included).extra
  return { servicingOnly: svc, included, now, after, change, step: PRICES.servicingStep, stepPrice: PRICES.servicingStepPrice }
}

// Tonight's charge for tomorrow at a daily spend: the spend + 12%. (plan is kept in the signature; every plan is paid.)
export const nightlyFor = (plan, daily, credit = 0) => nightlyCharge({ daily, credit, rate: LEAD_FEE })

// Lead spend can't go under the daily minimum. Nobody goes over the max (an admin can raise one agent).
export const spendOk = (plan, spend, max = MAX_DAILY) => dailyTotal(spend) <= max && dailyTotal(spend) >= PAID_MIN_DAILY

// A spend change starts at midnight on the agent's clock; a tier change starts with the next bill.
export const startsText = nextDay => `Starts ${nextDay} at 12:00 AM your time`

// What the spend bought (Billing and Results), one line for the agent: booked and transferred are separate numbers,
// then shows and sales. Costs are spend divided by what it bought; null when none. Old per-type rows add up.
const per = (spent, n) => (n ? spent / n : null)
const KEYS = ['spent', 'leads', 'reached', 'booked', 'offered', 'transferred', 'showed', 'sold', 'premium']
export function boughtTotal(rows) {
  const list = Array.isArray(rows) ? rows : [rows]
  return KEYS.reduce((o, k) => ({ ...o, [k]: list.reduce((t, r) => t + (Number(r?.[k] ?? (k === 'transferred' ? r?.delivered : k === 'leads' ? r?.calls : 0)) || 0), 0) }), {})
}
export function bought(rows) {
  const r = boughtTotal(rows)
  const talked = r.showed + r.transferred
  return {
    ...r, talked,
    perLead: per(r.spent, r.leads), perHandled: per(r.spent, r.booked + r.transferred), perSale: per(r.spent, r.sold),
    showRate: r.booked ? r.showed / r.booked : null, pickup: r.offered ? r.transferred / r.offered : null, closeRate: talked ? r.sold / talked : null,
  }
}

// P909: lead spend is charged night by night. nights = [{ day, spend, delivered, status }] the last few days; credit =
// what was charged and not spent (comes off tonight's charge, with its 12%).
// P910: one paid day ahead. Today and tomorrow are paid; tonight charges the day after tomorrow (forDay). ahead = the
// three days as the agent sees them: today, tomorrow (paid, or 'failed' = not paid, so no ads that day), tonight's.
export const paidAhead = n => {
  const st = day => (n?.nights || []).find(x => x.day === day)?.status || 'unpaid'
  const today = st(n?.today) === 'paid' ? 'paid' : 'failed'
  const tomorrow = st(n?.tomorrow) === 'paid' ? 'paid' : 'failed'
  // While a declined day is open, no new day is charged (its retries come first): the day after waits ('held').
  return [
    { key: 'today', label: 'Today', day: n?.today, status: today },
    { key: 'tomorrow', label: 'Tomorrow', day: n?.tomorrow, status: tomorrow },
    { key: 'tonight', label: 'Day after', day: n?.forDay, status: tomorrow === 'failed' ? 'held' : 'tonight' },
  ].filter(d => d.day)
}
// Ads run on a day only if that day is paid (P910, never on an unpaid day).
export const adsRunOn = (n, day) => (n?.nights || []).some(x => x.day === day && x.status === 'paid')
export function nightly(n, spend, plan) {
  const credit = Math.max(0, (n?.nights || []).reduce((t, x) => t + (x.status === 'paid' && x.delivered != null ? x.spend - x.delivered : 0), 0))
  const tonight = nightlyFor(plan, dailyTotal(spend), credit)
  return { ...n, credit, tonight, ahead: paidAhead(n), failed: (n?.nights || []).some(x => x.status === 'failed') }
}

// The agent's week against their usual week, in plain words (no talk of how leads are found).
export function weekVsUsual({ booked, usual, expectedRange }) {
  const diff = booked - usual
  const slow = booked < expectedRange.low
  const line = diff === 0 ? 'Right on your usual week.' : diff > 0 ? `${diff} more than your usual week.` : `${-diff} fewer than your usual week.`
  return { slow, line }
}
