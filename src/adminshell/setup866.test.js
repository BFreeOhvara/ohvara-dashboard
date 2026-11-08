import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admSnapshot, pipelineOf } from './data.js'
import { ADM, ADM_TABS, ADM_LABELS, admPageOf, admTitleOf } from './paths.js'
import { SETUP_STAGES, SETUP_STEPS, setupOf, stepsFor, readiness, isPaid } from './setup.js'
import { sampleGhlRow, syncFailed, engineState } from './engine.js'

// P866: Setup is a top tab (everything to get a new client live); Connect is only the rail form; Money reads Revenue.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('the top tabs (P906): Overview · Agents · Fulfillment · Clients · Setup · Revenue · Leads', () => {
  assert.deepEqual(ADM_TABS.map(t => t[1]), ['Overview', 'Agents', 'Fulfillment', 'Clients', 'Setup', 'Revenue', 'Leads'])
  assert.equal(ADM.setup, '/admin/setup')
  assert.equal(admPageOf('/admin/setup'), 'setup')
  assert.equal(admPageOf('/admin/setup/ob-carl'), 'setup') // a client's checklist drawer has its own address
  assert.equal(admPageOf('/preview/admin/setup/inv-1'), 'setup')
  assert.equal(admTitleOf('setup')[1], 'Setup')
  assert.equal(ADM_LABELS.billing, 'Revenue')
  assert.match(src('./routes.jsx'), /setup: Setup/)
})

test('Revenue is the word everywhere an admin reads it (tab, title, menu, links)', () => {
  const frame = src('./AdminFrame.jsx')
  assert.match(frame, /\['billing', 'Revenue', Landmark\]/)
  assert.doesNotMatch(frame, /'Money'/)
  assert.match(src('./screens/Overview.jsx'), /label="Open Revenue"/)
  const b = src('./screens/Billing.jsx')
  assert.match(b, /aria-label="Revenue for the period"/)
  assert.match(b, /label="Revenue details"/)
  for (const f of ['./paths.js', './screens/Billing.jsx', './screens/Overview.jsx', './AdminFrame.jsx']) {
    // no rendered "Money" left: only code names (useAdmMoney, MoneyTop, moneyFor) and comments
    const code = src(f).replace(/\/\/.*$/gm, '').replace(/\b(useAdmMoney|MoneyTop|moneyFor|money)\b/g, '')
    assert.doesNotMatch(code, /\bMoney\b/, f)
  }
})

test('Connect is only the connection form and its status: no Setup sub-tab', () => {
  const s = src('./screens/Connect.jsx')
  assert.doesNotMatch(s, /PillTabs/)
  assert.doesNotMatch(s, /key: 'setup'/)
  assert.doesNotMatch(s, /SetupView|SetupEmpty/)
  assert.match(s, /<GhlLiveTile ghl=\{ghl\} \/> : <GhlTile \/>/)
  assert.match(s, /What is plugged in/)
  assert.match(s, /useGhlConnect\(\{ enabled: !!live && !gaveUp \}\)/) // P855's ask-once stays
})

test('the Setup page (P906): tickets for paying agents only, no adding by hand, Create campaign through the engine slot', () => {
  const s = src('./screens/Setup.jsx')
  assert.match(s, /Nothing connected yet/)
  assert.match(s, /navigate\(ap\('connect'\)\)\}>Go to Connect/)
  assert.doesNotMatch(s, /Add a new client|AddSomeone|Send invite again|Mark launched/)
  for (const a of ['Create campaign', 'Mark done', 'Open Meta Ads Manager', 'Open GoHighLevel']) assert.ok(s.includes(a), a)
  assert.match(s, /target="_blank" rel="noopener noreferrer"/)
  assert.match(s, /<EngineSlot settings=\{row\} \/>/)
  assert.deepEqual(SETUP_STAGES.map(x => x.label), ['New ticket', 'Campaign', 'Test lead', 'Done this week'])
  assert.deepEqual(SETUP_STEPS.map(x => x.key), ['states', 'campaign', 'on', 'test', 'live'])
})

