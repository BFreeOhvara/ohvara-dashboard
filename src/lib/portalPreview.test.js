// Portal preview list: who gets the v2 agent portal while the app_settings flag is off.
//   node --test src/lib/portalPreview.test.js
// Pure functions plus a localStorage stand-in: no network, no React. The flag-on case is checked
// here only, because flipping the live flag is not allowed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PREVIEW_USER_IDS, PREVIEW_KEY, isPreviewUser, portalFlagOn, readPreviewChoice, writePreviewChoice,
  useV2 as v2On, previewLink, oldPageFor, v2PageFor,
} from './portalPreview.js'
// useV2 is a pure function despite its name; the alias keeps the hooks lint rule out of loops here.
import { TEST_ACCOUNT_IDS } from './testAccounts.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const PREVIEW = { id: [...TEST_ACCOUNT_IDS][0] }
const STRANGER = { id: '99999999-9999-4999-8999-999999999999' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// A localStorage stand-in for node.
function plantStorage(initial = {}) {
  const m = new Map(Object.entries(initial))
  globalThis.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
  return m
}

// The hook's order of reads (portalV2.js usePortalV2): choice only for a preview user.
const decide = ({ settings, user }) =>
  v2On({ flagOn: portalFlagOn(settings), user, choice: isPreviewUser(user) ? readPreviewChoice() : null })

test('the list holds auth user ids only, the test agent among them', () => {
  assert.ok(PREVIEW_USER_IDS.size >= 1)
  for (const id of PREVIEW_USER_IDS) assert.match(id, UUID)
  assert.ok(PREVIEW_USER_IDS.has(PREVIEW.id))
  assert.doesNotMatch(src('./portalPreview.js'), /@|password/i)
  assert.equal(isPreviewUser(null), false)
  assert.equal(isPreviewUser({}), false)
  assert.equal(isPreviewUser(STRANGER), false)
})

test('(a) preview user, flag off, no choice: v2', () => {
  plantStorage()
  assert.equal(v2On({ flagOn: false, user: PREVIEW, choice: null }), true)
  assert.equal(decide({ settings: { agent_portal_v2: false }, user: PREVIEW }), true)
  assert.deepEqual(previewLink({ flagOn: false, user: PREVIEW, role: 'agent', pathname: '/agent', onV2: true }),
    { label: 'Back to old pages', choice: 'v1', to: '/agent' })
})

test('(b) preview user, flag off, choice v1: old pages; the link offers v2 and the choice round-trips', () => {
  const store = plantStorage()
  writePreviewChoice('v1')
  assert.equal(store.get(PREVIEW_KEY), 'v1')
  assert.equal(v2On({ flagOn: false, user: PREVIEW, choice: 'v1' }), false)
  assert.equal(decide({ settings: { agent_portal_v2: false }, user: PREVIEW }), false)
  assert.deepEqual(previewLink({ flagOn: false, user: PREVIEW, role: 'agent', pathname: '/agent/billing', onV2: false }),
    { label: 'Preview v2', choice: 'v2', to: '/agent/plan' })
  writePreviewChoice('v2')
  assert.equal(decide({ settings: { agent_portal_v2: false }, user: PREVIEW }), true)
})

test('(c) non-preview user, flag off, ov_portal_preview=v2 planted by hand and ?preview=v2 in the URL: old pages', () => {
  plantStorage({ [PREVIEW_KEY]: 'v2' })
  globalThis.location = { search: '?preview=v2&portal=v2' }
  let reads = 0
  const real = globalThis.localStorage.getItem
  globalThis.localStorage.getItem = k => { reads++; return real(k) }
  assert.equal(v2On({ flagOn: false, user: STRANGER, choice: 'v2' }), false)
  assert.equal(v2On({ flagOn: false, user: null, choice: 'v2' }), false)
  assert.equal(decide({ settings: { agent_portal_v2: false }, user: STRANGER }), false)
  assert.equal(reads, 0, 'a non-preview user never has localStorage read')
  // The link renders nothing on either side.
  for (const onV2 of [false, true]) {
    assert.equal(previewLink({ flagOn: false, user: STRANGER, role: 'agent', pathname: '/agent', onV2 }), null)
  }
  // The v2 route guard sends each v2 URL to its old page.
  assert.equal(oldPageFor('/agent/inbounds'), '/agent')
  assert.equal(oldPageFor('/agent/inbounds/b0000001-0000-4000-8000-000000000000'), '/agent')
  assert.equal(oldPageFor('/agent/calendar'), '/agent')
  assert.equal(oldPageFor('/agent/plan'), '/agent/billing')
  assert.equal(oldPageFor('/agent/clients'), '/agent/clients')
  delete globalThis.location
})

test('(d) any user, flag on: v2, whatever the choice; the preview link stays hidden', () => {
  plantStorage({ [PREVIEW_KEY]: 'v1' })
  for (const user of [PREVIEW, STRANGER, null]) {
    for (const choice of [null, 'v1', 'v2']) assert.equal(v2On({ flagOn: true, user, choice }), true)
    assert.equal(decide({ settings: { agent_portal_v2: true }, user }), true)
  }
  assert.equal(previewLink({ flagOn: true, user: PREVIEW, role: 'agent', pathname: '/agent', onV2: true }), null)
})

test('flag reads off unless exactly true', () => {
  for (const s of [undefined, null, {}, { agent_portal_v2: false }, { agent_portal_v2: 'true' }]) assert.equal(portalFlagOn(s), false)
  assert.equal(portalFlagOn({ agent_portal_v2: true }), true)
})

test('the link shows on agent pages for agents only', () => {
  const base = { flagOn: false, user: PREVIEW, onV2: false }
  assert.equal(previewLink({ ...base, role: 'admin', pathname: '/agent/book' }), null)
  assert.equal(previewLink({ ...base, role: 'agent', pathname: '/settings' }), null)
  assert.equal(previewLink({ ...base, role: 'agent', pathname: '/fulfillment' }), null)
  assert.equal(v2PageFor('/agent/clients'), '/agent/clients')
  assert.equal(v2PageFor('/agent/activity'), '/agent')
})

test('storage failures read as no choice', () => {
  globalThis.localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(readPreviewChoice(), null)
  assert.doesNotThrow(() => writePreviewChoice('v1'))
  plantStorage({ [PREVIEW_KEY]: 'junk' })
  assert.equal(readPreviewChoice(), null)
})

test('wiring: one gate, guard redirects with replace, link renders null, choice read only for preview users', () => {
  const hook = src('./portalV2.js')
  assert.match(hook, /isPreviewUser\(user\) \? readPreviewChoice\(\) : null/)
  assert.match(hook, /useV2\(\{ flagOn: portalFlagOn\(data\), user, choice \}\)/)
  assert.doesNotMatch(hook, /agent_portal_v2/)
  const app = src('../App.jsx')
  assert.match(app, /if \(!v2\.on\) return <Navigate to=\{oldPageFor\(pathname\)\} replace \/>/)
  const toggle = src('../components/agent/PortalPreviewToggle.jsx')
  assert.match(toggle, /if \(!link\) return null/)
  // The preview logic never looks at the URL (only ?portal=v1 in portalV2.js, which can only turn v2 off).
  assert.doesNotMatch(src('./portalPreview.js') + toggle, /URLSearchParams|search/)
})
