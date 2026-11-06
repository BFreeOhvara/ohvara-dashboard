import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showFulShell, isFulShellPath, fulPageOf, fulTitleOf, FUL } from './paths.js'

test('a Fulfillment rep on the web gets the shell at every Fulfillment address', () => {
  for (const p of Object.values(FUL)) assert.ok(showFulShell({ role: 'fulfillment', pathname: p, native: false }), p)
  assert.ok(showFulShell({ role: 'fulfillment', pathname: '/fulfillment/', native: false }))
})

test('nobody else, and not in the phone app', () => {
  assert.equal(showFulShell({ role: 'admin', pathname: '/fulfillment', native: false }), false)
  assert.equal(showFulShell({ role: 'agent', pathname: '/messages', native: false }), false)
  assert.equal(showFulShell({ role: undefined, pathname: '/fulfillment', native: false }), false)
  assert.equal(showFulShell({ role: 'fulfillment', pathname: '/fulfillment', native: true }), false)
  assert.equal(isFulShellPath('/fulfillment/getting-paid'), false)
  assert.equal(isFulShellPath('/agent'), false)
})

test('P845: a record drawer address stays in the shell', () => {
  for (const p of ['/fulfillment/leads/vq-1', '/fulfillment/desk/cl-8', '/fulfillment/schedule/cl-8', '/fulfillment/pipeline/fc-gloria', '/fulfillment/servicing/st-1']) {
    assert.ok(showFulShell({ role: 'fulfillment', pathname: p, native: false }), p)
  }
  assert.equal(isFulShellPath('/fulfillment/pay/x'), false)
  assert.equal(isFulShellPath('/fulfillment/leads/a/b'), false)
})

test('page keys and titles', () => {
  assert.equal(fulPageOf('/fulfillment/desk'), 'calls')
  assert.equal(fulPageOf('/fulfillment/schedule'), 'schedule')
  assert.equal(fulPageOf('/settings'), 'settings')
  assert.equal(fulPageOf('/nope'), null)
  assert.deepEqual(fulTitleOf('servicing'), ['Client care', 'Servicing'])
  assert.deepEqual(fulTitleOf(null), ['Your day', 'Today'])
})
