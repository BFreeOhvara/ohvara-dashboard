// P972 — phone app round 3: the backdrop runs to the very top (no band), Search is a normal page, every slide-in
// screen swipes away the way it came with the screen under it peeking in, bottom sheets pull down, Notifications /
// Clients / Activity / Billing / Help are built out, chat bubbles are narrower with tails, and the keyboard drops.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { routeOf, parentOf, nestedOf, screenKey, backCloses, sheetCloses, kindOfActivity, dayOf, groupByDay, runsOf, last4, OWN_BAR, QUERY_SUBS } from './template/m/appModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
const css = read('./template/m/app.css')

// P974 went further: no strip and no blur at all (p974.test.js); the scroller still runs from the top of the screen.
test('no band at the top: the sub-screen scroller runs from the top of the screen', () => {
  assert.match(css, /\.ma-subpage \.ma-sub-scroll \{[^}]*inset: 0;/)
})

test('Search: no keyboard on open, no bottom bar, a big title that scrolls away', () => {
  const s = read('./template/m/ASubs.jsx')
  assert.doesNotMatch(s, /autoFocus/)
  assert.match(s, /<SubPage big title="Search"/)
  assert.ok(OWN_BAR.includes('search'))
  assert.ok(read('./template/m/AppKit.jsx').includes('className={`ma-back ma-press')) // P982: the plain back arrow is back
})

test('layer stack: a nested screen has its parent under it (the peek), with one key on top or under', () => {
  const r = routeOf('/agent/clients/c1', '')
  assert.deepEqual(parentOf(r, ''), { sub: 'clients', id: null, nested: '' })
  const t = routeOf('/agent/clients/c1', '?s=thread&t=th1')
  assert.equal(t.sub, 'thread')
  assert.deepEqual(parentOf(t, '?s=thread&t=th1'), { sub: 'clients', id: 'c1', nested: '' })
  const z = routeOf('/agent/settings', '?set=zone')
  assert.equal(nestedOf(z, '?set=zone'), 'zone')
  assert.deepEqual(parentOf(z, '?set=zone'), { sub: 'settings', id: null, nested: '' })
  assert.equal(nestedOf(routeOf('/agent/billing', '?full=1'), '?full=1'), 'full')
  assert.equal(parentOf(routeOf('/agent/settings', ''), ''), null)
  assert.equal(screenKey('clients', null), screenKey('clients', '', ''))
  assert.ok(QUERY_SUBS.includes('help'))
})

test('swipe back: a flick or past 35 % closes, less springs back; sheets close on a flick or a quarter', () => {
  assert.equal(backCloses(150, 0.05, 390), true) // 38 %
  assert.equal(backCloses(100, 0.05, 390), false) // 26 %, slow
  assert.equal(backCloses(60, 0.6, 390), true) // flick
  assert.equal(backCloses(8, 2, 390), false) // a twitch
  assert.equal(backCloses(60, -0.6, 390), false) // finger turned back
  assert.equal(sheetCloses(130, 0.1, 500), true)
  assert.equal(sheetCloses(60, 0.1, 500), false)
  assert.equal(sheetCloses(40, 0.8, 500), true)
  const h = read('./template/m/useBackSwipe.js')
  assert.match(h, /passive: false/)
  assert.match(h, /g\.mode = 'scroll'/)
  assert.match(h, /PEEK = 0\.28/)
  const f = read('./template/m/MobileFrame.jsx')
  assert.match(f, /useBackSwipe\(\{ layerRef: topRef, underOf: underR, dir: 1/)
  assert.match(f, /useBackSwipe\(\{ layerRef: notifRef, underOf: underL, scrimRef, dir: -1/)
  assert.match(read('./template/m/AppKit.jsx'), /useSheetDrag\(\{ sheetRef: sheet, scrimRef: scrim, onClose/)
  // The slide-in plays only on arrival and never holds a transform (so the swipe can move the layer).
  assert.match(css, /\.ma-layer-r\.is-enter \{ animation: maFromRight \.42s var\(--ma-ease\) backwards; \}/)
  assert.match(css, /animation: maSheet \.42s var\(--ma-ease\) backwards/)
})

test('notifications and activity: kinds, day groups', () => {
  assert.equal(kindOfActivity({ text: 'Chargeback risk: the payment didn’t go through.' }), 'risk')
  assert.equal(kindOfActivity({ text: 'Packet check done. Review call set.' }), 'packet')
  assert.equal(kindOfActivity({ text: 'Missed live call. The team is booking her.' }), 'live')
  assert.equal(kindOfActivity({ text: 'New lead assigned to you. Appointment booked.' }), 'booking')
  assert.equal(kindOfActivity({ text: 'Sold. Ready to submit for servicing.' }), 'sold')
  assert.equal(kindOfActivity({ text: 'Marked not sold.', kind: 'moved' }), 'moved')
  assert.equal(kindOfActivity({ text: 'The team texted Gloria.', kind: 'text' }), 'message')
  assert.deepEqual(dayOf('Today, 9:40 AM'), { group: 'today', time: '9:40 AM', day: 'Today' })
  assert.deepEqual(dayOf('Yesterday, 11:02 AM'), { group: 'yesterday', time: '11:02 AM', day: 'Yesterday' })
  assert.deepEqual(dayOf('Fri, Oct 30'), { group: 'earlier', time: '', day: 'Fri, Oct 30' })
  const g = groupByDay([{ group: 'earlier' }, { group: 'today' }])
  assert.deepEqual(g.map(x => x.key), ['today', 'earlier'])
  const n = read('./template/m/ANotes.jsx')
  assert.match(n, /Mark all read/)
  assert.match(n, /No notifications/)
})

test('chat: runs, tails only on the last bubble, bubbles at most 78 % wide', () => {
  const who = m => m.who || 'team'
  const r = runsOf([{ from: 'team' }, { from: 'team' }, { from: 'me' }, { from: 'me' }, { from: 'team', who: 'Ana' }], who)
  assert.deepEqual(r.map(x => [x.first, x.last]), [[true, false], [false, true], [true, false], [false, true], [true, true]])
  assert.match(css, /\.ma-chat \.ma-msg \{[^}]*max-width: 78%/)
  assert.match(css, /\.ma-bub\.has-tail::after \{/)
  const m = read('./template/m/useKeyboard.js') // P975: the keyboard hook moved out so the VA chat shares it
  assert.match(read('./template/m/AMessages.jsx'), /useKeyboard\(root, input\)/)
  assert.match(m, /inputRef\.current\.blur\(\)/) // drag down / tap off drops the keyboard
  assert.match(m, /--ma-kb/)
})

test('client screen: hero, policy (last 4 only), what the team is doing, timeline, message the team', () => {
  assert.equal(last4('SAMPLE-1001'), '•• 1001')
  assert.equal(last4(''), '')
  const c = read('./template/m/AClient.jsx')
  for (const s of ['ma-hero', 'What our team is doing', 'Policy', 'Timeline', 'Message the team about']) assert.ok(c.includes(s), s) // P974: "What happened" is now "Timeline"
  assert.match(read('./template/m/MobileFrame.jsx'), /route\.id \? <AClient id=\{route\.id\} \/> : <AClients \/>/)
})
