// P989 — phone time zone rules (src/template/m/zoneTime.js) and the admin app's new screens.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickableZone, zoneName, clockLine, shiftIn, shiftWords, theirTime, whenBoth } from './template/m/zoneTime.js'
import { admRouteOf, ADM_SUBS } from './adminshell/m/admModel.js'

test('phone zones map to the zones Settings offers', () => {
  assert.equal(pickableZone('America/Chicago'), 'America/Chicago')
  assert.equal(pickableZone('America/Detroit'), 'America/New_York')
  assert.equal(pickableZone('America/Kentucky/Louisville'), 'America/New_York')
  assert.equal(pickableZone('America/Boise'), 'America/Denver')
  assert.equal(pickableZone('Europe/London'), null)
  assert.equal(pickableZone(''), null)
  assert.equal(zoneName('America/New_York'), 'Eastern')
  assert.equal(zoneName('America/Phoenix'), 'Arizona')
})

test('the clock line reads like the desktop one, in the given zone', () => {
  const ms = Date.UTC(2026, 10, 13, 18, 13) // Fri Nov 13, 12:13 PM Central
  assert.equal(clockLine(ms, 'America/Chicago').text, 'Friday, Nov 13 · 12:13 PM CT')
  assert.equal(clockLine(ms, 'America/New_York').text, 'Friday, Nov 13 · 1:13 PM ET')
})

test('VA shifts stay on Central and show converted elsewhere', () => {
  assert.equal(shiftIn('8:00 AM to 6:00 PM', 'America/Chicago'), null)
  assert.equal(shiftIn('8:00 AM to 6:00 PM', 'America/New_York'), '9 AM to 7 PM')
  assert.equal(shiftWords('8:00 AM to 6:00 PM', 'America/Los_Angeles'), '8 AM to 6 PM Central · 6 AM to 4 PM your time')
  assert.equal(shiftWords(null, 'America/Chicago'), '8 AM to 6 PM Central')
})

test('a booking shows both zones only when the clocks differ', () => {
  const e = { iso: '2026-11-16T20:00:00.000Z', time: '2:00 PM', tz: 'America/Denver' }
  assert.equal(theirTime(e, 'America/Chicago'), '1:00 PM')
  assert.equal(whenBoth(e, 'America/Chicago'), '2:00 PM your time · 1:00 PM theirs')
  assert.equal(whenBoth({ ...e, tz: 'America/Chicago' }, 'America/Chicago'), '2:00 PM CT')
  assert.equal(theirTime({ time: '2:00 PM' }, 'America/Chicago'), null)
})

test('admin app opens Edit profile and a Settings section', () => {
  assert.ok(ADM_SUBS.includes('profile'))
  assert.deepEqual(admRouteOf('/admin/settings', '?s=profile'), { tab: 'you', sub: 'profile', id: null })
  assert.deepEqual(admRouteOf('/admin/settings', '?s=settings&t=zone'), { tab: 'you', sub: 'settings', id: 'zone' })
})

import { readFileSync } from 'node:fs'
const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('Sign out is a glass button with red text, no red fill or border', () => {
  const css = src('./template/m/app.css')
  assert.match(css, /\.ma-signout \{[^}]*border: 1px solid var\(--ma-glass-b\); background: var\(--ma-glass\);[^}]*box-shadow: var\(--ma-shadow\); \}/)
  assert.match(css, /\.ma-signout \{ color: var\(--sh-f-coral\); \}/)
  assert.doesNotMatch(css, /\.ma-signout[^{]*\{[^}]*background: [^;]*coral/)
  for (const f of ['./template/m/AAccount.jsx', './template/m/va/VMe.jsx', './adminshell/m/AYou.jsx']) assert.ok(src(f).includes('<SignOutButton />'), f)
})

test('no glow on the Me / Account / You profile cards', () => {
  for (const f of ['./template/m/AAccount.jsx', './template/m/va/VMe.jsx', './adminshell/m/AYou.jsx']) assert.doesNotMatch(src(f), /ma-glow/, f)
})

test('the notifications close arrow sits top-right and points right', () => {
  const kit = src('./template/m/AppKit.jsx')
  assert.ok(kit.includes('<BackArrow label={close || \'Back\'} className="is-right" pointRight />'))
})

test('clock on every Home, travel prompt in every phone app, admin Edit profile', () => {
  for (const f of ['./template/m/AHome.jsx', './template/m/va/VToday.jsx', './adminshell/m/AHomeAdm.jsx']) assert.ok(src(f).includes('<PhoneClock tz='), f)
  for (const f of ['./template/m/MobileFrame.jsx', './template/m/va/VaApp.jsx', './adminshell/m/AdminApp.jsx']) assert.ok(src(f).includes('<PhoneZone tz='), f)
  const you = src('./adminshell/m/AYou.jsx')
  assert.ok(you.includes("app.openSub('profile')") && you.includes('export function AProfileAdm'))
})
