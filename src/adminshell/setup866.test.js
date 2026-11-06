import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admSnapshot, pipelineOf } from './data.js'
import { ADM, ADM_TABS, ADM_LABELS, admPageOf, admTitleOf } from './paths.js'
import { SETUP_STAGES, SETUP_STEPS, setupOf, stepsFor, readiness } from './setup.js'
import { sampleGhlRow, syncFailed, engineState } from './engine.js'

// P866: Setup is a top tab (everything to get a new client live); Connect is only the rail form; Money reads Revenue.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('the top tabs: Overview · Agents · Setup · Fulfillment · Leads · Clients · Revenue', () => {
  assert.deepEqual(ADM_TABS.map(t => t[1]), ['Overview', 'Agents', 'Setup', 'Fulfillment', 'Leads', 'Clients', 'Revenue'])
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

test('the Setup page: readiness strip with a Go to Connect state, the pipeline, Add a new client, the drawer', () => {
  const s = src('./screens/Setup.jsx')
  assert.match(s, /Nothing connected yet/)
  assert.match(s, /navigate\(ap\('connect'\)\)\}>Go to Connect/)
  assert.match(s, /Add a new client/)
  assert.match(s, /<AddSomeone open=\{adding\}/)
  for (const a of ['Send invite again', 'Mark launched (Jordan)', 'Mark live']) assert.ok(s.includes(a), a)
  assert.match(s, /<EngineSlot settings=\{row\} \/>/)
  assert.deepEqual(SETUP_STAGES.map(x => x.label), ['Invited', 'Profile', 'Plan & paid', 'Calendar & caller ID', 'Ready to launch', 'Launching (Jordan)', 'Live this week'])
})

test('the sample pipeline has someone at every stage, and every card % matches its checklist ticks', () => {
  const list = pipelineOf(admSnapshot())
  for (const st of SETUP_STAGES) assert.ok(list.some(c => c.stage === st.key), `nobody in ${st.label}`)
  for (const c of list) {
    const ticked = c.steps.filter(x => x.done).length
    assert.equal(c.count, ticked, c.name)
    assert.equal(c.pct, Math.round((ticked / c.steps.length) * 100), c.name)
    assert.equal(c.total, stepsFor(c).length, c.name)
    if (c.stage === 'live') { assert.equal(c.pct, 100, c.name); assert.equal(c.owner, null) } else { assert.ok(c.blocker, c.name); assert.ok(['agent', 'jordan', 'ohvara'].includes(c.owner), c.name) }
  }
  // the agent invites are the Invited column (one list, so an invite from anywhere shows up here)
  assert.deepEqual(list.filter(c => c.stage === 'invited').map(c => c.name), admSnapshot().invites.filter(i => i.role === 'agent').map(i => i.name))
})

test('stage, blocker and next owner follow the checklist', () => {
  const all = SETUP_STEPS.map(s => s.key)
  const agent = SETUP_STEPS.filter(s => s.who === 'agent').map(s => s.key)
  const jordan = SETUP_STEPS.filter(s => s.who === 'jordan').map(s => s.key)
  assert.equal(setupOf({ done: [] }).stage, 'invited')
  assert.equal(setupOf({ done: ['invite'] }).stage, 'profile')
  assert.equal(setupOf({ done: ['invite', 'profile', 'plan'] }).stage, 'plan')
  const owing = setupOf({ done: ['invite', 'profile', 'plan'], note: 'Card declined on the setup fee', noteOn: 'paid' })
  assert.equal(owing.blocker, 'Card declined on the setup fee')
  assert.equal(owing.owner, 'agent')
  assert.equal(setupOf({ done: ['invite', 'profile', 'plan', 'paid'] }).stage, 'calendar')
  assert.equal(setupOf({ done: agent }).stage, 'ready')
  assert.equal(setupOf({ done: agent }).owner, 'jordan')
  assert.equal(setupOf({ done: [...agent, 'campaign'] }).stage, 'launching')
  const allButLive = setupOf({ lead: 'live', done: all.filter(k => k !== 'live') })
  assert.equal(allButLive.stage, 'launching')
  assert.equal(allButLive.canLive, true)
  assert.equal(setupOf({ lead: 'live', done: [...agent, ...jordan] }).canLive, false) // Ohvara's briefing and test first
  assert.equal(setupOf({ lead: 'live', done: all }).stage, 'live')
  // live-calls steps count only on a live-calls plan
  assert.equal(stepsFor({ lead: 'appointment' }).length, SETUP_STEPS.length - 2)
  assert.equal(stepsFor({ lead: 'live' }).length, SETUP_STEPS.length)
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
