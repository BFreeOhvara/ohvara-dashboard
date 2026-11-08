import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sampleState, sampleActions, bookAfterSale, agentBooksCall, rotaOf } from './data.js'
import { typeOfKind, CALL_TYPES } from './bookings.js'
import { WINDOWS, minuteOf, zoneOf } from '../../lib/callSlots.js'

// P907 — everything moves in bookings. Every call kind books itself on the sample data: the next open time in the
// client's window, on their clock, with a VA who is free; a move logs the client's confirmation text.
const clientOf = (s, t) => (t.client_id ? s.clients.find(c => c.id === t.client_id) : t.who)
const weekday = (iso, tz) => !['Sat', 'Sun'].includes(new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' }))

test('each call type is on the sample data', () => {
  const s = sampleState()
  const types = new Set([...s.tasks.map(t => typeOfKind(t.kind)).filter(Boolean), ...(s.calls.length ? ['cancel_old'] : [])])
  for (const k of Object.keys(CALL_TYPES)) assert.ok(types.has(k), `${k} is booked somewhere`)
})

test('every seeded booking sits in the client\'s window, on their clock, on a weekday', () => {
  const s = sampleState()
  const booked = s.tasks.filter(t => t.iso && t.window && t.status !== 'done')
  assert.ok(booked.length >= 10, `${booked.length} booked`)
  for (const t of booked) {
    const c = clientOf(s, t)
    const tz = zoneOf(c.state, c.city)
    assert.equal(t.tz, tz, `${t.id} uses the client's zone`)
    assert.ok(weekday(t.iso, tz), `${t.id} weekday`)
    assert.ok(t.va_id, `${t.id} has a VA`)
    if (t.inWindow !== false) {
      const m = minuteOf(t.iso, tz)
      const w = WINDOWS[t.window]
      assert.ok(m >= w.from && m < w.to, `${t.id} ${m} in ${t.window}`)
    }
  }
})

test('the window the client answered in wins; no window means afternoon', () => {
  const s = sampleState()
  const welcome = s.tasks.find(t => t.id === 'st-13') // Maria, best window Evening
  assert.equal(welcome.window, 'evening')
  const save = s.tasks.find(t => t.id === 'st-11') // Ann answered in the morning before
  assert.equal(save.window, 'morning')
  const change = s.tasks.find(t => t.id === 'st-4') // no window on file
  assert.equal(change.window, 'afternoon')
})

test('a missed call books a callback; moving it logs the confirmation text', () => {
  const act = sampleActions()
  act.bookCallback({ name: 'Test Caller', phone: '(512) 555-0100', city: 'Austin', state: 'TX', why: 'missed_call' })
  let s = sampleState()
  const cb = s.tasks.find(t => t.kind === 'callback' && t.who?.name === 'Test Caller')
  assert.ok(cb?.iso && cb.va_id, 'booked')
  assert.equal(cb.tz, 'America/Chicago')
  const later = new Date(Date.parse(cb.iso) + 86400000).toISOString()
  act.moveTask(cb.id, later, 'va-maya')
  s = sampleState()
  assert.equal(s.tasks.find(t => t.id === cb.id).iso, later)
  const txt = s.texts.at(-1)
  assert.equal(txt.ref, cb.id)
  assert.match(txt.text, /Reply C to change it/)
})

test('a sale books the hand-off in the picked window, and the old-policy cancel before its draft', () => {
  const out = bookAfterSale({ who: 'Ruth Ellison', state: 'FL', city: 'Miami', carrier: 'Americo', window: 'Morning', replaces: { carrier: 'Globe Life', draftDay: 20 } })
  assert.ok(out.handoff, 'hand-off booked')
  const m = minuteOf(out.handoff.iso, 'America/New_York')
  assert.ok(m >= WINDOWS.morning.from && m < WINDOWS.morning.to || !out.handoff.inWindow)
  assert.ok(out.cancel && out.cancel.beforeDraft, 'cancel booked before the old draft')
  assert.ok(out.cancel.iso > out.handoff.iso, 'cancel comes after the hand-off')
})

test('an exact time is kept; an agent window request is booked, never left unassigned', () => {
  const ex = bookAfterSale({ who: 'Paul Exact', state: 'TX', city: 'Austin', exact: { iso: '2026-11-06T16:30:00.000Z', tz: 'America/Chicago', vaId: 'va-maya' } })
  assert.equal(ex.handoff.iso, '2026-11-06T16:30:00.000Z')
  const va = agentBooksCall({ who: 'Ana Ruiz', kind: 'service', mode: 'window', window: 'Weekday mornings', request: 'address_change' })
  assert.ok(va?.id, 'a VA got it')
})

test('a VA on shift is always the one booked', () => {
  const s = sampleState()
  for (const t of s.tasks.filter(x => x.iso && x.va_id && x.status !== 'done')) {
    const d = Number(new Date(t.iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', day: 'numeric' }))
    if (rotaOf(d).length) assert.ok(rotaOf(d).some(v => v.id === t.va_id), `${t.id} VA on shift day ${d}`)
  }
})
