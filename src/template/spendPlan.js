// P878 — lead spend, the pilot and membership tiers (brain/ohvara/How Ohvara Works.md "Pricing direction" and the
// P875 decisions). Pure functions, no imports, so Billing, Setup, Results and the tests share one set of numbers.
// Every price and rate here is a DRAFT (Brayden + Jordan set them after the pilot); nothing is charged.
//
// The model (P889, one lead product): the agent sets ONE daily spend and How you take leads (Appointments only, or
// Appointments + live transfers with live-call hours). 100% of it goes to finding their leads. Pilot agents pay only
// that spend, prepaid weekly (unspent money rolls into next week; leads stop when it runs out). Paid agents also pay
// a monthly membership tiered by daily spend. The form/call split behind it is admin only (src/lib/leadSplit.js).
// spend = { daily } dollars a day. The old per-type shape { appts, live } still reads (dailyTotal adds them up).

import { DRAFT } from '../lib/priceBook.js'
import { effectiveSplit } from '../lib/leadSplit.js'

// Planning estimates (drafts, replaced by pilot data).
export const EST = {
  appts: { perLead: 25, booked: 0.35, show: 0.6, close: 0.4 },
  live: { perCall: 55, delivered: 0.7, close: 0.3 },
}

// Membership by total daily spend (draft). Scale is priced one to one. P884: the prices come from the one price
// source (src/lib/priceBook.js = billing_price_book version 1), never from here.
export const TIERS = DRAFT.tiers
export const SERVICING_ONLY = DRAFT.servicingOnly
export const PAID_MIN_DAILY = DRAFT.paidMinDaily
export const SLIDER = { min: 0, max: 300, step: 5 }
export const RECOMMENDED = 'Most full-time agents spend $100 to $150 a day. Starting out or part-time: $50 to $75.'

export const dailyTotal = spend => (spend?.daily != null ? Number(spend.daily) || 0 : (spend?.appts || 0) + (spend?.live || 0))
export const weeklyTotal = spend => dailyTotal(spend) * 7

export function tierOf(daily) {
  const d = Math.round(daily)
  return TIERS.find(t => d >= t.from && (t.to == null || d <= t.to)) || TIERS[0]
}

// Where a daily total sits on the tier bands (0..1 across 0..SLIDER.max), for the band marks on the slider.
export const bandShare = v => Math.max(0, Math.min(1, v / SLIDER.max))

// What a daily spend buys in a week, on the planning estimates. Low/high is ±25% around the estimate, whole numbers.
// mode = how the agent takes leads; transfer agents are estimated on the starting split (agents never see it).
const band = x => ({ low: Math.max(0, Math.floor(x * 0.75)), high: Math.ceil(x * 1.25), mid: x })
export function expected(spend, mode) {
  const split = spend?.daily != null ? effectiveSplit({ daily: spend.daily, mode: mode || 'both' }) : { form: spend?.appts || 0, call: spend?.live || 0 }
  const a = split.form * 7
  const l = split.call * 7
  const leads = a / EST.appts.perLead
  const booked = leads * EST.appts.booked
  const calls = l / EST.live.perCall
  const delivered = calls * EST.live.delivered
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

// The monthly bill. Pilot: lead spend only. Paid: membership + lead spend. Servicing only: its own price.
export function monthlyBill({ plan, spend, products = 'both' }) {
  const leadSpend = Math.round(dailyTotal(spend) * 30.4)
  if (products === 'servicing') return { leadSpend: 0, membership: SERVICING_ONLY, total: SERVICING_ONLY, tier: null }
  if (plan === 'pilot') return { leadSpend, membership: 0, total: leadSpend, tier: null }
  const tier = tierOf(dailyTotal(spend))
  return { leadSpend, membership: tier.monthly, total: tier.monthly == null ? null : leadSpend + tier.monthly, tier }
}

// Paid plans: lead spend can't go under the daily minimum.
export const spendOk = (plan, spend) => plan === 'pilot' || dailyTotal(spend) >= PAID_MIN_DAILY

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

// The optional pilot VA cost line (admin turns it on per agent): team hours on this agent × the hourly rate, at cost.
export const vaCost = va => (va?.on ? Math.round(va.hours * va.rate * 100) / 100 : 0)

// The prepaid weekly balance: loaded = this week's top-up + what rolled over; left = loaded - spent.
export function wallet(w, spend) {
  const loaded = w.topUp + w.rolled
  const left = Math.max(0, loaded - w.spent)
  const perDay = dailyTotal(spend)
  const daysLeft = perDay ? Math.floor(left / perDay) : Infinity
  return { ...w, loaded, left, daysLeft, low: perDay > 0 && daysLeft < 2, out: perDay > 0 && left < perDay }
}

// The agent's week against their usual week, in plain words (no talk of how leads are found).
export function weekVsUsual({ booked, usual, expectedRange }) {
  const diff = booked - usual
  const slow = booked < expectedRange.low
  const line = diff === 0 ? 'Right on your usual week.' : diff > 0 ? `${diff} more than your usual week.` : `${-diff} fewer than your usual week.`
  return { slow, line }
}
