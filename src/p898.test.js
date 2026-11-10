import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AGENT_STATUSES, CLOSED_STATUS, AGENT_RESULTS, RESULT_MEANING, RESULT_STATUS, agentStatusOf, agentChip, canMove, agentMove, needsResult, resultsFor, isLiveCall, followDays, countByStatus } from './template/agentView.js'
import { seedEvents, SAMPLE_NOW, dayLabel } from './template/leadLifecycle.js'

// P898 — agent lead statuses, round 2: no Live transfer column, Not interested on the board, the status picker, Call
// only on phones.
const mk = (id, stage, o = {}) => {
  const l = { id, first_name: 'Ann', last_name: 'Test', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC', kind: 'appointment', status: 'assigned', outcome: null, stage, came: '2026-10-30T10:00', apptAt: null, reply: null, tries: 1, ...o }
  return { ...l, events: seedEvents(l) }
}
const ALL = ['sold', 'no_show', 'follow_up', 'not_interested', 'booked']
const CASES = {
  booked: [mk('b', 'booked', { apptAt: '2026-11-02T13:00' }), ['sold', 'no_show', 'follow_up', 'not_interested']],
  live: [mk('l', 'showed', { kind: 'live_call' }), ['sold', 'follow_up', 'not_interested']],
  ringing: [mk('r', 'ringing', { kind: 'live_call' }), ['sold', 'follow_up', 'not_interested']], // P917
  no_show: [mk('n', 'no_show', { apptAt: '2026-11-02T11:00' }), ['not_interested']],
  follow: [mk('f', 'follow_up', { follow: 'Mon, Nov 9' }), ['sold', 'booked', 'not_interested']],
  not_interested: [mk('x', 'not_interested', { reason: 'Already covered' }), ['follow_up']],
  sold: [mk('s', 'sold', { submitted: true }), []],
  closed: [mk('u', 'unreachable', { tries: 3 }), []],
  wrong: [mk('w', 'not_interested', { reason: 'Wrong number' }), []],
  team: [mk('t', 'calling'), []],
}

test('board columns, left to right: Booked, No show, Follow up, Not interested, Sold; no Live transfer', () => {
  assert.deepEqual(AGENT_STATUSES.map(s => s.label), ['Booked', 'No show', 'Follow up', 'Not interested', 'Sold'])
  assert.equal(AGENT_STATUSES.some(s => /live/i.test(s.label) || s.key === 'live'), false)
  // Couldn't reach stays under Show closed; a wrong number too. Not interested is its own column.
  assert.equal(CLOSED_STATUS.key, 'closed')
  assert.equal(agentStatusOf(CASES.closed[0]), 'closed')
  assert.equal(agentStatusOf(CASES.wrong[0]), 'closed')
  assert.equal(agentStatusOf(CASES.not_interested[0]), 'not_interested')
  // Five distinct colours on the board.
  assert.equal(new Set(AGENT_STATUSES.map(s => s.tone)).size, 5)
})

test('every allowed move works, every other one is refused', () => {
  for (const [name, [l, ok]] of Object.entries(CASES)) {
    assert.deepEqual(resultsFor(l), ok, name)
    for (const r of ALL) {
      const allowed = ok.includes(r)
      assert.equal(canMove(l, r), allowed, `${name} -> ${r}`)
      if (allowed) assert.equal(agentMove(l, r, r === 'follow_up' ? { follow: 'Thu, Nov 5', followAt: '2026-11-05T09:00' } : {}, SAMPLE_NOW).stage, r, `${name} -> ${r}`)
      else assert.throws(() => agentMove(l, r, {}, SAMPLE_NOW), /can’t be moved/, `${name} -> ${r}`)
    }
  }
  assert.deepEqual(AGENT_RESULTS.not_interested, ['follow_up'])
  // Every result has a one-line meaning and a colour for the picker.
  for (const r of ALL) { assert.ok(RESULT_MEANING[r], r); assert.ok(AGENT_STATUSES.some(s => s.key === RESULT_STATUS[r]), r) }
  assert.match(RESULT_MEANING.sold, /bought a policy/)
})

test('Not interested back to Follow up stays on the record', () => {
  const back = agentMove(CASES.not_interested[0], 'follow_up', { follow: 'Thu, Nov 5', followAt: '2026-11-05T09:00' }, SAMPLE_NOW)
  assert.equal(agentStatusOf(back), 'follow')
  assert.equal(back.follow, 'Thu, Nov 5')
  const row = back.events.find(e => e.audit) // P910: the follow-up call and its reminder texts follow it
  assert.match(row.label, /^Changed from Not interested to Follow up Thu, Nov 5/)
  assert.equal(row.audit, true)
})

test('P910: a live call gets no column: it is pinned (live) until marked, then moves to that status', () => {
  const ringing = CASES.ringing[0]
  assert.equal(agentStatusOf(ringing), 'live')
  assert.deepEqual(agentChip(ringing), ['blue', 'Live call · ringing now'])
  const took = agentMove(ringing, 'showed', {}, SAMPLE_NOW)
  assert.equal(isLiveCall(took), true)
  assert.equal(agentStatusOf(took), 'live')
  assert.equal(needsResult(took), true)
  assert.deepEqual(agentChip(took), ['blue', 'Live call · pick the result'])
  assert.deepEqual(resultsFor(took), ['sold', 'follow_up', 'not_interested'])
  // Picking a result unpins it.
  assert.equal(agentStatusOf(agentMove(took, 'sold', {}, SAMPLE_NOW)), 'sold')
  assert.equal(agentStatusOf(agentMove(took, 'not_interested', { reason: 'Already covered' }, SAMPLE_NOW)), 'not_interested')
  const by = countByStatus([ringing, took, CASES.booked[0]])
  assert.equal(by.booked, 1)
  assert.equal(by.live, 2)
})

test('Follow up asks for a day: the next ten weekdays, the reminder on that day', () => {
  const days = followDays(SAMPLE_NOW)
  assert.equal(days.length, 10)
  assert.equal(days[0].at, '2026-11-03T09:00') // SAMPLE_NOW is Mon Nov 2
  assert.equal(days.every(d => !/^(Sat|Sun)/.test(d.label)), true)
  assert.equal(days[0].label, dayLabel(days[0].at))
  assert.equal(days.every(d => d.at > SAMPLE_NOW), true) // the server needs a future date
  assert.equal(followDays('2026-11-06T16:00')[0].label, 'Mon, Nov 9') // Friday skips the weekend
})

test('Leads page: no team bar, no "Five statuses" line; Call goes through Deedstone (P916), number + copy beside it', () => {
  const leads = readFileSync(new URL('./template/screens/Leads.jsx', import.meta.url), 'utf8')
  assert.equal(/TeamLine|teamLine|Five statuses/.test(leads), false)
  // P899: Call or copy is one component, shared with the client drawer. P916: Call is a Deedstone call at every width.
  assert.match(leads, /<CallOr phone=\{lead\.phone\} target=\{null\}/)
  const call = readFileSync(new URL('./template/CallOrCopy.jsx', import.meta.url), 'utf8')
  assert.match(call, /<DeedstoneCallButton target=\{target\}/)
  assert.match(call, /navigator\.clipboard\.writeText/)
  const css = readFileSync(new URL('./template/leads873.css', import.meta.url), 'utf8')
  assert.match(css, /\.lc-call \{ display: inline-flex;/)
  assert.match(css, /@media \(max-width: 767\.98px\) \{\s*\.lc-tel \{ display: inline-flex !important; \}\s*\.lc-num \{ display: none !important; \}/)
  const picker = readFileSync(new URL('./template/LeadOutcome.jsx', import.meta.url), 'utf8')
  assert.match(picker, /role="radiogroup" aria-label="Result"/)
  assert.match(picker, /role="radiogroup" aria-label="Follow up day"/)
  assert.match(picker, /followAt: slot\.at/) // the real save needs the date, not just the label
})
