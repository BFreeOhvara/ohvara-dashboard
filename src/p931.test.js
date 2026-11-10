// P931 — VA side, final: every call is just a call, a simple call panel, the cancel call done right, tidy Clients and
// Pay, Training back on the rail, no-show rebook calls by the AI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stepsOf, whyShort, whyLine, factsOf, textsOf, typeOf, MAX_STEPS } from './template/ful/callSteps.js'
import { FUL_TABS } from './template/ful/paths.js'
import { hourGrid } from './template/ful/pay931.js'
import { MY_SHEET, weekPay } from './template/ful/p879.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const client = { client_first_name: 'Ann', client_last_name: 'Lee', client_phone: '(214) 555-0100', carrier_name: 'Foresters', draft_day: 3 }
const task = (kind, o = {}) => ({ kind, name: 'Ann Lee', agent: 'Dana Ruiz', carrier: 'Foresters', client, ...o })
const ITEMS = [
  ['cancel_old', { name: 'Ann Lee', agent: 'Dana Ruiz', carrier: 'Foresters', old_carrier: 'Globe Life', client }],
  ['handoff', task('handoff_call')],
  ['save', task('lapse_save', { missed: { notice: 'missed', due: 'Nov 3' } })],
  ['save', task('lapse_save', { missed: { check: true } })],
  ['change', task('address_change')],
  ['change', task('beneficiary_change')],
  ['cancel_request', task('cancel_request')],
  ['callback', task('callback', { why: 'missed_call' })],
  ['callback', task('callback', { why: 'client_text', text: 'my bank changed' })],
  ['welcome', task('welcome_call')],
  ['review', task('annual_review')],
]

test('every call type has at most 3 steps and a one-line why', () => {
  assert.equal(MAX_STEPS, 3)
  for (const [type, it] of ITEMS) {
    assert.equal(typeOf(it), type, it.kind)
    const steps = stepsOf(it)
    assert.ok(steps.length >= 1 && steps.length <= 3, `${type}: ${steps.length} steps`)
    assert.ok(whyShort(it).length <= 22, `${type}: "${whyShort(it)}" fits a Calendar box`)
    assert.doesNotMatch(whyLine(it), /\n/)
  }
})

test('no identity checks on a call we booked (no "confirm it’s them", no date of birth)', () => {
  for (const [, it] of ITEMS) {
    const words = JSON.stringify(stepsOf(it))
    assert.doesNotMatch(words, /confirm it|date of birth|check the caller/i, it.kind || 'cancel')
  }
  assert.doesNotMatch(read('./template/ful/screens/Clients.jsx'), /VerifyCaller/)
  assert.doesNotMatch(read('./template/ful/screens/Calendar.jsx'), /Confirm it is them/)
})

test('cancel the old policy: call the client, call the carrier and merge them in, the client talks, log it', () => {
  const [a, b, c] = stepsOf(ITEMS[0][1])
  assert.match(a.title, /Call Ann/)
  assert.match(a.say, /We’re cancelling your old Globe Life policy today\. Stay near your phone\. You can hold, or hang up and I’ll ring you back/)
  assert.match(b.title, /Call Globe Life, then merge Ann in/)
  assert.match(b.say, /I’m helping my friend, who’s on the other line, cancel their policy/)
  assert.match(c.title, /Ann does the talking/)
  assert.match(c.sub, /Stay on to help.*No confirmation number/)
})

test('the panel shows the client: name, phone, carrier, draft date, agent; texts are what we know', () => {
  assert.deepEqual(factsOf(ITEMS[1][1]).map(([k]) => k), ['Name', 'Phone', 'Carrier', 'Draft date', 'Agent'])
  assert.equal(factsOf(ITEMS[1][1])[3][1], 'The 3rd')
  const t = textsOf(task('callback', { why: 'client_text', text: 'hi', reply: 'We got it' }), 'Tue, Nov 10, 3:00 PM CT (their time)')
  assert.deepEqual(t.map(m => m.from), ['them', 'us', 'us'])
  const ui = read('./template/ful/CallPanel.jsx')
  assert.match(ui, /useState\(false\)/) // Texts closed by default
  assert.match(ui, /aria-expanded=\{open\}/)
})

