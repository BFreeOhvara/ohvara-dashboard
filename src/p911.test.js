// P911 — Agent Clients: steady cards, a stage checklist for every Working policy (one rule for Protected), the same
// checklist on the VA's client view, the header Messages toggle, and Ohvara Support pinned in Messages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOURNEYS, journeyOf, stagesOf, stageLine, completeStep, trackOpen } from './lib/clientStages.js'
import { clientStatusOf, answerCheck, markLapsed } from './lib/clientCheck.js'
import { SAMPLE_CLIENTS } from './template/data/index.js'
import { pinSupport, isSupport, SUPPORT_THREAD, emptySupport } from './template/support911.js'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const TODAY = '2026-11-02'
const byId = id => SAMPLE_CLIENTS.find(c => c.id === id)
const states = c => stagesOf(c).steps.map(s => s.state)

test('four journeys, in the agent-facing words, each ending back at Protected', () => {
  assert.deepEqual(JOURNEYS.new_policy.steps.map(s => s.label), ['Sold and submitted', 'Hand-off call with our team', 'Policy approved by the carrier', 'Old policy cancelled', 'First payment cleared'])
  assert.deepEqual(JOURNEYS.save.steps.map(s => s.label), ['Problem found', 'Save call booked', 'Client reached', 'Fixed with the carrier', 'Payment cleared'])
  assert.deepEqual(JOURNEYS.change.steps.map(s => s.label), ['Requested', 'Call booked', 'Done with the carrier', 'Confirmed'])
  assert.deepEqual(JOURNEYS.added.steps.map(s => s.label), ['Added', 'Welcome call', 'Details confirmed'])
})

