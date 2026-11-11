// P961 — live-update rules: when a build is downloaded, when a parked build is switched in at launch,
// and the "About this app" text.   node --test src/lib/otaRules.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whyNot, isNewer, shouldApply, aboutLines } from './otaRules.js'

const m = { version: '1.20261111.194219-7539ab0', bundle: '/ota/x.zip', checksum: 'abc', minNative: 1, minNativeBuild: { ios: 3, android: 1 } }

test('a newer manifest is downloaded on iOS build 4 and Android build 1', () => {
  assert.equal(whyNot(m, '1.20261111.161134-cc88121', '4', 'ios'), '')
  assert.equal(isNewer(m, '1.20261111.161134-cc88121', '1', 'android'), true)
})
test('reasons it is not: same build, old store build, broken manifest', () => {
  assert.equal(whyNot(m, m.version, '4', 'ios'), 'up to date')
  assert.equal(whyNot(m, 'old', '2', 'ios'), 'needs app build 3')
  assert.equal(whyNot({ version: 'x' }, 'old', '4', 'ios'), 'manifest incomplete')
})
test('a parked build is switched in at launch, once it is not running and not failed', () => {
  const next = { id: 'b1', version: m.version, status: 'success' }
  assert.equal(shouldApply(next, 'old'), true)
  assert.equal(shouldApply(next, m.version), false, 'already running')
  assert.equal(shouldApply({ ...next, status: 'error' }, 'old'), false, 'failed build')
  assert.equal(shouldApply({ id: 'builtin', version: '1.0' }, 'old'), false, 'builtin is a reset, not an update')
  assert.equal(shouldApply(null, 'old'), false)
})
test('no endless reload: a build that will not start is tried twice, then left', () => {
  const next = { id: 'b1', version: m.version, status: 'pending' }
  assert.equal(shouldApply(next, 'old', { [m.version]: 1 }), true)
  assert.equal(shouldApply(next, 'old', { [m.version]: 2 }), false)
})
test('About this app says the store build, the web build and what the updater did', () => {
  const [top, bottom] = aboutLines({ version: '1.1', build: '5' }, 'w2', { lastCheck: 1, result: 'up to date', applied: 'w2', appliedAt: 2 })
  assert.equal(top, 'App 1.1 (5) · Web w2')
  assert.match(bottom, /^Checked .*: up to date · Applied this build /)
  assert.equal(aboutLines({}, 'w1', {})[1], 'Not checked yet')
  assert.match(aboutLines({}, 'w1', { error: 'manifest 404' })[1], /Error: manifest 404$/)
})
