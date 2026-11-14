import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitMs, words, failWait, noteFail, clearFails, FREE_TRIES } from './signinBackoff.js'

const store = {}
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } }

test('no wait for the first tries, then 30 s doubling to a 15 minute cap', () => {
  assert.equal(waitMs(FREE_TRIES - 1), 0)
  assert.equal(waitMs(FREE_TRIES), 30e3)
  assert.equal(waitMs(FREE_TRIES + 1), 60e3)
  assert.equal(waitMs(FREE_TRIES + 20), 15 * 60e3)
  assert.equal(words(30e3), '30 seconds')
  assert.equal(words(60e3), '1 minute')
})

test('counted per email, case-insensitive, cleared on success', () => {
  const t = 1_000_000
  for (let i = 0; i < FREE_TRIES; i++) noteFail('Pat@X.com', t)
  assert.equal(failWait('pat@x.com', t + 1000), '29 seconds')
  assert.equal(failWait('other@x.com', t + 1000), '')
  assert.equal(failWait('pat@x.com', t + 31e3), '')
  clearFails('PAT@x.com')
  assert.equal(failWait('pat@x.com', t + 1000), '')
})
