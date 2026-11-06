import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADM, ADM_OLD, ap, admPageOf, admTitleOf, admRoutes, showAdminShell, isAdminShellPath, isAdminPreviewPath, classicFrom, ADM_TABS } from './paths.js'

test('an admin on the web gets the shell at every admin address, old ones included', () => {
  for (const p of [...Object.values(ADM), ...Object.values(ADM_OLD)]) assert.ok(showAdminShell({ role: 'admin', pathname: p, native: false }), p)
  for (const p of ['/admin/', '/admin/agents/ag-dana', '/admin/fulfillment/va-maya', '/admin/inbounds/ib-1', '/admin/pipeline/cl-1']) {
    assert.ok(showAdminShell({ role: 'admin', pathname: p, native: false }), p)
  }
})

test('nobody else, not in the phone app, not with the classic flag, not other addresses', () => {
  assert.equal(showAdminShell({ role: 'agent', pathname: '/admin', native: false }), false)
  assert.equal(showAdminShell({ role: 'fulfillment', pathname: '/admin/agents', native: false }), false)
  assert.equal(showAdminShell({ role: undefined, pathname: '/admin', native: false }), false)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/admin', native: true }), false)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/admin', native: false, classic: true }), false)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/settings', native: false }), false)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/messages', native: false }), false)
  assert.equal(isAdminShellPath('/admin/carriers'), false)
  assert.equal(isAdminShellPath('/admin/billing/x'), false)
  assert.equal(isAdminShellPath('/admin/agents/a/b'), false)
  assert.equal(isAdminShellPath('/agent'), false)
})

test('the preview lives under /preview/admin', () => {
  assert.ok(isAdminPreviewPath('/preview/admin'))
  assert.ok(isAdminPreviewPath('/preview/admin/connect'))
  assert.equal(isAdminPreviewPath('/preview'), false)
  assert.equal(isAdminPreviewPath('/admin'), false)
  assert.equal(ap('connect', null, true), '/preview/admin/connect')
  assert.equal(ap('agents', 'ag-dana', false), '/admin/agents/ag-dana')
  assert.equal(ap('users', null, false), '/admin/users')
  assert.equal(admPageOf('/preview/admin/inbounds/ib-3'), 'leads')
})

test('page keys and titles', () => {
  assert.equal(admPageOf('/admin'), 'overview')
  assert.equal(admPageOf('/admin/fulfillment'), 'team')
  assert.equal(admPageOf('/admin/users'), 'settings')
  assert.equal(admPageOf('/admin/more'), 'settings')
  assert.equal(admPageOf('/admin/payouts'), 'billing')
  assert.equal(admPageOf('/admin/nope'), null)
  assert.deepEqual(admTitleOf('team'), ['Who serves', 'Fulfillment team'])
  assert.deepEqual(admTitleOf('nope'), admTitleOf('overview'))
})

test('the classic flag: ?classic=1 on, ?classic=0 off, else what the tab remembered', () => {
  assert.equal(classicFrom('?classic=1', null), true)
  assert.equal(classicFrom('?classic=0', '1'), false)
  assert.equal(classicFrom('', '1'), true)
  assert.equal(classicFrom('?x=2', null), false)
})

test('routes cover every page, drawers included, in both mounts', () => {
  const real = admRoutes(false).map(r => r[1])
  const pre = admRoutes(true).map(r => r[1])
  for (const p of Object.values(ADM)) assert.ok(real.includes(p), p)
  assert.ok(real.includes('/admin/agents/:id'))
  assert.ok(pre.includes('/preview/admin/inbounds/:id'))
  for (const [k] of ADM_TABS) assert.ok(k in ADM, k)
})
