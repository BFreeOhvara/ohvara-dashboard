import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADM, ADM_OLD, ap, admPageOf, admTitleOf, admRoutes, showAdminShell, isAdminShellPath, isAdminPreviewPath, adminOldTarget, ADM_TABS } from './paths.js'

test('an admin on the web gets the shell at every admin address, old ones included', () => {
  for (const p of [...Object.values(ADM), ...Object.values(ADM_OLD)]) assert.ok(showAdminShell({ role: 'admin', pathname: p, native: false }), p)
  for (const p of ['/admin/', '/admin/agents/ag-dana', '/admin/fulfillment/va-maya', '/admin/inbounds/ib-1', '/admin/pipeline/cl-1']) {
    assert.ok(showAdminShell({ role: 'admin', pathname: p, native: false }), p)
  }
})

test('nobody else, not other addresses; P919: the phone app gets the shell too, and there is no classic flag', () => {
  assert.equal(showAdminShell({ role: 'agent', pathname: '/admin', native: false }), false)
  assert.equal(showAdminShell({ role: 'fulfillment', pathname: '/admin/agents', native: false }), false)
  assert.equal(showAdminShell({ role: undefined, pathname: '/admin', native: false }), false)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/admin', native: true }), true)
  assert.equal(showAdminShell({ role: 'admin', pathname: '/admin', native: false, classic: true }), true)
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

test('P919: old portal addresses an admin opens land on the new pages; shell and shared pages stay put', () => {
  const cases = {
    '/admin/carriers': '/settings#carriers', '/admin/whatever': '/admin', '/admin/old/deep': '/admin',
    '/agent': '/admin', '/agent/leads': '/admin/inbounds', '/agent/inbounds/abc': '/admin/inbounds', '/agent/clients/x1': '/admin/pipeline',
    '/agent/submit': '/admin/pipeline', '/agent/book': '/admin/pipeline', '/agent/activity': '/admin', '/agent/billing': '/admin',
    '/fulfillment': '/admin', '/fulfillment/leads': '/admin/inbounds', '/fulfillment/desk': '/admin/fulfillment', '/fulfillment/pipeline': '/admin/pipeline',
    '/fulfillment/pay': '/admin/fulfillment',
  }
  for (const [from, to] of Object.entries(cases)) assert.equal(adminOldTarget(from), to, from)
  for (const p of ['/admin', '/admin/', '/admin/users', '/admin/payouts', '/admin/more', '/admin/pipeline', '/admin/agents/a1', '/admin/settings',
    '/settings', '/messages', '/login', '/', '/protect', '/preview/admin', '/preview/admin/agents', '/r/tok', '/sign/x']) assert.equal(adminOldTarget(p), null, p)
})

test('routes cover every page, drawers included, in both mounts', () => {
  const real = admRoutes(false).map(r => r[1])
  const pre = admRoutes(true).map(r => r[1])
  for (const p of Object.values(ADM)) assert.ok(real.includes(p), p)
  assert.ok(real.includes('/admin/agents/:id'))
  assert.ok(pre.includes('/preview/admin/inbounds/:id'))
  for (const [k] of ADM_TABS) assert.ok(k in ADM, k)
})