test('the sample tickets: only paid agents, someone at every step, every % matches its ticks', () => {
  const snap = admSnapshot()
  const list = pipelineOf(snap)
  assert.ok(list.length > 0)
  assert.ok(list.every(isPaid), 'an unpaid agent is on the board')
  const unpaid = snap.onboard.filter(c => !isPaid(c))
  assert.ok(unpaid.length > 0, 'the sample keeps an unpaid sign-up to prove it stays off the board')
  for (const c of unpaid) assert.ok(!list.some(x => x.id === c.id), c.name)
  for (const st of SETUP_STAGES) assert.ok(list.some(c => c.stage === st.key), `nobody in ${st.label}`)
  for (const c of list) {
    const ticked = c.steps.filter(x => x.done).length
    assert.equal(c.count, ticked, c.name)
    assert.equal(c.pct, Math.round((ticked / c.steps.length) * 100), c.name)
    if (c.stage === 'live') { assert.equal(c.pct, 100, c.name); assert.equal(c.owner, null) } else { assert.ok(c.blocker, c.name); assert.ok(['ohvara', 'engine'].includes(c.owner), c.name) }
  }
})

test('stage, blocker and campaign request follow the checklist', () => {
  assert.equal(setupOf({ done: ['paid'] }).stage, 'new')
  assert.equal(setupOf({ done: ['paid', 'states'] }).stage, 'campaign')
  assert.equal(setupOf({ done: ['paid', 'states'] }).owner, 'engine')
  assert.equal(setupOf({ done: ['paid', 'states'] }).req, 'none')
  assert.equal(setupOf({ done: ['paid', 'states'], campaignReq: { status: 'sent' } }).blocker, 'Campaign requested · waiting on GoHighLevel')
  const failed = setupOf({ done: ['paid', 'states'], campaignReq: { status: 'failed', why: 'template missing' } })
  assert.equal(failed.warn, true)
  assert.match(failed.blocker, /template missing/)
  assert.equal(setupOf({ done: ['paid', 'states', 'campaign'] }).stage, 'campaign') // created but not on yet
  assert.equal(setupOf({ done: ['paid', 'states', 'campaign', 'on'] }).stage, 'test')
  const ready = setupOf({ done: ['paid', 'states', 'campaign', 'on', 'test'] })
  assert.equal(ready.canLive, true)
  assert.equal(setupOf({ done: ['paid', 'states', 'campaign', 'on'] }).canLive, false)
  assert.equal(setupOf({ done: ['paid', ...SETUP_STEPS.map(x => x.key)] }).stage, 'live')
  assert.equal(stepsFor({ lead: 'appointment' }).length, stepsFor({ lead: 'live' }).length)
})

test('the readiness strip: six lines, all grey until GoHighLevel is connected', () => {
  const c = admSnapshot().connect
  const off = readiness(c, { on: false, sync: '', workflows: [{ on: true }], tracking: [{}] })
  assert.deepEqual(off.map(x => x.label), ['GoHighLevel connected', 'A2P sender', 'Workflows A1–E3', 'Ad account', 'Tracking numbers', 'Lead form / landing page'])
  assert.ok(off.every(x => x.tone === 'mute' && x.word === 'Not connected'))
  const on = readiness({ ...c, texting: { ...c.texting, brand: 'approved', campaign: 'approved' }, ads: c.ads.map(a => ({ ...a, account: '1' })) }, { on: true, sync: '5 min ago', workflows: [{ on: true }], tracking: [{}] })
  assert.ok(on.every(x => x.tone === 'green'), JSON.stringify(on.map(x => [x.key, x.tone])))
  assert.ok(on.slice(1).every(x => x.sub.endsWith('last sync 5 min ago')))
})

test('the Connect rail dot shows only when a sync failed; the sample shows it off', () => {
  assert.equal(syncFailed(null), false)
  assert.equal(syncFailed({ location_id: 'loc1', last_sync_status: 'ok' }), false)
  assert.equal(syncFailed({ location_id: 'loc1', last_sync_status: 'error' }), true)
  assert.equal(syncFailed(sampleGhlRow(admSnapshot().connect)), false)
  assert.equal(engineState(sampleGhlRow(admSnapshot().connect)).on, false) // the sample starts not connected
  const frame = src('./AdminFrame.jsx')
  assert.match(frame, /\{syncFailed\(ghlRow\) && <span className="adm-warndot"/)
})
