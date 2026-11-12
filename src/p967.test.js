// P967 — the agent phone app rebuilt from the approved mockup: tabs you swipe between, sub-screens over them, the
// four lead stages, a real month, the bell. These are the app's rules (template/m/appModel.js) and its must-haves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TABS, OWN_BAR, routeOf, baseTab, nextTab, isSwipe, untilWords, minutesOf, greeting, monthGrid, trimGrid, shiftMonth, dayWords, shortDay, unseenCount, markSeen, inStage, TONE, RESULT } from './template/m/appModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('five tabs in order; the bar hides on a lead, a chat, Submit and Import', () => {
  assert.deepEqual(TABS, ['home', 'leads', 'calendar', 'messages', 'account'])
  assert.deepEqual(OWN_BAR, ['lead', 'thread', 'submit', 'import', 'search']) // P972: Search hides the bar too
})

test('routes: the portal addresses on both the real and the template paths', () => {
  assert.deepEqual(routeOf('/agent'), { tab: 'home', sub: null, id: null, over: null, overId: null })
  assert.equal(routeOf('/agent/leads').tab, 'leads')
  assert.deepEqual(routeOf('/agent/inbounds/abc'), { tab: null, sub: 'lead', id: 'abc', over: null, overId: null })
  assert.deepEqual(routeOf('/leads/abc'), { tab: null, sub: 'lead', id: 'abc', over: null, overId: null })
  assert.equal(routeOf('/messages').tab, 'messages')
  assert.equal(routeOf('/agent/more').tab, 'account')
  assert.equal(routeOf('/settings').sub, 'settings')
  assert.deepEqual(routeOf('/agent/clients/c1'), { tab: null, sub: 'clients', id: 'c1', over: null, overId: null })
  assert.equal(routeOf('/agent/request-service').sub, 'clients')
  assert.equal(routeOf('/agent/billing').sub, 'billing')
  assert.equal(routeOf('/agent/submit', '?lead=l1').sub, 'submit')
  const t = routeOf('/messages', '?s=thread&t=th9')
  assert.equal(t.sub, 'thread'); assert.equal(t.id, 'th9'); assert.equal(t.tab, 'messages')
  const over = routeOf('/agent/clients', '?s=search')
  assert.equal(over.sub, 'search'); assert.equal(over.over, 'clients')
  assert.equal(routeOf('/agent', '?s=bogus').sub, null)
})

test('the tab under a sub-screen: the one it came from, else its own', () => {
  assert.equal(baseTab(routeOf('/agent/inbounds/x'), 'calendar'), 'calendar')
  assert.equal(baseTab(routeOf('/agent/inbounds/x'), undefined), 'leads')
  assert.equal(baseTab(routeOf('/agent/billing'), undefined), 'account')
  assert.equal(baseTab(routeOf('/agent', '?s=notif'), undefined), 'home')
})

test('swipe: one tab over, never past the ends, and only a clear sideways move', () => {
  assert.equal(nextTab(0, -80), 1)
  assert.equal(nextTab(0, 80), 0)
  assert.equal(nextTab(4, -80), 4)
  assert.equal(nextTab(2, 80), 1)
  assert.equal(isSwipe(80, 10), true)
  assert.equal(isSwipe(30, 2), false)
  assert.equal(isSwipe(80, 90), false)
})

test('words: Up next countdown, times, greeting', () => {
  assert.equal(untilWords(76), 'in 1 h 16 m')
  assert.equal(untilWords(40), 'in 40 m')
  assert.equal(untilWords(0), 'now')
  assert.equal(minutesOf('2:30 PM'), 870)
  assert.equal(minutesOf('12:05 AM'), 5)
  assert.equal(greeting(9), 'Good morning')
  assert.equal(greeting(14), 'Good afternoon')
  assert.equal(greeting(19), 'Good evening')
})

test('a real month, Monday first', () => {
  const nov = monthGrid(2026, 11) // Nov 1 2026 is a Sunday
  assert.equal(nov.length, 42)
  assert.equal(nov[6].iso, '2026-11-01')
  assert.equal(nov[0].inMonth, false)
  assert.equal(trimGrid(monthGrid(2026, 2)).length, 35)
  assert.deepEqual(shiftMonth(2026, 12, 1), [2027, 1])
  assert.deepEqual(shiftMonth(2026, 1, -1), [2025, 12])
  assert.equal(dayWords('2026-11-11', '2026-11-11'), 'Today, Nov 11')
  assert.equal(shortDay('2026-11-12', '2026-11-11'), 'Tomorrow')
})

test('stages: colours, Sold shows closed only when asked, "Not sold" wording', () => {
  assert.deepEqual(TONE, { mark: 'apricot', booked: 'sky', follow: 'butter', sold: 'sage', lost: 'stone' })
  assert.equal(inStage('lost', 'sold'), false)
  assert.equal(inStage('lost', 'sold', true), true)
  assert.equal(RESULT.not_interested.label, 'Not sold')
})

test('the bell: unseen until opened', () => {
  assert.equal(unseenCount(['a', 'b'], []), 2)
  const seen = markSeen(['a', 'b'], [])
  assert.equal(unseenCount(['a', 'b', 'c'], seen), 1)
})

test('the frame: old top bar, + button and old tab bar gone; sample line kept off test accounts', () => {
  const f = read('./template/m/MobileFrame.jsx')
  assert.doesNotMatch(f, /mx-fab|mx-tabs|mx-top/)
  assert.match(f, /!isTest && source === 'sample'/)
  assert.match(f, /useTabSwipe\(\{ viewRef, trackRef, barRef/) // P971: the bar's highlight follows the swipe
  assert.match(f, /<SupportProvider>/)
})

test('motion respects reduced motion; touch targets and safe areas', () => {
  const css = read('./template/m/app.css')
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /env\(safe-area-inset-bottom/)
  assert.match(css, /env\(safe-area-inset-top/)
  assert.match(css, /\.ma-tabbar \{[^}]*height: 62px/)
})

test('no payments in the phone app: Billing slider is read-only in the native app', () => {
  const b = read('./template/m/ABilling.jsx')
  assert.match(b, /disabled=\{native\}/)
  assert.match(b, /NATIVE_BILLING_TEXT/)
})

test('Settings has everything, including Sign out and Delete account', () => {
  const s = read('./template/m/ASettings.jsx')
  for (const k of ['profile', 'licence', 'calls', 'email', 'alerts', 'receipts', 'password']) assert.match(s, new RegExp(`'${k}'`))
  assert.match(s, /Sign out/)
  assert.match(s, /Delete account/)
  assert.match(s, /DeleteDialog/)
})
