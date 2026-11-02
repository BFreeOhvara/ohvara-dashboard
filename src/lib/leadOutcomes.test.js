// Lead outcomes on the lead page: Follow up date, Not interested reason, Sold then Submit for servicing.
//   node --test src/lib/leadOutcomes.test.js
// Written from the task. The server side (migration 210, not applied) is stubbed: the tests pin the arguments
// the page sends, the words it shows, the button rule and the prefill-by-id rule, and read the page sources for
// the copy and URL rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  outcomeArgs, checkFollowUp, checkReason, followUpLine, savedLine, isOutcomeMissing, outcomeErrorText, isFollowUpDue,
  canSubmitForServicing, submitForServicingPath, leadById, dealPrefill, REASON_MAX,
} from './leadOutcomes.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const TZ = 'America/Chicago'
const NOW = Date.UTC(2026, 10, 1, 20, 0) // Sun Nov 1, 2:00 PM Central

test('Sold sends only the old arguments, so it works before and after the migration', () => {
  assert.deepEqual(outcomeArgs('L1', { outcome: 'sold' }), { p_lead: 'L1', p_outcome: 'sold', p_note: null })
})

test('Follow up passes p_follow_up_at; Not interested passes p_reason (trimmed)', () => {
  const iso = '2026-11-04T20:00:00.000Z'
  assert.deepEqual(outcomeArgs('L1', { outcome: 'follow_up', followUpAt: iso }), { p_lead: 'L1', p_outcome: 'follow_up', p_note: null, p_follow_up_at: iso })
  assert.deepEqual(outcomeArgs('L1', { outcome: 'not_interested', reason: '  Already covered ' }), { p_lead: 'L1', p_outcome: 'not_interested', p_note: null, p_reason: 'Already covered' })
})

test('the follow up picker is future only, in the agent\'s own zone', () => {
  assert.match(checkFollowUp('', TZ, NOW).error, /Pick a date/)
  assert.match(checkFollowUp('2026-11-01T13:00', TZ, NOW).error, /future/) // 1:00 PM Central, an hour ago
  assert.match(checkFollowUp('2026-11-01T14:00', TZ, NOW).error, /future/) // right now is not the future
  const ok = checkFollowUp('2026-11-04T14:00', TZ, NOW)
  assert.equal(ok.iso, '2026-11-04T20:00:00.000Z') // 2:00 PM CST is 20:00 UTC after the Nov 1 change back
})

test('the saved line reads "Follow up Nov 4 at 2:00 PM"', () => {
  assert.equal(followUpLine('2026-11-04T20:00:00.000Z', TZ), 'Follow up Nov 4 at 2:00 PM')
  assert.equal(savedLine('follow_up', { followUpAt: '2026-11-04T20:00:00.000Z' }, TZ), 'Follow up Nov 4 at 2:00 PM')
})

test('Not interested needs a reason of 1 to 500 characters and shows it in the saved line', () => {
  assert.match(checkReason('').error, /why/)
  assert.match(checkReason('   ').error, /why/)
  assert.equal(checkReason(' Too expensive ').reason, 'Too expensive')
  assert.equal(checkReason('x'.repeat(REASON_MAX)).reason.length, REASON_MAX)
  assert.match(checkReason('x'.repeat(REASON_MAX + 1)).error, /500/)
  assert.equal(savedLine('not_interested', { reason: 'Too expensive' }, TZ), 'Not interested: Too expensive')
})

test('Sold only records: the saved line says nothing about a client', () => {
  const line = savedLine('sold', { at: '2026-11-01T20:00:00.000Z' }, TZ)
  assert.equal(line, 'Marked Sold at 2:00 PM')
  assert.doesNotMatch(line, /client/i)
})

test('a missing function is told apart from a real refusal', () => {
  for (const code of ['PGRST202', '42883']) assert.equal(isOutcomeMissing({ code }), true)
  assert.equal(isOutcomeMissing({ code: '22023' }), false)
  assert.equal(isOutcomeMissing(null), false)
  assert.equal(outcomeErrorText({ code: '22023', message: 'Pick a follow up date in the future' }), 'Pick a follow up date in the future')
  assert.equal(outcomeErrorText({ code: '42501', message: 'nope' }), null)
})

test('follow_up_due marks the lead; a missing column (migration not applied) does not', () => {
  assert.equal(isFollowUpDue({ follow_up_due: true }), true)
  assert.equal(isFollowUpDue({ follow_up_due: false }), false)
  assert.equal(isFollowUpDue({}), false)
})

test('Submit for servicing shows only with a Servicing plan', () => {
  assert.equal(canSubmitForServicing({ role: 'agent', has_servicing: true }), true)
  assert.equal(canSubmitForServicing({ role: 'agent' }), true) // column not there yet: not "leads only"
  assert.equal(canSubmitForServicing({ role: 'agent', has_servicing: false }), false)
  assert.equal(canSubmitForServicing({ role: 'agent', has_servicing: false, billing_exempt: true }), true) // comped, as on Submit
  assert.equal(canSubmitForServicing(null), false)
})

test('the button goes to /agent/submit?kind=deal&lead=<id> and nothing else', () => {
  const path = submitForServicingPath('3f2c1a9e-0000-4000-8000-000000000001')
  assert.equal(path, '/agent/submit?kind=deal&lead=3f2c1a9e-0000-4000-8000-000000000001')
  const q = new URL(path, 'https://x.test').searchParams
  assert.deepEqual([...q.keys()], ['kind', 'lead'])
})

const LEADS = [
  { lead_id: 'mine-1', contact_name: 'Denise  Walker', phone: '+18135550127', city: 'Tampa', state: 'FL' },
  { lead_id: 'mine-2', contact_name: 'Cher', phone: null, city: null, state: 'Florida' },
]

test('prefill reads the lead by id from the agent\'s own list', () => {
  assert.deepEqual(dealPrefill(leadById(LEADS, 'mine-1')), { first: 'Denise', last: 'Walker', phone: '(813) 555-0127', city: 'Tampa', state: 'FL' })
  assert.deepEqual(dealPrefill(leadById(LEADS, 'mine-2')), { first: 'Cher', last: '', phone: '', city: '', state: '' })
})

test('an unknown or another agent\'s id prefills nothing (their lead is not in this list)', () => {
  assert.equal(leadById(LEADS, 'someone-elses'), null)
  assert.equal(dealPrefill(leadById(LEADS, 'someone-elses')), null)
  assert.equal(leadById(LEADS, null), null)
  assert.equal(leadById(undefined, 'mine-1'), null)
})

test('the pages: copy replaced, no client claim, id-only URL, composer untouched', () => {
  const detail = src('../pages/agent/v2/InboundDetail.jsx')
  assert.match(detail, /Sold records the outcome\. Submit it for servicing when you are ready\./)
  assert.match(detail, /Counts toward this week\./)
  assert.doesNotMatch(detail, /Becomes a client|is now your client|makes them your client/)
  assert.match(detail, /Texting coming soon/) // the disabled composer stays as it was
  const lists = src('../pages/agent/v2/Inbounds.jsx')
  assert.doesNotMatch(lists, /makes them your client/)
  assert.match(lists, /Follow up due/)
  const lib = src('./leadOutcomes.js')
  assert.match(lib, /kind=deal&lead=\$\{encodeURIComponent\(leadId\)\}/)
  assert.doesNotMatch(lib, /kind=deal&lead=[^$]*(phone|name|state)/)
})
