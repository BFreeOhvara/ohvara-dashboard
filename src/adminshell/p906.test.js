import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { admSnapshot, chargeFor, PLANS } from './data.js'
import { ADM_TABS } from './paths.js'
import { LEAD_LANES, LEAD_STAGES, CLIENT_ORDER, CLIENT_STAGE, isUnassigned, awaitsResult } from './words.js'
import { tierOf } from '../template/spendPlan.js'

// P906 — admin catch-up: nav order, lead statuses + the Unassigned list, the plan and budget panel, client statuses,
// tonight's switches in Settings, and no AI → VA hand-off anywhere on admin.
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('nav order (P913): Overview · Agents · Fulfillment · Leads · Clients · Setup · Revenue', () => {
  assert.deepEqual(ADM_TABS.map(t => t[1]), ['Overview', 'Agents', 'Fulfillment', 'Leads', 'Clients', 'Setup', 'Revenue'])
})

test('lead statuses are the five (P913), and a lead with no agent is an alert, not a status', () => {
  assert.deepEqual(LEAD_LANES.map(l => l.label), ['Booked', 'No show', 'Follow up', 'Sold', 'Not interested'])
  assert.equal(new Set(LEAD_LANES.map(l => l.tone)).size, LEAD_LANES.length, 'no two statuses share a colour')
  const leads = admSnapshot().leads
  for (const l of leads.filter(x => !isUnassigned(x))) assert.ok(LEAD_STAGES.includes(l.stage), `${l.name}: ${l.stage}`)
  const un = leads.filter(isUnassigned)
  assert.equal(un.length, 0, 'P934: no sample lead is unmatched (a real one almost never is)')
  for (const old of ['needs_routing', 'transferred', 'not_sold', 'missed']) assert.ok(!leads.some(l => l.stage === old), old)
  // a live call waits on Booked with Mark result, like the agent side (P910)
  assert.ok(leads.some(awaitsResult))
  const leadsJsx = src('./screens/Leads.jsx')
  assert.doesNotMatch(leadsJsx, /<Unassigned |function Unassigned\(/) // P913: no Unassigned section on Leads
  assert.match(leadsJsx, /Mark result/)
  assert.doesNotMatch(leadsJsx, /Needs routing|Not sold|'Transferred'/)
})

test('the plan panel: plan from the spend band, tonight = spend + 12%, every sample plan covered', () => {
  const agents = admSnapshot().agents
  for (const a of agents) assert.equal(a.plan, tierOf(a.spend).key, a.name)
  const plans = new Set(agents.map(a => a.plan))
  for (const k of Object.keys(PLANS).filter(k => k !== 'servicing')) assert.ok(plans.has(k), `no sample agent on ${k}`)
  const paying = agents.find(a => !a.comped && !a.paused)
  const c = chargeFor(paying)
  assert.equal(Math.round(c.total * 100), Math.round((paying.spend - (paying.billing.credit || 0)) * 1.12 * 100)) // credit comes off before the 12%
  assert.equal(chargeFor(agents.find(a => a.paused)), null)
  assert.equal(chargeFor(agents.find(a => a.comped)), null)
  const panel = src('./screens/Agents.jsx')
  for (const w of ['Paid ahead', 'Card on file', 'Last charge', 'Next charge', 'Setup fee', 'Founding lock', 'Pause']) assert.ok(panel.includes(w), w)
})

test('client statuses are P899: Working · Needs attention · Protected, Closed behind a switch', () => {
  assert.deepEqual(CLIENT_ORDER.map(k => CLIENT_STAGE[k][1]), ['Needs attention', 'Working', 'Protected'])
  assert.equal(CLIENT_STAGE.closed[1], 'Closed')
  const stages = new Set(admSnapshot().clients.map(c => c.stage))
  for (const s of stages) assert.ok(CLIENT_STAGE[s], s)
  assert.match(src('./screens/Clients.jsx'), /Show closed/)
})

test('P934: Settings › Go live holds only the go-live switches, each with what it turns on', () => {
  const l = src('./screens/Launch906.jsx')
  for (const w of ['sms_live', 'voice_live', 'ai_caller_live', '<LiveChargingRow />', '<SampleSwitch live={live} bare />']) assert.ok(l.includes(w), w)
  for (const w of ['Call ads (Google)', 'setCallAdsOn', 'Nightly charge time', 'Max daily spend', 'Founding lock']) assert.ok(!l.includes(w), w)
  assert.match(src('./screens/Settings.jsx'), /<GoLive live=\{account\.live\} \/>/)
})

test('no AI → VA hand-off shown on admin', () => {
  const ai = src('./screens/AiCalls892.jsx')
  assert.doesNotMatch(ai, /Handing to a VA|No VA free|Handed to VA|hands to a VA|goes to a VA/)
  assert.doesNotMatch(src('./data.js'), /every form lead goes to a VA/)
})
