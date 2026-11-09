import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { paths, isTemplateAddress, tabOf, titleOf, layoutOf, isShellPath, showShell, SHELL_ROUTES } from './paths.js'

const at = pathname => { globalThis.window = { location: { pathname } } }
test.afterEach(() => { delete globalThis.window })

test('THE LINK CHECK: no raw link strings in src/template', () => {
  // P908: mpaths.js holds the phone mockup's own /template/m addresses (preview only; Phase 2 builds the phone
  // layouts at the real agent paths, through paths.js).
  const skip = new Set(['paths.js', 'paths.test.js', 'TemplateApp.jsx', 'mpaths.js'])
  const files = globSync('src/template/**/*.{js,jsx}')
    .map(f => f.replaceAll('\\', '/'))
    .filter(f => !skip.has(f.split('/').pop()))
  assert.ok(files.length > 15, `scanned only ${files.length} files`)
  const hits = []
  for (const f of files) {
    readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/['"`]\//.test(line)) hits.push(`${f}:${i + 1}  use paths.x() from src/template/paths.js so the link works at the real agent URLs`)
    })
  }
  assert.deepEqual(hits, [])
})

test('isTemplateAddress', () => {
  assert.equal(isTemplateAddress(), false)
  at('/template')
  assert.equal(isTemplateAddress(), true)
  at('/template/leads')
  assert.equal(isTemplateAddress(), true)
  at('/templates')
  assert.equal(isTemplateAddress(), false)
  at('/agent')
  assert.equal(isTemplateAddress(), false)
})

test('paths at the template address are the plain shell paths', () => {
  at('/template/more')
  assert.equal(paths.home(), '/')
  assert.equal(paths.leads(), '/leads')
  assert.equal(paths.lead('abc'), '/leads/abc')
  assert.equal(paths.calendar(), '/calendar')
  assert.equal(paths.clients(), '/clients')
  assert.equal(paths.clients('protected'), '/clients?stage=protected')
  assert.equal(paths.client('c1'), '/clients/c1')
  assert.equal(paths.submit(), '/submit')
  assert.equal(paths.requestService(), '/request-service')
  assert.equal(paths.messages(), '/messages')
  assert.equal(paths.activity(), '/activity')
  assert.equal(paths.billing(), '/billing')
  assert.equal(paths.settings(), '/settings')
  assert.equal(paths.more(), '/more')
  assert.equal(paths.signup(), '/signup')
  assert.equal(paths.welcome(), '/welcome')
})

test('paths at the real agent address', () => {
  for (const at_ of ['/agent', '/agent/leads', '/settings']) {
    at(at_)
    assert.equal(paths.home(), '/agent')
    assert.equal(paths.leads(), '/agent/leads')
    assert.equal(paths.lead('abc'), '/agent/inbounds/abc')
    assert.equal(paths.calendar(), '/agent/calendar')
    assert.equal(paths.clients(), '/agent/clients')
    assert.equal(paths.clients('protected'), '/agent/clients?stage=protected')
    assert.equal(paths.client('c1'), '/agent/clients/c1')
    assert.equal(paths.submit(), '/agent/submit')
    assert.equal(paths.requestService(), '/agent/request-service')
    assert.equal(paths.messages(), '/messages')
    assert.equal(paths.activity(), '/agent/activity')
    assert.equal(paths.billing(), '/agent/billing')
    assert.equal(paths.settings(), '/settings')
    assert.equal(paths.more(), '/agent/more')
  }
})

test('paths work with no window at all', () => {
  assert.equal(paths.home(), '/agent')
  assert.equal(paths.lead('x'), '/agent/inbounds/x')
})

