import test from 'node:test'
import assert from 'node:assert/strict'
import { nextSlot, preferredWindow, windowKey, windowOfMinute, instantOf, clockOf, dateOf } from './callSlots.js'

// P907 — every VA call books itself: the next open slot in the client's window, on the client's clock.
const CT = 'America/Chicago', ET = 'America/New_York', PT = 'America/Los_Angeles'
const crew = [{ id: 'a', name: 'A', tz: CT }, { id: 'b', name: 'B', tz: CT }]
const weekday = iso => new Date(iso).getUTCDay() // Nov 2026: Thu 5, Fri 6, Sat 7, Sun 8, Mon 9
const team = iso => ([0, 6].includes(weekday(iso)) ? [] : crew)
const from = instantOf('2026-11-05', '1:32 PM', CT)

test('window words', () => {
  assert.equal(windowKey('Mornings'), 'morning')
  assert.equal(windowKey('Evening'), 'evening')
  assert.equal(windowKey('soon'), null)
  assert.equal(preferredWindow(null, 'Evenings'), 'evening')
  assert.equal(preferredWindow('', null), 'afternoon')
  assert.equal(windowOfMinute(9 * 60), 'morning')
  assert.equal(windowOfMinute(21 * 60), null)
})

test('afternoon books the next open half hour after now, on the client clock', () => {
  const s = nextSlot({ from, window: 'afternoon', clientTz: ET, team })
  assert.equal(clockOf(s.iso, ET), '3:00 PM') // 2:00 PM CT is 3:00 PM ET, the first slot after 1:32 PM CT
  assert.equal(s.inWindow, true)
})

test('morning after the morning has passed goes to tomorrow morning', () => {
  const s = nextSlot({ from, window: 'morning', clientTz: CT, team })
  assert.equal(dateOf(s.iso, CT), '2026-11-06')
  assert.equal(clockOf(s.iso, CT), '8:00 AM')
})

test('a weekend is skipped (nobody on shift)', () => {
  const fri = instantOf('2026-11-06', '5:45 PM', CT)
  const s = nextSlot({ from: fri, window: 'morning', clientTz: CT, team })
  assert.equal(dateOf(s.iso, CT), '2026-11-09')
})

test('busy VAs push it to the next free time', () => {
  const at = instantOf('2026-11-05', '2:00 PM', CT)
  const calls = [{ id: 'x', va_id: 'a', iso: at }, { id: 'y', va_id: 'b', iso: at }]
  const s = nextSlot({ from, window: 'afternoon', clientTz: CT, team, calls })
  assert.equal(clockOf(s.iso, CT), '2:30 PM')
})

test('an exact time that is free is kept; a taken one moves to the next open in its window', () => {
  const ok = nextSlot({ from, exact: '4:00 PM', date: '2026-11-05', clientTz: CT, team })
  assert.equal(clockOf(ok.iso, CT), '4:00 PM')
  const at = instantOf('2026-11-05', '4:00 PM', CT)
  const calls = [{ id: 'x', va_id: 'a', iso: at }, { id: 'y', va_id: 'b', iso: at }]
  const moved = nextSlot({ from, exact: '4:00 PM', date: '2026-11-05', clientTz: CT, team, calls })
  assert.equal(clockOf(moved.iso, CT), '4:30 PM')
})

test('a Pacific evening is outside every shift: booked at the next open time, flagged', () => {
  const s = nextSlot({ from, window: 'evening', clientTz: PT, team })
  assert.equal(s.inWindow, false)
  assert.ok(s.iso >= from)
})

test('before: a cancellation must land before the old draft', () => {
  const before = instantOf('2026-11-05', '3:00 PM', CT)
  const s = nextSlot({ from, window: 'morning', clientTz: CT, team, before })
  assert.ok(s.iso < before)
})

test('no zone, no booking', () => {
  assert.equal(nextSlot({ from, clientTz: null, team }), null)
})
