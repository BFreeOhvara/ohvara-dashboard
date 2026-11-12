// P971 — phone app fixes after Brayden's first real try: the swipe follows the finger and snaps with its speed,
// slide-in screens have a pinned header, pages end just above the bar, View all is coloured, the bar avatar keeps
// the Account card's blue, Account's three stats are equal tiles, and Settings is grouped rows with values.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { swipeTarget, rubber, velocityOf, chargeStat, weekWords } from './template/m/appModel.js'

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('swipe: a flick switches even when short, a slow drag past 35 % switches, less springs back', () => {
  const w = 390
  assert.equal(swipeTarget(0, -60, -0.9, w), 1) // quick flick left
  assert.equal(swipeTarget(1, 50, 0.6, w), 0) // quick flick right
  assert.equal(swipeTarget(0, -100, -0.05, w), 0) // slow, 25 %: back
  assert.equal(swipeTarget(0, -150, -0.05, w), 1) // slow, 38 %: over
  assert.equal(swipeTarget(2, -60, 0.8, w), 2) // finger turned back: no switch
  assert.equal(swipeTarget(0, 200, 1.2, w), 0) // first tab: never past the end
  assert.equal(swipeTarget(4, -200, -1.2, w, 5), 4) // last tab
  assert.equal(swipeTarget(0, -8, -2, w), 0) // a twitch is not a flick
})

test('swipe: rubber band past the ends, finger speed from the last 100 ms', () => {
  assert.ok(Math.abs(rubber(200, 390)) < 60)
  assert.ok(rubber(-200, 390) < 0)
  assert.equal(velocityOf([]), 0)
  assert.equal(velocityOf([{ t: 0, x: 0 }, { t: 50, x: -50 }, { t: 100, x: -100 }]), -1)
  assert.equal(velocityOf([{ t: 0, x: 0 }, { t: 400, x: -10 }, { t: 450, x: -60 }]), -1)
})

test('the swipe moves the track and the bar highlight directly, and locks direction early', () => {
  const h = read('./template/m/useTabSwipe.js')
  assert.match(h, /passive: false/)
  assert.match(h, /e\.preventDefault\(\)/)
  assert.match(h, /mode = 'scroll'/)
  assert.match(h, /setProperty\('--p'/)
  const css = read('./template/m/app.css')
  assert.match(css, /\.ma-tab-hl \{/)
  assert.match(css, /\.ma-tabbar\.is-drag \.ma-tab-hl \{ transition: none; \}/)
})

// P972 changed this: the scroller now runs from the very top (no band) and the header is clear until the page
// scrolls under it; see p972.test.js. Still true: the header sits outside the scroller, Notifications is full width.
test('slide-in screens: header pinned outside the scroller, Notifications full width', () => {
  const k = read('./template/m/AppKit.jsx')
  assert.ok(k.indexOf('<header className="ma-sub-h"') > k.indexOf('<div className="ma-scroll ma-sub-scroll"'), 'header sits outside the scroller')
  const css = read('./template/m/app.css')
  assert.match(css, /\.ma-sub-h \{[^}]*position: absolute; top: 0/)
  assert.match(css, /\.ma-layer-l \{ left: 0; right: 0;/) // Notifications covers the full width
  assert.match(read('./template/m/ANotes.jsx'), /<SubPage className="is-notif"/)
})

test('pages end just above the bar; Home has no "This week" caption', () => {
  const css = read('./template/m/app.css')
  assert.match(css, /--ma-end: calc\(var\(--ma-bar-at\) \+ 62px \+ 14px\)/)
  assert.match(css, /padding: calc\(var\(--ma-top\) \+ 12px\) 16px var\(--ma-end\)/)
  assert.doesNotMatch(read('./template/m/AHome.jsx'), /This week, Mon to today/)
})

test('View all is the apricot button; the bar avatar is the Account card blue', () => {
  assert.match(read('./template/m/AHome.jsx'), /ma-pillbtn is-tone is-apricot/)
  assert.match(read('./template/m/MobileFrame.jsx'), /<Ini name=\{account\.name\} tone="sky" size=\{32\} className="ma-tab-me" \/>/)
})

test('Account: next charge is a short value plus when', () => {
  assert.deepEqual(chargeStat('Tonight, 8 PM'), { value: '8 PM', when: 'tonight' })
  assert.deepEqual(chargeStat('Tue, Dec 1'), { value: 'Dec 1', when: 'Tue' })
  assert.deepEqual(chargeStat('8 PM'), { value: '8 PM', when: '' })
  assert.deepEqual(chargeStat(''), { value: '—', when: '' })
})

test('Settings: hours in words, every portal setting, Sign out and Delete account', () => {
  const day = (on, start = '9:00 AM', end = '6:00 PM') => ({ on, start, end })
  const week = { Mon: day(true), Tue: day(true), Wed: day(true), Thu: day(true), Fri: day(true), Sat: day(false), Sun: day(false) }
  assert.equal(weekWords(week), 'Mon to Fri, 9 to 6')
  assert.equal(weekWords({ ...week, Fri: day(true, '9:00 AM', '5:00 PM') }), 'Mon to Fri')
  assert.equal(weekWords({ ...week, Wed: day(false) }), '4 days, 9 to 6')
  assert.equal(weekWords({}), 'Not set')
  const s = read('./template/m/ASettings.jsx')
  for (const g of ['You', 'Calls and calendar', 'Notifications', 'Plan and billing', 'Account']) assert.match(s, new RegExp(`<Group title="${g}">`))
  for (const k of ['profile', 'zone', 'licence', 'setup', 'calls', 'email', 'alerts', 'receipts', 'appearance', 'password']) assert.match(s, new RegExp(`k === '${k}'`))
  assert.match(s, /NATIVE_BILLING_TEXT/)
})