test('tabOf and titleOf accept a location from either address', () => {
  const cases = [
    ['/', '/agent', 'overview', ['Today', 'Overview']],
    ['/leads', '/agent/leads', 'leads', ['Your', 'Leads']],
    ['/leads/abc', '/agent/inbounds/abc', 'leads', ['Your', 'Leads']],
    ['/calendar', '/agent/calendar', 'calendar', ['This week', 'Calendar']],
    ['/clients', '/agent/clients', 'clients', ['Your book', 'Clients']],
    ['/clients/c1', '/agent/clients/c1', 'clients', ['Your book', 'Clients']],
    ['/submit', '/agent/submit', null, ['New sale', 'Submit']],
    ['/request-service', '/agent/request-service', null, ['Servicing', 'Request a service']],
    ['/messages', '/messages', null, ['Team', 'Messages']],
    ['/activity', '/agent/activity', 'activity', ['What happened', 'Activity']],
    ['/billing', '/agent/billing', 'billing', ['Your plan', 'Billing']],
    ['/settings', '/settings', null, ['Account', 'Settings']],
    ['/more', '/agent/more', null, ['Account', 'More']],
  ]
  for (const [tpl, real, tab, title] of cases) {
    for (const p of [tpl, real]) {
      assert.equal(tabOf(p), tab, `tabOf ${p}`)
      assert.deepEqual(titleOf(p), title, `titleOf ${p}`)
      assert.equal(layoutOf(p), tpl === '/' ? 'overview' : tpl.split('/')[1], `layoutOf ${p}`)
    }
  }
  assert.deepEqual(titleOf('/nope'), ['Today', 'Overview'])
})

test('isShellPath', () => {
  const real = {
    overview: '/agent', leads: '/agent/leads', lead: '/agent/inbounds/abc', calendar: '/agent/calendar', clients: '/agent/clients',
    client: '/agent/clients/c1', submit: '/agent/submit', requestService: '/agent/request-service', activity: '/agent/activity',
    billing: '/agent/billing', more: '/agent/more', settings: '/settings', messages: '/messages',
  }
  assert.equal(Object.keys(SHELL_ROUTES).length, 13)
  for (const key of Object.keys(SHELL_ROUTES)) {
    assert.ok(isShellPath(real[key]), real[key])
    assert.ok(isShellPath(real[key] + '/'), real[key] + '/')
  }
  for (const p of ['/agent/inbounds', '/agent/book', '/agent/plan', '/template', '/agent/leads/x', '/']) assert.equal(isShellPath(p), false, p)
})

test('showShell', () => {
  const s = (role, pathname, native = false) => showShell({ role, pathname, native })
  assert.equal(s('agent', '/agent'), true)
  assert.equal(s('agent', '/settings'), true)
  assert.equal(s('agent', '/agent/book'), false)
  assert.equal(s('agent', '/agent', true), false)
  for (const role of ['admin', 'fulfillment']) {
    assert.equal(s(role, '/settings'), false)
    assert.equal(s(role, '/agent/submit'), false)
  }
  assert.equal(s(null, '/agent'), false)
})

test('showShell: every shell URL for an agent on the web, trailing slash and ids included', () => {
  const s = (role, pathname, native = false) => showShell({ role, pathname, native })
  for (const p of ['/agent/', '/agent/leads', '/agent/inbounds/abc-123', '/agent/calendar', '/agent/clients', '/agent/clients/b-9', '/agent/submit',
    '/agent/request-service', '/agent/activity', '/agent/billing', '/agent/more', '/messages', '/settings/']) assert.equal(s('agent', p), true, p)
  // Not a shell URL, or not an agent on the web: today's pages.
  for (const p of ['/agent/clients/a/b', '/agent/team', '/admin', '/fulfillment', '/login', '/protect']) assert.equal(s('agent', p), false, p)
  for (const role of ['admin', 'fulfillment', 'va', undefined, '']) assert.equal(s(role, '/agent/leads'), false, String(role))
  assert.equal(s('agent', '/messages', true), false)
})

test('every SHELL_ROUTES path is a shell path', () => {
  for (const p of Object.values(SHELL_ROUTES)) assert.equal(isShellPath(p.replace(/:[A-Za-z]+/, 'x1')), true, p)
})