test('sample data: each journey has a client at a different step (done, current, upcoming, skipped)', () => {
  // New policy at steps 2, 3 and 4.
  assert.deepEqual(states(byId('sample-client-1')), ['done', 'current', 'upcoming', 'upcoming', 'upcoming'])
  assert.deepEqual(states(byId('sample-client-3')), ['done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.deepEqual(states(byId('sample-client-4')), ['done', 'done', 'done', 'current', 'upcoming'])
  // Saving a policy at step 3, with the booked call on the current step.
  const ann = stagesOf(byId('sample-client-7'))
  assert.equal(ann.kind, 'save')
  assert.deepEqual(ann.steps.map(s => s.state), ['done', 'done', 'current', 'upcoming', 'upcoming'])
  assert.equal(ann.current.next, 'Tue, Nov 3, 10:00 AM')
  assert.equal(ann.steps[0].at, 'Oct 31')
  // Change request at step 2; client you added at step 2.
  assert.equal(stagesOf(byId('sample-client-5')).kind, 'change')
  assert.equal(stageLine(byId('sample-client-5')), 'Stage 2 of 4 · Call booked')
  assert.equal(stageLine(byId('sample-client-8')), 'Stage 2 of 3 · Welcome call')
  // A save that couldn't be saved: Closed with the reason.
  const frank = byId('sample-client-12')
  assert.equal(clientStatusOf(frank, TODAY), 'closed')
  assert.match(stagesOf(frank).closed, /Couldn’t be saved/)
  // Every journey is on the sample.
  const kinds = new Set(SAMPLE_CLIENTS.filter(c => c.track).map(c => c.track.kind))
  assert.deepEqual([...kinds].sort(), ['added', 'change', 'new_policy', 'save'])
})

test('immediate draft: skipped old-policy step, Working until the hand-off is done and the first payment clears', () => {
  const owen = byId('sample-client-13')
  assert.deepEqual(states(owen), ['done', 'current', 'done', 'skipped', 'upcoming'])
  assert.equal(stageLine(owen), 'Stage 2 of 4 · Hand-off call with our team')
  assert.equal(clientStatusOf(owen, TODAY), 'working')
  const handed = completeStep(owen, 'handoff', 'Nov 3')
  assert.equal(clientStatusOf(handed, TODAY), 'working') // the first payment hasn't cleared yet
  assert.equal(stageLine(handed), 'Stage 4 of 4 · First payment cleared')
  const cleared = completeStep(handed, 'first_payment', 'Nov 6')
  assert.equal(trackOpen(cleared), false)
  assert.equal(clientStatusOf({ ...cleared, check_from: null }, TODAY), 'protected')
})

test('one rule for Protected: nothing pending and the latest draft cleared', () => {
  const base = { id: 'x', client_first_name: 'A', client_last_name: 'B', stage: 'protected', status: 'effective', draft_day: 7, check_from: '2026-01-01', checked_through: '2026-10-07' }
  assert.equal(clientStatusOf(base, TODAY), 'protected')
  assert.equal(clientStatusOf({ ...base, request: 'Beneficiary change in progress' }, TODAY), 'working') // a change is pending
  const change = { ...base, track: { kind: 'change', done: { requested: 'Oct 29', booked: 'Oct 30', carrier: 'Nov 1' } } }
  assert.equal(clientStatusOf(change, TODAY), 'working')
  assert.equal(clientStatusOf(completeStep(change, 'confirmed', 'Nov 2'), TODAY), 'protected') // back to Protected
  // A save that ends: fixing clears and the client is Protected again.
  const lapsed = markLapsed(base, TODAY)
  assert.equal(journeyOf(lapsed), 'save')
  assert.deepEqual(states(lapsed), ['done', 'current', 'upcoming', 'upcoming', 'upcoming'])
  let s = lapsed
  for (const k of ['booked', 'reached', 'fixed', 'cleared']) s = completeStep(s, k, 'Nov 4')
  assert.equal(s.fixing, null)
  assert.equal(clientStatusOf(s, TODAY), 'protected')
  // A No on the monthly check starts a save the same way.
  assert.equal(journeyOf(answerCheck(base, '2026-10-07', false)), 'save')
})

test('a client without a track gets one from its fields', () => {
  const soldLead = { id: 'sold-1', fromLead: true, stage: 'setting_up', next_step: 'Add the policy details', submitted: 'Mon, Nov 2' }
  assert.deepEqual(states(soldLead), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
  assert.equal(journeyOf({ stage: 'needs_attention', attention: 'Draft failed on Nov 1' }), 'save')
  assert.equal(journeyOf({ stage: 'requests', next_step: 'Address change' }), 'change')
  assert.equal(journeyOf({ added: true, stage: 'setting_up' }), 'added')
  assert.deepEqual(states({ stage: 'setting_up', submitted: 'Tue, Oct 27', replacing: false }), ['done', 'current', 'upcoming', 'skipped', 'upcoming'])
})

test('cards: one shape, no premium box, buttons pinned at the bottom', () => {
  const src = read('./template/screens/Clients.jsx')
  const card = src.slice(src.indexOf('function ClientCard'), src.indexOf('function ClientDrawer'))
  assert.doesNotMatch(card, /Premium|monthly_premium|Money/)
  assert.match(card, /Drafts the/)
  assert.match(card, /cameOn\(c\)/)
  assert.match(card, /ck-stand/)
  assert.match(card, /ck-bot/)
  assert.match(read('./template/p911.css'), /\.fx-ccard-bot\.ck-bot \{ margin-top: auto/)
  // The drawer shows premium only when entered, and the checklist for Working.
  assert.match(src, /Number\(c\.monthly_premium\) > 0 \? \[\['Monthly premium'/)
  assert.match(src, /<StageBlock c=\{c\} \/>/)
  // The VA's client view shows the same checklist, read-only.
  assert.match(read('./template/ful/screens/Clients.jsx'), /<StageBlock c=\{c\} who="va" \/>/)
})

test('header Messages icon: selected while open, a second click closes it to Overview', () => {
  for (const f of ['./template/TemplateFrame.jsx', './template/ful/FulFrame.jsx']) {
    const src = read(f)
    assert.match(src, /useMessagesToggle\(/, f)
    assert.match(src, /<NavLink to=\{(paths\.messages\(\)|fp\('messages'\))\} className=\{`fx-ib/, f)
    assert.match(src, /is-msg-closing/, f)
  }
  assert.match(read('./template/p911.css'), /\.fx \.fx-ib\.active \{/)
})

test('Ohvara Support is pinned at the top and never hidden', () => {
  const threads = [{ id: 't1', name: 'Gloria Santos' }, { id: SUPPORT_THREAD, support: true, name: 'Ohvara Support' }, { id: 't2', name: 'Robert Chen' }]
  assert.deepEqual(pinSupport(threads).map(t => t.id), [SUPPORT_THREAD, 't1', 't2'])
  assert.deepEqual(pinSupport(threads, t => t.name.includes('Zed')).map(t => t.id), [SUPPORT_THREAD]) // a search can't hide it
  assert.ok(isSupport(emptySupport()))
  assert.match(read('./template/data/index.js'), /id: SUPPORT_THREAD, support: true/)
  assert.match(read('./template/ful/data.js'), /id: SUPPORT_THREAD, support: true/)
  assert.match(read('./adminshell/screens/Messages.jsx'), /as \$\{SUPPORT_NAME\}/)
})