test('Calendar: no type filters or status chips, just the weeks; boxes are stable and never cut words off', () => {
  const cal = read('./template/ful/screens/Calendar.jsx')
  assert.doesNotMatch(cal, /PillTabs|FILTERS|fs-cal-chips/)
  assert.match(cal, /WEEK_LABEL = \['This week', 'Next week'\]/)
  // The box component lives outside Calendar, so a click doesn't remount every box (the "reload").
  assert.ok(cal.indexOf('function Ev(') < cal.indexOf('export default function Calendar('))
  assert.doesNotMatch(cal.slice(cal.indexOf('export default function Calendar(')), /const Ev = /)
  assert.match(cal, /<b>\{e\.name\}<\/b><span className="tp-num">\{e\.time\}<\/span><small>\{e\.why\}<\/small>/)
  assert.match(cal, /clientStatus\(c \? clientStatusOf\(c, todayIso\)/)
  assert.match(read('./template/ful/ful.css'), /\.tp-ev\.fs-ev > \* \{ white-space: normal; overflow: visible; text-overflow: clip;/)
})

test('Training is on the rail only, not a header tab', () => {
  assert.equal(FUL_TABS.some(([k]) => k === 'training'), false)
  assert.match(read('./template/ful/FulFrame.jsx'), /<NavLink to=\{fp\('training'\)\} className="fx-ri tp-wig"/)
})

test('Clients: Closed is a switch, no agent filter, agent-style pills, a search box that fits its words', () => {
  const ui = read('./template/ful/screens/Clients.jsx')
  assert.match(ui, /Show closed<\/span><Switch/)
  assert.doesNotMatch(ui, /label="Agent"|useFulAgents|Every agent/)
  assert.match(ui, /<FilterPills label="Status"/)
  assert.match(ui, /placeholder="Find a client, phone, policy…"/)
  assert.match(read('./template/ful/screens/clients931.css'), /fs-cl-find \{ flex: 0 1 300px; min-width: 260px; \}/)
  assert.ok(ui.includes("`ck-stand is-${st}`"))
})

test('Pay: the hours as a days × hours grid with each day’s total and the week’s', () => {
  const g = hourGrid(MY_SHEET)
  assert.equal(g.rows.length, 7)
  assert.equal(g.hours.length, 12)
  assert.equal(g.total, weekPay().hours)
  const mon = g.rows.find(r => r.name === 'Mon')
  assert.equal(mon.cells[0], 0) // P945: scheduled 8:00 AM, nothing in the 7 o'clock hour
  assert.equal(mon.cells[1], 1)
  assert.equal(g.rows.find(r => r.name === 'Sat').off, true)
  const ui = read('./template/ful/screens/Pay.jsx')
  assert.doesNotMatch(ui, /fs-bars|fs-pay-sum/)
  assert.match(ui, /role="table" aria-label="This week's hours by day"/)
})

test('a VA only talks to sold clients: no lead callbacks in the VA sample, no-show rebooks go to the AI', () => {
  const ful = read('./template/ful/data.js')
  assert.doesNotMatch(ful, /mkTask\('cb-\d+', 'callback', null/)
  assert.doesNotMatch(ful, /bookNoShowCall/)
  assert.match(read('./template/screens/Leads.jsx'), /our AI caller calls them to book again/)
  assert.match(read('./template/m/MLeads.jsx'), /our AI caller calls them to book again/)
})

test('only an unknown number calling in gets one light check', () => {
  const ph = read('./template/ful/Phone.jsx')
  assert.match(ph, /offer && !offer\.leadId && !offer\.policyId && <small className="fs-cs-why">A number we don't know\. Before any policy detail, one light check/)
})
