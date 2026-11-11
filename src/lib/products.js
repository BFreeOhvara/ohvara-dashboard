// P955 — pick what you need: Leads, Servicing, Reactivation, any mix (Brayden, Nov 11). Prices unchanged (price book
// v3 + the P952 reactivation price). No imports beyond the price sources, so node --test loads it as is. The database
// is the one that counts (migration 268_products.sql: agent_billing_plans.picked, billing_product_* functions); this
// file holds the words, the order and the rules the screens share.
//
//   Leads         a plan by daily spend band + the booking desk + $299 setup. Servicing of what's sold through
//                 Ohvara is included (+50 added clients).
//   Servicing     $499 a month up to 100 clients, +$200 per extra 100. $299 setup (once per account).
//   Reactivation  P957: free to upload, $20 per appointment or live call we deliver. No monthly plan, no setup fee.
// Everyone gets the portal. Leads + Servicing = both plans, one $299 setup, 150 added clients included.

import { PRICES } from './priceBook.js'
import { REACT_DEFAULTS } from './reactivation.js'

export const ORDER = ['leads', 'servicing', 'reactivation']

const money = n => `$${Number(n).toLocaleString('en-US')}`

export const PRODUCTS = {
  leads: {
    key: 'leads', label: 'Leads',
    line: 'New people who asked about mortgage protection, booked on your calendar or sent to you live.',
    price: `from ${money(PRICES.tiers[0].monthly)} a month`,
    sub: `plus your daily lead spend · ${money(PRICES.setupFee)} setup`,
  },
  servicing: {
    key: 'servicing', label: 'Servicing',
    line: 'Our team looks after the clients you already have: payments, changes, cancellations.',
    price: `${money(PRICES.servicingOnly)} a month`,
    sub: `up to ${PRICES.servicingBase} clients · ${money(PRICES.setupFee)} setup`,
  },
  reactivation: {
    key: 'reactivation', label: 'Reactivation',
    line: 'Upload your old leads; we clean the list and call them back for you.',
    price: `${money(REACT_DEFAULTS.deliveredCents / 100)} per appointment or live call`,
    sub: 'free to upload · no monthly plan, no setup fee',
  },
}

// One order, no repeats, only known keys.
export const norm = list => ORDER.filter(k => (list || []).includes(k))
export const has = (picked, key) => norm(picked).includes(key)
// Leads or Servicing = a monthly plan (and a setup fee once). Reactivation only = nothing monthly.
export const monthly = picked => has(picked, 'leads') || has(picked, 'servicing')
export const label = picked => norm(picked).map(k => PRODUCTS[k].label).join(' + ') || 'Nothing yet'

// Which agent tabs show for what they bought. Overview, Calendar, Activity and Billing always. Leads: with Leads or
// Reactivation (their reactivated leads land there). Clients: with Leads or Servicing, or once they have a client.
export function navFor(picked, { clients = 0 } = {}) {
  const p = norm(picked)
  const out = new Set(['overview', 'calendar', 'activity', 'billing'])
  if (p.includes('leads') || p.includes('reactivation')) out.add('leads')
  if (p.includes('leads') || p.includes('servicing') || clients > 0) out.add('clients')
  return out
}

// The small "Add …" suggestion for an account (none when they have everything worth adding). Not pushy: one card.
export function suggestion(picked) {
  const p = norm(picked)
  if (!p.includes('leads')) return 'leads'
  if (!p.includes('servicing')) return null
  return null
}

// After a removal: what's left from the next bill date (nothing monthly left → Reactivation, the portal stays).
export function afterRemove(picked, key) {
  const left = norm(picked).filter(k => k !== key)
  return monthly(left) ? left : norm([...left, 'reactivation'])
}

// What a picked set needs in the sign-up (Leads: plan, states, hours; Servicing: clients after paying; card always).
export const signupNeeds = picked => ({
  plan: has(picked, 'leads'),
  details: has(picked, 'leads'),
  clientsAfter: has(picked, 'servicing'),
  charge: monthly(picked),
})
