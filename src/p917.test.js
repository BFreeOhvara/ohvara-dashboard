// P917 — agent side feel: live calls only in to-dos and on Leads, columns never shrink, real Billing, and motion and
// pop-ups that animate every time (every role). The motion itself was checked by clicking in a visible browser
// (scripts/p917-check.mjs, p917-phone.mjs); these pin the rules in the source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cardOf, chargesOf } from './template/billing917.js'
import { LIVE_STATUS, resultsFor } from './template/agentView.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('live calls: no cards on either Overview; the card says Live call, no Answer, in Booked blue (P920)', () => {
  assert.doesNotMatch(read('./template/screens/Overview.jsx'), /<LiveCalls/)
  assert.doesNotMatch(read('./template/m/MOverview.jsx'), /LiveStrip/)
  const card = read('./template/LiveCall.jsx')
  assert.doesNotMatch(card, /Live transfer|>Answer|onClick=\{answer\}/)
  assert.doesNotMatch(read('./template/m/MLeads.jsx').split('export function LiveStrip')[1].split('function LeadCard')[0], /Answer|Live transfer/)
  assert.doesNotMatch(read('./template/screens/Leads.jsx'), /onAnswer|>Answer</)
  const css = read('./template/live910.css')
  assert.match(css, /--lf: var\(--sh-f-sky\); --li: var\(--sh-fi-sky\)/)
  assert.doesNotMatch(css, /--sh-f-butter|--sh-f-apricot/)
  assert.equal(LIVE_STATUS.tone, 'blue') // P920: Booked's blue (a live call is a booking that happened right now)
  assert.deepEqual(resultsFor({ stage: 'ringing', kind: 'live_call' }), ['sold', 'follow_up', 'not_interested'])
})

test('Leads keeps full-size columns under the live cards (the page grows by their height); Activity holds still', () => {
  assert.match(read('./template/screens/Leads.jsx'), /setProperty\('--lc-live-h'/)
  assert.match(read('./template/leads873.css'), /html \.fx\.tp-app\.is-leads \{ height: calc\(100vh \+ var\(--lc-live-h, 0px\)\); \}/)
  assert.match(read('./template/p893.css'), /html \.fx\.tp-app\.is-activity:has\(\.fx-actgrid\) \{ height: 100vh; overflow: hidden;/)
})

test('Billing looks like billing: plan with Change plan, the card (brand, last 4, expiry), next charge, charges, lock', () => {
  const b = read('./template/screens/Billing.jsx')
  for (const s of ['aria-label="Your plan"', 'Change plan', 'aria-label="Payment method"', 'Update card', 'Next charge', 'aria-label="Charges"']) assert.ok(b.includes(s), s)
  assert.deepEqual(cardOf({ label: 'Visa ending 4242', onFile: true }), { brand: 'Visa', last4: '4242', exp: null })
  assert.deepEqual(cardOf({ label: 'Visa ending 4242', brand: 'Visa', last4: '4242', exp: '08/28', onFile: true }), { brand: 'Visa', last4: '4242', exp: '08/28' })
  assert.equal(cardOf({ onFile: false }), null)
  const nightNow = { forDay: 'Wed, Nov 4', tonight: { total: 112, credit: 0 }, ahead: [{ status: 'paid' }] }
  const rows = chargesOf({ nightNow, nightly: { at: 'Tonight, 8 PM' }, card: { onFile: true }, charges: [{ id: 'a', label: 'Setup fee, one time', kind: 'setup', amount: 299, status: 'paid' }] })
  assert.deepEqual(rows.map(r => [r.status, r.amount]), [['scheduled', 112], ['paid', 299]])
  const declined = chargesOf({ nightNow: { ...nightNow, ahead: [{ status: 'failed', day: 'Tue' }] }, nightly: {}, card: { onFile: true }, history: [{ id: 'h', label: 'Plan, Growth, November', amount: 1499 }] })
  assert.deepEqual(declined.map(r => [r.status, r.kind]), [['waiting', 'lead'], ['paid', 'plan']])
  for (const f of ['./template/screens/Billing.jsx', './template/Results.jsx', './template/PlanBuilder.jsx', './template/billing917.js']) assert.doesNotMatch(read(f), /team time|at cost/i, f)
})

test('motion: clickable cards lift with translate (not pinned by the entrance fill), press with scale; Messages opens like the avatar menu', () => {
  const css = read('./template/shell914.css')
  assert.match(css, /\.fx-card:has\(\.fx-cover\):hover \{ translate: 0 -5px;/)
  assert.match(css, /\.fx-card:has\(\.fx-cover\):active, \.fx-wk-ev:active \{ scale: \.97;/)
  assert.match(css, /\.fx\.tp-app\.is-messages \.fx-main \{ transform-origin: top right; animation: fx-menu /)
  assert.match(css, /\.fx\.tp-app\.is-messages \.fx-main\.is-leaving \{ animation: fx-menu-out /)
  assert.match(css, /\.fx \.fx-ib\.active\[href\] \{ transform: scale\(\.92\);/)
  // every frame uses the visibility gate (back from another tab, the motion comes back)
  for (const f of ['./template/TemplateFrame.jsx', './template/ful/FulFrame.jsx', './adminshell/AdminFrame.jsx', './fulshell/FulfillFrame.jsx']) assert.match(read(f), /const onVis = visibilityGate\(el\)/, f)
  // a phone sheet plays its way down before it closes
  assert.match(read('./template/m/Sheet.jsx'), /function useShut\(open, onClose\)/)
})
