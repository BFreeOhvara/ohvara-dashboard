// P890 — cleanup from the code map: what the business no longer uses stays gone, and Pause leads says what it does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, globSync } from 'node:fs'
import { sheetTotals, TIMESHEET } from './adminshell/p879.js'

const src = f => readFileSync(f, 'utf8')
const files = globSync('src/**/*.{js,jsx}').map(f => f.replaceAll('\\', '/')).filter(f => !/\.test\.jsx?$/.test(f))

test('deleted files stay deleted and nothing imports them', () => {
  const gone = ['src/pages/agent/Leads.jsx', 'src/components/agent/PrepaidBalanceCard.jsx', 'src/template/CallerId.jsx',
    'src/components/settings/DutyCard.jsx', 'src/hooks/useLeads.js', 'src/hooks/useLicensing.js', 'src/hooks/useHierarchy.js',
    'src/hooks/useCommissionSchedule.js', 'src/components/agent/PolicyModal.jsx', 'src/template/ful/LiveCall.jsx',
    'src/components/admin/phone/ListenSheet.jsx']
  for (const f of gone) assert.equal(existsSync(f), false, f)
  const names = ['PrepaidBalanceCard', 'template/CallerId', "'../CallerId'", 'settings/DutyCard', 'hooks/useLeads', 'useLicensing',
    'useHierarchy', 'useCommissionSchedule', 'PolicyModal', 'ful/LiveCall', 'ListenSheet', 'agent/Leads\'']
  for (const f of files) for (const n of names) assert.ok(!src(f).includes(n), `${f} still mentions ${n}`)
})

test('no screen pays per cancel, tops up a balance, or uses agent caller ID', () => {
  for (const f of files.filter(f => f.endsWith('.jsx'))) {
    const s = src(f)
    assert.doesNotMatch(s, />[^<{]*(per cancel|verified cancel|Needs a listen)/i, f)
    assert.ok(!s.includes('create-balance-topup'), f)
    assert.ok(!s.includes('agent-caller-id'), f)
  }
  assert.ok(!src('src/hooks/useCallActions.js').includes('start-agent-caller-id-call'))
})

test('VA pay is hours from clock in and out x the hourly rate', () => {
  const maya = TIMESHEET.find(r => r.va === 'va-maya')
  const t = sheetTotals(maya, 8)
  assert.equal(t.pay, Math.round(t.hours * 8 * 100) / 100)
  assert.match(src('src/adminshell/screens/Settings.jsx'), /Hourly rate/)
  assert.doesNotMatch(src('src/adminshell/data.js'), /perCancel/)
})

test('live-call hours replace the Active switch', () => {
  for (const f of ['src/template/screens/Settings.jsx', 'src/template/TemplateFrame.jsx']) {
    assert.doesNotMatch(src(f), /setDuty|Active for live calls/, f)
  }
  // P924: one set of hours (the HoursEditor) covers booked and live calls; no TakeLeads, no Appointments only.
  assert.match(src('src/template/screens/Settings.jsx'), /<HoursEditor /)
  assert.doesNotMatch(src('src/template/screens/Settings.jsx'), /TakeLeads/)
})

test('Pause leads: spend and new leads stop, membership and servicing keep going; real mode calls the RPCs', () => {
  const b = src('src/template/screens/Billing.jsx')
  assert.match(b, /title="Pause leads"/)
  assert.match(b, /Your lead spend: none is used/)
  assert.match(b, /membership: it keeps charging/)
  assert.match(b, /Servicing for every client/)
  const real = src('src/hooks/agentRealData.js')
  assert.match(real, /rpcOrSoon\('lead_pause_set', \{ p_resume_on:/)
  assert.match(real, /rpcOrSoon\('lead_pause_resume'/)
  const mig = src('supabase/migrations/242_cleanup.sql')
  for (const fn of ['lead_pause_set', 'lead_pause_resume', 'lead_pause_daily', 'admin_lead_pauses', 'agent_live_now']) assert.match(mig, new RegExp(`function public\\.${fn}\\(`))
  assert.match(mig, /'paused by agent'/)
})

test('carrier email forwarding step: Gmail and Outlook guides and a test, in setup and Settings', () => {
  const pi = src('src/template/PaymentIntake.jsx')
  assert.match(pi, /export function ForwardSetup/)
  assert.match(pi, /gmail: \[/)
  assert.match(pi, /outlook: \[/)
  assert.match(pi, /Send a test/)
  assert.match(src('src/template/screens/Welcome.jsx'), /key: 'forward'/)
  // P924: Request a service is gone from the agent side (clients reach our team directly).
})
