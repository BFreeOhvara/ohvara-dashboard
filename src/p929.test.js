// P929: test accounts are a sandbox with no sample label, real buttons, Settings back to its tabs, no desktop Call,
// Messages are texts only, calendar boxes never overlap, one-tap Not interested, and no page scroll behind a panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { leadMessages, notInterestedLine } from './template/agentView.js'
import { resolveMode } from './lib/dataMode.js'
import { isTestProfile } from './lib/testAccounts.js'

const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')

test('a test account always sees sample info, with no sample line or tag', () => {
  assert.equal(isTestProfile({ id: 'x', is_test: true }), true)
  assert.equal(isTestProfile({ id: '3f2b2df7-40b1-4921-80e2-09981c819642' }), true)
  assert.equal(isTestProfile({ id: 'x' }), false)
  assert.equal(resolveMode({ show: true, view: null, canPreview: true, isTest: true }), 'sample')
  assert.match(src('./template/kit.jsx'), /SampleTag = [^\n]*useIsTestAccount\(\) \? null/)
  for (const f of ['./adminshell/AdminFrame.jsx', './template/TemplateFrame.jsx', './template/ful/FulFrame.jsx', './template/m/MobileFrame.jsx']) assert.match(src(f), /!isTest &&/, f)
  // sample-only code never loads the Supabase client to ask
  assert.equal(/lib\/supabase/.test(src('./hooks/authContext.js') + src('./hooks/useIsTestAccount.js')), false)
})

test('the migration: is_test is locked, puts the account on the demo side, and keeps it out of routing and pods', () => {
  const m = src('../supabase/migrations/260_test_accounts.sql')
  assert.match(src('../supabase/migrations/261_test_policies_side.sql'), /disable trigger a1_policies_demo[\s\S]*enable trigger a1_policies_demo/)
  for (const re of [/add column if not exists is_test/, /is_demo := true/, /route_can_take\(p, now\(\), t\)/, /'test_account'/, /Test accounts can''t be on a number/]) assert.match(m, re)
})

test('admin numbers leave test accounts out', () => {
  assert.match(src('./lib/admReal.js'), /isTestProfile/)
})

test('buttons: solid blue on plain surfaces, white on coloured cards, never grey', () => {
  const b = src('./template/buttons929.css')
  assert.match(b, /background: var\(--sh-acc\)/)
  assert.match(b, /background: var\(--btn-white\)/)
  assert.match(src('./template/glass.css'), /buttons929\.css/)
})

test('Settings: pill tabs again, Notifications and Email each their own tab, no sideways scroll', () => {
  const s = src('./template/screens/Settings.jsx')
  assert.match(s, /<PillTabs/)
  assert.match(s, /\['alerts', 'Notifications'/)
  assert.match(s, /\['email', 'Email'/)
  assert.match(src('./template/settings929.css'), /overflow-x: hidden/)
})

test('Messages: only texts sent and received, nothing planned or skipped', () => {
  const l = { events: [
    { kind: 'text_sent', text: 'Hi', at: '2026-11-01T10:00:00' },
    { kind: 'text_received', text: 'Yes', at: '2026-11-01T10:05:00' },
    { kind: 'text_sent', text: 'Morning of', at: '2026-11-03T08:00:00', state: 'scheduled' },
    { kind: 'call_task', at: '2026-11-01T11:00:00' },
    { kind: 'stage', label: 'Booked', at: '2026-11-01T11:00:00' },
  ] }
  assert.deepEqual(leadMessages(l, '2026-11-02T00:00:00').map(e => e.text), ['Hi', 'Yes'])
  assert.match(src('./template/screens/Leads.jsx'), /No messages yet\./)
})

test('Not interested: one tap, no reason, card and drawer show the date', () => {
  assert.equal(notInterestedLine({ niAt: '2026-11-02T09:00:00' }), 'Not interested · Nov 2')
  const o = src('./template/LeadOutcome.jsx')
  assert.equal(/REASONS/.test(o), false)
  assert.match(src('./template/screens/Leads.jsx'), /return notInterestedLine\(l\)/)
})

test('result buttons use the Leads-board status colours', () => {
  assert.match(src('./template/LiveCall.jsx'), /agentStatus\(RESULT_STATUS\[r\[0\]\]\)\.tone/)
})

test('no page scroll behind any panel or pop-up, every role', () => {
  assert.match(src('./template/panels929.css'), /html:has\(body :is\(\.tp-layer, ?\.fx-layer, ?\.mx-layer\)/)
})
