import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickVa, rotaOf, agentBooksCall, VAS } from '../template/ful/data.js'
import { dayOptions, timeOptions } from '../template/selectOptions.js'

// P847 — an agent's exact-time booking goes to a VA on shift then (sample auto-assign).
test('pickVa only picks someone on shift that day', () => {
  for (const day of [2, 3, 4, 5, 6, 9, 10]) {
    const on = rotaOf(day).map(v => v.id)
    assert.ok(on.includes(pickVa(day, '10:00 AM').id), `day ${day}`)
  }
})

test('pickVa skips a VA already on a call at that minute and prefers the lighter day', () => {
  // Tue 3: Leo, Sasha, Devon on. Devon has the lightest sample load.
  assert.equal(pickVa(3, '10:00 AM').id, 'va-devon')
  const busy = [{ day: 3, time: '10:00 AM', va_id: 'va-devon' }]
  assert.notEqual(pickVa(3, '10:00 AM', [], busy).id, 'va-devon')
})

test('nobody on shift falls back to the whole team (nothing sits unassigned)', () => {
  assert.equal(rotaOf(7).length, 0)
  assert.ok(VAS.some(v => v.id === pickVa(7, '10:00 AM').id))
})

// P907: a best-time window is booked too (the next open time in it); an exact time keeps its time.
test('a best-time window is booked by the system; an exact time is kept', () => {
  assert.ok(agentBooksCall({ who: 'Ana Ruiz', kind: 'cancellation', mode: 'window', window: 'Weekday mornings' })?.id)
  const va = agentBooksCall({ who: 'Ana Ruiz', kind: 'cancellation', mode: 'exact', day: 6, time: '11:00 AM', oldCarrier: 'Globe Life' })
  assert.ok(rotaOf(6).some(v => v.id === va.id))
})

test('the day and time dropdowns give the old datetime-local string shape', () => {
  const days = dayOptions(3, new Date(2026, 10, 5))
  assert.deepEqual(days.map(d => d.value), ['2026-11-05', '2026-11-06', '2026-11-07'])
  assert.equal(days[0].label, 'Today')
  const times = timeOptions(8, 9)
  assert.deepEqual(times.map(t => [t.value, t.label]), [['08:00', '8:00 AM'], ['08:30', '8:30 AM'], ['09:00', '9:00 AM']])
  assert.ok(!Number.isNaN(new Date(`${days[1].value}T${times[1].value}`).getTime()))
})
