// Get inbounds helpers.
//   node --test src/lib/billingInbound.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatMoney, estimateCount, aboutText, aboutInboundsText, parseDollars, digitsOnly, orderedTypes, rowKind,
  activeCents, activeCount, pausedTypes, panelState, startCardKind, initialAmount, plainError,
} from './billingInbound.js'

const LIVE = { type: 'live_call', label: 'Live Calls', weekly_cents: 40000, paused: false, estimate_count: 7 }
const APPT = { type: 'booked_appointment', label: 'Booked Appointments', weekly_cents: 30000, paused: false, estimate_count: 3 }
const base = { configured: true, comped: false, billed: true, subscribed: true, types: [LIVE, APPT] }
const none = { ...base, types: [{ ...LIVE, weekly_cents: 0, estimate_count: 0 }, { ...APPT, weekly_cents: 0, estimate_count: 0 }] }
const allPaused = { ...base, types: [{ ...LIVE, paused: true }, { ...APPT, paused: true }] }

test('money reads as whole dollars unless there are cents', () => {
  assert.equal(formatMoney(40000), '$400')
  assert.equal(formatMoney(120000), '$1,200')
  assert.equal(formatMoney(1250), '$12.50')
  assert.equal(formatMoney(0), '$0')
})

test('the estimate rounds down and matches the sample data', () => {
  assert.equal(estimateCount(40000, 5500), 7)
  assert.equal(estimateCount(60000, 5500), 10)
  assert.equal(estimateCount(30000, 9000), 3)
  assert.equal(estimateCount(50000, 9000), 5)
  assert.equal(estimateCount(40000, 0), 0)
})

test('about lines', () => {
  assert.equal(aboutText(7), 'about 7 a week')
  assert.equal(aboutText(0), 'less than 1 a week')
  assert.equal(aboutInboundsText(10), 'about 10 inbounds a week')
  assert.equal(aboutInboundsText(1), 'about 1 inbound a week')
  assert.equal(aboutInboundsText(0), 'less than 1 inbound a week')
})

test('the custom box takes whole dollars', () => {
  assert.equal(parseDollars('500'), 50000)
  assert.equal(parseDollars('$1,000'), 100000)
  assert.equal(parseDollars(''), null)
  assert.equal(parseDollars('abc'), null)
  assert.equal(digitsOnly('$1,000x'), '1000')
  assert.equal(digitsOnly('12345678'), '123456')
})

test('types come back in a fixed order and missing ones are empty', () => {
  assert.deepEqual(orderedTypes({ types: [APPT, LIVE] }).map(t => t.type), ['live_call', 'booked_appointment'])
  const [live, appt] = orderedTypes({ types: [APPT] })
  assert.equal(live.weekly_cents, 0)
  assert.equal(appt.weekly_cents, 30000)
})

test('totals count only what is running', () => {
  const one = { ...base, types: [LIVE, { ...APPT, paused: true }] }
  assert.equal(activeCents(base), 70000)
  assert.equal(activeCount(base), 10)
  assert.equal(activeCents(one), 40000)
  assert.equal(activeCount(one), 7)
  assert.deepEqual(pausedTypes(one).map(t => t.type), ['booked_appointment'])
  assert.equal(rowKind(LIVE), 'on')
  assert.equal(rowKind({ ...LIVE, paused: true }), 'paused')
  assert.equal(rowKind({ ...LIVE, weekly_cents: 0, paused: true }), 'off')
})

test('panel state, in order', () => {
  assert.equal(panelState({ ...base, configured: false }), 'not_open')
  assert.equal(panelState({ ...base, comped: true, billed: false }), 'comped')
  assert.equal(panelState({ ...base, comped: false, billed: false }), 'comped')
  assert.equal(panelState({ ...none, subscribed: false }), 'not_subscribed')
  assert.equal(panelState(none), 'empty')
  assert.equal(panelState(allPaused), 'paused')
  assert.equal(panelState(base), 'spending')
})

test('Start card shows only at zero active spend on a billed, configured account', () => {
  assert.equal(startCardKind(undefined), null)
  assert.equal(startCardKind(base), null)
  assert.equal(startCardKind(none), 'start')
  assert.equal(startCardKind({ ...none, subscribed: false }), 'start')
  assert.equal(startCardKind(allPaused), 'paused')
  assert.equal(startCardKind({ ...none, comped: true, billed: false }), null)
  assert.equal(startCardKind({ ...none, configured: false }), null)
})

test('the sheet opens on what is saved, else the middle preset', () => {
  const presets = [10000, 20000, 30000, 40000, 60000, 80000]
  assert.deepEqual(initialAmount(presets, 30000), { preset: 30000, custom: '' })
  assert.deepEqual(initialAmount(presets, 50000), { preset: null, custom: '500' })
  assert.deepEqual(initialAmount(presets, 0), { preset: 40000, custom: '' })
  assert.deepEqual(initialAmount([], 0), { preset: null, custom: '' })
})

test('server messages pass through word for word, transport errors do not', () => {
  assert.equal(plainError('Inbound spend is test mode only for now.', 'x'), 'Inbound spend is test mode only for now.')
  assert.equal(plainError('Edge Function returned a non-2xx status code', 'x'), 'x')
  assert.equal(plainError('Failed to send a request to the Edge Function', 'x'), 'x')
  assert.equal(plainError('Unknown action: inbound_get', 'x'), 'x')
  assert.equal(plainError('', 'x'), 'x')
})
