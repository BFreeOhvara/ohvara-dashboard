// Live-transfer duty helpers: the missing-function check and the "since" clock.
//   node --test src/lib/duty.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isDutyMissing, dutySince } from './duty.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

test('a missing table or function is told apart from a real failure', () => {
  for (const code of ['PGRST205', 'PGRST202', '42P01', '42883']) assert.equal(isDutyMissing({ code }), true, code)
  assert.equal(isDutyMissing({ code: '500' }), false)
  assert.equal(isDutyMissing(null), false)
})

test('agents have no duty switch; the cards point to live-call hours on Billing', () => {
  const today = src('../components/agent/TodayCards.jsx')
  const inbounds = src('../pages/agent/v2/Inbounds.jsx')
  for (const file of [today, inbounds]) {
    assert.doesNotMatch(file, /useAgentDuty|role="switch"|<Switch/)
    assert.match(file, /Live transfers ring you inside your live-call hours/)
    assert.match(file, /to="\/agent\/billing"/)
  }
  assert.doesNotMatch(src('../hooks/useAgentDuty.js'), /function useAgentDuty/)
})

test("Active since reads the agent's own clock", () => {
  const now = new Date('2026-10-29T21:20:00Z')
  assert.equal(dutySince('2026-10-29T19:14:00Z', now), '2:14 PM')
  assert.equal(dutySince('2026-10-29T19:14:00Z', now, 'America/New_York'), '3:14 PM')
  assert.equal(dutySince('2026-10-27T19:14:00Z', now), 'Oct 27, 2:14 PM')
  assert.equal(dutySince(null, now), '')
})
