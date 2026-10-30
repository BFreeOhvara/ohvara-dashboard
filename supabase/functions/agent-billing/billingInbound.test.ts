/**
 * Unit tests for src/lib/billingInbound.js, the pure helper behind the Get inbounds
 * panel (it has no imports, so Deno can load it). The numbers and the words the panel
 * shows come from here; the server side of the same numbers is pinned in core.test.ts.
 * Run: deno test --allow-env --node-modules-dir=none supabase/functions/agent-billing/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as h from '../../../src/lib/billingInbound.js'

const data = (over: Record<string, unknown> = {}) => ({
  configured: true, comped: false, billed: true, subscribed: true,
  types: [
    { type: 'live_call', weekly_cents: 0, paused: false, estimate_count: 0 },
    { type: 'booked_appointment', weekly_cents: 0, paused: false, estimate_count: 0 },
  ],
  ...over,
})
const withTypes = (live: [number, boolean, number], booked: [number, boolean, number], over: Record<string, unknown> = {}) => data({
  types: [
    { type: 'live_call', weekly_cents: live[0], paused: live[1], estimate_count: live[2] },
    { type: 'booked_appointment', weekly_cents: booked[0], paused: booked[1], estimate_count: booked[2] },
  ],
  ...over,
})

// Words Brayden ruled out of anything an agent reads about billing or inbound.
const BANNED = /\b(Meta|Facebook)\b|Google(?! Pay)|\bper (call|appointment|booking)\b|\b(Standard|Premium) plan\b/i

// ── group 8: the estimate and its words ─────────────────────────────────────

test('estimateCount is floor(weekly / estimate) and 0 for no spend or no estimate', () => {
  assert.equal(h.estimateCount(25000, 5500), 4)
  assert.equal(h.estimateCount(5500, 5500), 1)
  assert.equal(h.estimateCount(5499, 5500), 0)
  assert.equal(h.estimateCount(11000, 5500), 2)
  assert.equal(h.estimateCount(0, 5500), 0)
  assert.equal(h.estimateCount(10000, 0), 0)
  assert.equal(h.estimateCount(10000, -5), 0)
})

test('aboutText says "about N a week", and "less than 1 a week" under one', () => {
  assert.equal(h.aboutText(4), 'about 4 a week')
  assert.equal(h.aboutText(1), 'about 1 a week')
  assert.equal(h.aboutText(0), 'less than 1 a week')
})

test('aboutInboundsText keeps "about" and the singular', () => {
  assert.equal(h.aboutInboundsText(1), 'about 1 inbound a week')
  assert.equal(h.aboutInboundsText(3), 'about 3 inbounds a week')
  assert.equal(h.aboutInboundsText(0), 'less than 1 inbound a week')
})

test('every estimate the panel prints is worded as an estimate, never a promise', () => {
  for (let n = 0; n <= 12; n++) {
    assert.match(h.aboutText(n), /^(about \d+ a week|less than 1 a week)$/)
    assert.match(h.aboutInboundsText(n), /^(about \d+ inbounds? a week|less than 1 inbound a week)$/)
  }
})

// ── next charge: the helper's sums ──────────────────────────────────────────

test('activeCents / activeCount add only types that are on (amount > 0 and not paused)', () => {
  const d = withTypes([10000, false, 1], [25000, true, 2])
  assert.equal(h.activeCents(d), 10000)
  assert.equal(h.activeCount(d), 1)
  assert.equal(h.activeCents(withTypes([10000, false, 1], [25000, false, 2])), 35000)
  assert.equal(h.activeCents(withTypes([10000, true, 1], [25000, true, 2])), 0)
  assert.equal(h.activeCents(data()), 0)
  assert.equal(h.activeCents(null), 0)
})

test('orderedTypes always returns live calls then booked appointments, filling a missing type', () => {
  const swapped = { types: [{ type: 'booked_appointment', weekly_cents: 9000 }, { type: 'live_call', weekly_cents: 5000 }] }
  assert.deepEqual(h.orderedTypes(swapped).map((t: any) => t.type), ['live_call', 'booked_appointment'])
  const only = h.orderedTypes({ types: [{ type: 'live_call', weekly_cents: 5000 }] })
  assert.deepEqual(only[1], { type: 'booked_appointment', label: 'Booked Appointments', weekly_cents: 0, paused: false, estimate_count: 0 })
  assert.equal(h.orderedTypes(null).length, 2)
})

test('rowKind: on, paused (keeps its amount), off', () => {
  assert.equal(h.rowKind({ weekly_cents: 10000, paused: false }), 'on')
  assert.equal(h.rowKind({ weekly_cents: 10000, paused: true }), 'paused')
  assert.equal(h.rowKind({ weekly_cents: 0, paused: false }), 'off')
  assert.equal(h.rowKind({ weekly_cents: 0, paused: true }), 'off')
})

// ── groups 2 and 3: which panel shows ───────────────────────────────────────

test('panelState: comped and not-billed never get controls, even with spend on file', () => {
  assert.equal(h.panelState(null), 'not_open')
  assert.equal(h.panelState(data({ configured: false })), 'not_open')
  assert.equal(h.panelState(withTypes([10000, false, 1], [0, false, 0], { comped: true })), 'comped')
  assert.equal(h.panelState(data({ billed: false })), 'comped')
})

test('panelState: a billed agent without a live subscription is told to start servicing', () => {
  assert.equal(h.panelState(data({ subscribed: false })), 'not_subscribed')
  assert.equal(h.panelState(withTypes([10000, false, 1], [0, false, 0], { subscribed: false })), 'not_subscribed')
})

test('panelState: spending, paused and empty', () => {
  assert.equal(h.panelState(withTypes([10000, false, 1], [0, false, 0])), 'spending')
  assert.equal(h.panelState(withTypes([10000, true, 1], [0, false, 0])), 'paused')
  assert.equal(h.panelState(data()), 'empty')
})

test('startCardKind: no card for comped or already spending; "start" or "paused" otherwise', () => {
  assert.equal(h.startCardKind(null), null)
  assert.equal(h.startCardKind(data({ configured: false })), null)
  assert.equal(h.startCardKind(data({ comped: true })), null)
  assert.equal(h.startCardKind(data({ billed: false })), null)
  assert.equal(h.startCardKind(withTypes([10000, false, 1], [0, false, 0])), null)
  assert.equal(h.startCardKind(withTypes([10000, true, 1], [0, false, 0])), 'paused')
  assert.equal(h.startCardKind(data()), 'start')
})

// ── amounts typed and shown ─────────────────────────────────────────────────

test('formatMoney shows whole dollars plain and keeps cents when there are some', () => {
  assert.equal(h.formatMoney(25000), '$250')
  assert.equal(h.formatMoney(29900), '$299')
  assert.equal(h.formatMoney(5050), '$50.50')
  assert.equal(h.formatMoney(0), '$0')
  assert.equal(h.formatMoney(undefined), '$0')
  assert.equal(h.formatMoney(1234500), '$12,345')
})

test('parseDollars turns typed whole dollars into cents and ignores everything else', () => {
  assert.equal(h.parseDollars('250'), 25000)
  assert.equal(h.parseDollars('$1,250'), 125000)
  assert.equal(h.parseDollars('abc'), null)
  assert.equal(h.parseDollars(''), null)
  assert.equal(h.parseDollars(null), null)
  assert.equal(h.digitsOnly('$12,3456789'), '123456')
})

test('initialAmount opens on the saved amount, else the middle preset', () => {
  const presets = [10000, 25000, 50000]
  assert.deepEqual(h.initialAmount(presets, 25000), { preset: 25000, custom: '' })
  assert.deepEqual(h.initialAmount(presets, 30000), { preset: null, custom: '300' })
  assert.deepEqual(h.initialAmount(presets, 0), { preset: 25000, custom: '' })
  assert.deepEqual(h.initialAmount([], 0), { preset: null, custom: '' })
})

test('plainError passes server sentences through and hides transport errors', () => {
  assert.equal(h.plainError('The weekly minimum is $50.00, or 0 for none.', 'Try again.'), 'The weekly minimum is $50.00, or 0 for none.')
  assert.equal(h.plainError('Failed to fetch', 'Try again.'), 'Try again.')
  assert.equal(h.plainError('Edge Function returned a non-2xx status code', 'Try again.'), 'Try again.')
  assert.equal(h.plainError('', 'Try again.'), 'Try again.')
})

// ── group 9 (the words the helper itself carries) ───────────────────────────

test('wording: nothing the helper exports names Meta, Google, Facebook, tiers or per-call pricing', () => {
  const strings: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') strings.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  for (const v of Object.values(h)) if (typeof v !== 'function') walk(v)
  for (let n = 0; n <= 12; n++) strings.push(h.aboutText(n), h.aboutInboundsText(n))
  for (const c of [0, 5000, 25000, 1234500]) strings.push(h.formatMoney(c))
  assert.ok(strings.length > 20, 'the scan found the helper strings')
  for (const s of strings) assert.doesNotMatch(s, BANNED, s)
})
