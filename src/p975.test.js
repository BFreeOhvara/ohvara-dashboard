// P975 — the fulfillment (VA) phone app from the approved mockup: five tabs, the day sheet, the call brief, the call
// screen on the desk's own calling stack, and a result sheet that can't be closed without a pick.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VA_TABS, VA_OWN_BAR, vaRouteOf, stateOf, GRACE_MS, OUTCOMES, outcomePlan, nextTry, weekCards, monthCells, hourRows, holdTitle, callTimer, onShiftWords } from './template/m/va/vaModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('five tabs in the mockup order; a chat, search and a client hide the bar', () => {
  assert.deepEqual(VA_TABS, ['today', 'calendar', 'rota', 'messages', 'me'])
  assert.deepEqual(VA_OWN_BAR, ['thread', 'search', 'client'])
})

test('routes: the VA addresses land on the right tab or screen', () => {
  assert.equal(vaRouteOf('/fulfillment').tab, 'today')
  assert.equal(vaRouteOf('/fulfillment/messages').tab, 'messages')
  assert.equal(vaRouteOf('/fulfillment/calendar').tab, 'calendar')
  assert.equal(vaRouteOf('/fulfillment/calendar/c-1').brief, 'c-1')
  assert.equal(vaRouteOf('/fulfillment/schedule').tab, 'rota')
  assert.equal(vaRouteOf('/fulfillment/more').tab, 'me')
  assert.deepEqual([vaRouteOf('/fulfillment/pay').tab, vaRouteOf('/fulfillment/pay').sub], ['me', 'pay'])
  assert.equal(vaRouteOf('/fulfillment', '?s=thread&t=th1').id, 'th1')
})

test('a call: done, no answer, to call, or needs a result 30 minutes past its time', () => {
  const at = Date.parse('2026-11-05T15:00:00Z')
  const it = { iso: '2026-11-05T15:00:00Z' }
  assert.equal(stateOf({ ...it, done: true }, at + GRACE_MS * 2), 'done')
  assert.equal(stateOf({ ...it, state: 'no_answer' }, at + GRACE_MS * 2), 'noanswer')
  assert.equal(stateOf(it, at), 'todo')
  assert.equal(stateOf(it, at + GRACE_MS), 'open')
})

test('the result sheet: the five picks, each saved with the desk\'s own actions', () => {
  assert.deepEqual(OUTCOMES.map(o => o.key), ['done', 'saved', 'no_answer', 'rebook', 'agent'])
  const call = { kind: 'call', ref: 'c1', iso: '2026-11-06T15:00:00Z' }
  assert.equal(outcomePlan(call, 'done').run[0][0], 'markCall')
  assert.deepEqual(outcomePlan(call, 'no_answer').run[0].slice(0, 3), ['markCall', 'c1', 'no_answer'])
  assert.equal(outcomePlan(call, 'rebook').run[0][0], 'moveCall')
  assert.ok(outcomePlan(call, 'agent').run.some(r => r[0] === 'tellAgent'))
  const task = { kind: 'task', ref: 't1', iso: '2026-11-06T15:00:00Z', row: { kind: 'lapse_save' } }
  assert.deepEqual(outcomePlan(task, 'saved').run[0], ['finishTask', 't1', 'saved'])
  assert.equal(outcomePlan(task, 'rebook').run[0][0], 'moveTask')
  assert.equal(outcomePlan(null, 'no_answer').run[0][0], 'bookCallback')
})

test('Book a new time skips the weekend', () => {
  // Friday Nov 6 2026 → Monday Nov 9
  assert.equal(nextTry('2026-11-06T15:00:00Z').slice(0, 10), '2026-11-09')
})

test('Rota: seven cards a week, you first, the weekend marked', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map(date => ({ date, vas: [{ id: 'b', name: 'Leo Grant' }, { id: 'a', name: 'Me', me: true }] }))
  const cards = weekCards(days, '2026-11-05')
  assert.equal(cards.length, 7)
  assert.ok(cards[0].people[0].me)
  assert.deepEqual(cards.slice(5).map(c => c.weekend), [true, true])
  assert.ok(cards[3].today && cards[0].past)
})

test('Calendar: call counts, today, past and days off; the Now line in its hour', () => {
  const cells = monthCells(2026, 11, { byDate: { '2026-11-05': [1, 2, 3] }, todayIso: '2026-11-05', offDates: ['2026-11-12'] })
  const c5 = cells.find(c => c.iso === '2026-11-05')
  assert.equal(c5.count, 3); assert.ok(c5.today)
  assert.ok(cells.find(c => c.iso === '2026-11-12').off)
  assert.ok(cells.find(c => c.iso === '2026-11-02').past)
  const rows = hourRows([], { today: true, nowMin: 13 * 60 + 32 })
  assert.equal(rows.filter(r => r.now).length, 1)
  assert.equal(rows.find(r => r.now).h, 13)
})

test('words: the hold line, the timer, on-shift', () => {
  assert.equal(holdTitle(2, 100), '2 clients on hold · longest 1:40')
  assert.equal(callTimer(65000), '1:05')
  assert.ok(onShiftWords(13 * 60))
})

test('the call screen uses the desk\'s calling stack, not a second one', () => {
  const src = read('./template/m/va/VCall.jsx')
  assert.match(src, /from '\.\.\/\.\.\/ful\/callLine'/)
  assert.match(src, /useRealLine/)
  for (const w of ['Mute', 'Keypad', 'Speaker', 'Add', 'Hold', 'Notes']) // P982: Add (+) replaced Add carrier
    assert.ok(src.includes(`'${w}'`) || src.includes(`/>${w}</`), w) // P986: Keypad is a small text button now
})

test('the result sheet has no close: the scrim and Escape only shake it', () => {
  const src = read('./template/m/va/VCall.jsx')
  const sheet = src.slice(src.indexOf('function ResultSheet'))
  assert.doesNotMatch(sheet.slice(0, sheet.indexOf('\n}\n')), /BottomSheet|onClose/)
  assert.match(sheet, /Escape/)
})

test('below 768 px the VA side is the phone app; the desktop frame is untouched', () => {
  const f = read('./template/m/va/VaFrame.jsx')
  assert.match(f, /usePhone\(\) \? <VaApp \/> : <FulFrame \/>/)
  assert.match(read('./fulshell/FulfillShell.jsx'), /<VaShellFrame \/>/)
  assert.match(read('./template/TemplateApp.jsx'), /<VaShellFrame \/>/)
})

test('every scroller scrolls up and down only', () => {
  assert.match(read('./template/m/va/va.css'), /touch-action: pan-y/)
})
