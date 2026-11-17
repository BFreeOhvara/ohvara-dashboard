// P1027 — Connect carrier emails: the card is wired to real functions from migration 284, sits next to Hours and
// calls in Settings (desktop + phone) and in setup, and promises only what we do (no password, no inbox access).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('real side calls the 284 functions', () => {
  const real = src('src/hooks/carrierEmailsReal.js')
  for (const fn of ['my_carrier_emails', 'set_my_notice_carriers', 'start_my_carrier_email_test', 'rotate_my_payment_intake_address']) {
    assert.match(real, new RegExp(`rpc\\('${fn}'`))
    assert.match(src('supabase/migrations/284_p1027_carrier_emails.sql'), new RegExp(`function public\\.${fn}\\(`))
  }
  assert.match(src('src/hooks/agentRealData.js'), /carrierEmails: REAL_CARRIER_EMAILS/)
  assert.match(src('src/template/data/index.js'), /carrierEmails: SAMPLE_CARRIER_EMAILS/)
})

test('card: plain-words promise, Gmail + Outlook steps, Gmail code, test', () => {
  const pi = src('src/template/PaymentIntake.jsx')
  assert.match(pi, /Connect carrier emails/)
  assert.match(pi, /never the rest of your inbox/)
  assert.match(pi, /never ask for your email password/)
  assert.match(pi, /gmail\.code/)
  assert.match(pi, /Disable forwarding/)
  assert.match(pi, /Send a test/)
  assert.doesNotMatch(pi, /type="password"/)
})

test('placement: Settings tab next to Hours and calls, phone row after Call hours, setup step', () => {
  assert.match(src('src/template/screens/Settings.jsx'), /\['calls', 'Hours and calls', Radio\], \['email', 'Carrier emails', Mail\]/)
  const m = src('src/template/m/ASettings.jsx')
  assert.ok(m.indexOf("title=\"Call hours\"") < m.indexOf("title=\"Carrier emails\""))
  assert.match(src('src/template/screens/Welcome.jsx'), /<CarrierEmails compact onTested=/)
})

test('admin: an unmatched carrier notice is a to-do that opens the match drawer', async () => {
  const { adminTodos } = await import('./adminshell/todos.js')
  const rows = adminTodos({ notices: [{ id: 'n1', agent: 'Dana Walker', subject: 'Returned payment', whyText: 'fits more than one client' }], ap: k => `/admin${k === 'overview' ? '' : '/' + k}` })
  assert.deepEqual(rows.map(r => [r.kind, r.title, r.action, r.to]), [['notice', 'Carrier notice needs a look', 'Look', '/admin?notice=n1']])
  assert.match(rows[0].sub, /Dana Walker · Returned payment · fits more than one client/)
  const real = src('src/adminshell/notices1027.js')
  for (const fn of ['admin_payment_emails_to_match', 'va_payment_intake_match', 'va_payment_intake_dismiss']) assert.ok(real.includes(`rpc('${fn}'`), fn)
})
