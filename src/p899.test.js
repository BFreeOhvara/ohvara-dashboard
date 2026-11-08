import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHECK_DEFAULTS, CLIENT_STATUS, STATUS_ORDER, draftIn, draftDates, isCheckDraft, dueCheck, nextCheck, clientStatusOf, requestTag, checkLists, listQuestion, answerCheck, answerList, markLapsed, saveCallFor, replacementGate, cancelDueBy, nextWorkday } from './lib/clientCheck.js'
import { EMPTY_SUBMIT, missingFields, buildSubmission } from './template/submitModel.js'
import { FIELDS, NEEDED, checkRow } from './lib/bookImport.js'
import { gateWords } from './lib/documents.js'

// P899 — clients, simplified: three statuses (+ Closed), the monthly "Still on the books?" check, fewer fields, and
// the replacement gate opening on "issued".
const mk = (id, o = {}) => ({ id, client_first_name: 'Ann', client_last_name: id, client_phone: '(512) 555-0100', stage: 'protected', status: 'effective', draft_day: 7, check_from: '2026-01-01', checked_through: null, ...o })

test('statuses: Working, Needs attention, Protected, and Closed behind a switch', () => {
  assert.deepEqual(STATUS_ORDER.map(k => CLIENT_STATUS[k].label), ['Needs attention', 'Working', 'Protected'])
  assert.equal(CLIENT_STATUS.working.sub, 'Our team is on it.')
  const today = '2026-11-20'
  const done = { checked_through: '2026-11-07' }
  assert.equal(clientStatusOf(mk('a', { stage: 'setting_up' }), today), 'working') // new policy being set up
  assert.equal(clientStatusOf(mk('b', { stage: 'needs_attention', ...done }), today), 'working') // a problem the team is fixing
  assert.equal(clientStatusOf(mk('c', { missed: { done: false }, ...done }), today), 'working') // a missed payment
  assert.equal(clientStatusOf(mk('d', done), today), 'protected')
  assert.equal(clientStatusOf(mk('e', { stage: 'requests', request: 'Address change in progress', ...done }), today), 'protected')
  assert.equal(requestTag(mk('e', { stage: 'requests', request: 'Address change in progress' })), 'Address change in progress')
  assert.equal(requestTag(mk('f', { stage: 'requests', next_step: 'Beneficiary change in progress' })), 'Beneficiary change in progress')
  assert.equal(requestTag(mk('g')), null)
  assert.equal(clientStatusOf(mk('h', { closed: true }), today), 'closed')
  assert.equal(clientStatusOf(mk('i', { status: 'Cancelled' }), today), 'closed')
  assert.equal(clientStatusOf(mk('j'), today), 'needs_attention') // the Nov 7 draft, asked Nov 10, not answered
})

test('the check is asked 3 days after the draft date (admin setting), one per client', () => {
  const c = mk('a', { checked_through: '2026-10-07' })
  assert.equal(dueCheck(c, '2026-11-09'), null) // drafted Nov 7, asked on the 10th
  assert.deepEqual(dueCheck(c, '2026-11-10'), { draft: '2026-11-07', askOn: '2026-11-10', k: 10 })
  assert.equal(dueCheck(c, '2026-11-10', { ...CHECK_DEFAULTS, delayDays: 5 }), null)
  assert.equal(dueCheck(c, '2026-11-12', { ...CHECK_DEFAULTS, delayDays: 5 }).askOn, '2026-11-12')
  // Unanswered for months: only the newest draft is asked.
  assert.equal(dueCheck(mk('b', { checked_through: '2026-06-07' }), '2026-11-20').draft, '2026-11-07')
  // A 31st drafts on the month's last day.
  assert.equal(draftIn(2026, 10, 31), '2026-11-30')
  assert.deepEqual(draftDates(31, '2027-01-15', '2027-03-31'), ['2027-01-31', '2027-02-28', '2027-03-31'])
  // No draft day or no start: nothing to ask.
  assert.equal(dueCheck(mk('c', { draft_day: null }), '2026-11-20'), null)
  assert.equal(dueCheck(mk('d', { check_from: null }), '2026-11-20'), null)
})

test('monthly for the first 12 drafts, then every 3 months; both are settings', () => {
  const ks = Array.from({ length: 24 }, (_, k) => k).filter(k => isCheckDraft(k))
  assert.deepEqual(ks, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 17, 20, 23])
  assert.deepEqual(Array.from({ length: 12 }, (_, k) => k).filter(k => isCheckDraft(k, { monthlyFor: 6, thenEvery: 2 })), [0, 1, 2, 3, 4, 5, 7, 9, 11])
  // Month 13 (k = 12) isn't asked; month 15 (k = 14) is.
  const c = mk('a', { draft_day: 7, check_from: '2026-01-01', checked_through: '2026-12-07' })
  assert.equal(dueCheck(c, '2027-01-10'), null) // k = 12
  assert.equal(dueCheck(c, '2027-02-10'), null) // k = 13
  assert.equal(dueCheck(c, '2027-03-10').draft, '2027-03-07') // k = 14
  assert.equal(nextCheck({ ...c, checked_through: '2027-03-07' }, '2027-03-11').askOn, '2027-06-10')
})

test('one list per draft day, one tap answers all, or tick only the ones that fell off', () => {
  const today = '2026-11-11'
  const clients = [mk('a', { draft_day: 7 }), mk('b', { draft_day: 7 }), mk('c', { draft_day: 8 }), mk('d', { draft_day: 9, checked_through: '2026-10-09' }), mk('e', { draft_day: 7, stage: 'setting_up' }), mk('f', { draft_day: 7, checked_through: '2026-11-07' })]
  const lists = checkLists(clients, today)
  assert.deepEqual(lists.map(l => [l.draft, l.clients.map(c => c.id)]), [['2026-11-07', ['a', 'b']], ['2026-11-08', ['c']]]) // the 9th is asked tomorrow
  assert.equal(listQuestion(lists[0]), 'These policies drafted on the 7th. Are they still on the books?')
  assert.equal(listQuestion(lists[1]), 'This policy drafted on the 8th. Is it still on the books?')
  // All still on the books
  assert.deepEqual(answerList(lists[0]), { yes: ['a', 'b'], no: [] })
  // Tick only the ones that fell off
  assert.deepEqual(answerList(lists[0], ['b']), { yes: ['a'], no: ['b'] })
  // Unanswered lists stay
  assert.equal(checkLists(clients, '2026-11-25').length, 3)
})

test('Yes → Protected, No → Working with a save call, Lapsed → Working', () => {
  const today = '2026-11-10'
  const c = mk('a', { client_first_name: 'Ann', agentName: 'Dana' })
  const yes = answerCheck(c, '2026-11-07', true)
  assert.equal(clientStatusOf(yes, today), 'protected')
  assert.equal(yes.checked_through, '2026-11-07')
  const no = answerCheck(c, '2026-11-07', false)
  assert.equal(clientStatusOf(no, today), 'working')
  assert.deepEqual(no.fixing, { why: 'off_books', since: '2026-11-07' })
  const task = saveCallFor(no, 'off_books', today)
  assert.equal(task.kind, 'lapse_save')
  assert.equal(task.due, '2026-11-11')
  assert.match(task.note, /Dana says Ann’s policy is no longer on the books \(the Nov 7 draft\)/)
  // Lapsed from any card: Working, the due check counts as answered.
  const gone = markLapsed(mk('b', { checked_through: '2026-09-07' }), today)
  assert.equal(clientStatusOf(gone, today), 'working')
  assert.equal(gone.checked_through, '2026-11-07')
  assert.equal(gone.fixing.why, 'lapsed')
  assert.equal(clientStatusOf(markLapsed(mk('c', { checked_through: '2026-11-07' }), '2026-11-08'), '2026-11-08'), 'working')
  // Friday's No is due Monday.
  assert.equal(nextWorkday('2026-11-13'), '2026-11-16')
})

test('replacement gate opens on "issued", cancel due before the old draft', () => {
  assert.deepEqual(replacementGate({ applies: false }), { applies: false, open: true, waiting_for: [] })
  assert.deepEqual(replacementGate({ applies: true, issued_on: null }).waiting_for, ['issued'])
  assert.equal(replacementGate({ applies: true, issued_on: null }).open, false)
  assert.equal(replacementGate({ applies: true, issued_on: 'Nov 2' }).open, true) // no wait for the first payment
  assert.equal(replacementGate({ applies: true, issued_on: null, override: 'Client insists' }).open, true)
  // Issued Mon Nov 2, old policy drafts the 9th → cancel by Fri Nov 6.
  assert.deepEqual(cancelDueBy(9, '2026-11-02'), { draft: '2026-11-09', due: '2026-11-06' })
  // Issued the day before the old draft → cancel that same day; issued on the draft day → stop the next one.
  assert.deepEqual(cancelDueBy(3, '2026-11-02'), { draft: '2026-11-03', due: '2026-11-02' })
  assert.deepEqual(cancelDueBy(2, '2026-11-02'), { draft: '2026-12-02', due: '2026-12-01' })
  assert.match(gateWords({ applies: true, open: true, cancel_by: 'Nov 6', old_draft: 'Nov 9' }), /issued\. Cancel the old one by Nov 6, before its Nov 9 draft/)
  assert.match(gateWords({ applies: true, open: false, waiting_for: ['issued'] }), /^Waiting until the new policy is issued/)
  assert.doesNotMatch(gateWords({ applies: true, open: false, waiting_for: ['issued'] }), /first payment/)
})

test('Submit and Add clients ask only name, phone, city, state, carrier, draft day (+ premium, notes)', () => {
  for (const k of ['email', 'dob', 'product', 'number', 'face', 'beneficiary']) assert.equal(k in EMPTY_SUBMIT, false, k)
  const base = { ...EMPTY_SUBMIT, name: 'Ruth Ellison', phone: '5125550188', city: 'Austin', state: 'TX', carrier: 'Globe Life' }
  assert.deepEqual(missingFields(base, { policy: true }), ['draftDay']) // premium is optional now
  const s = buildSubmission({ ...base, draftDay: '9', replacing: true, oldCarrier: 'Americo', oldDraftDay: '9' }, 'agent', { policy: true })
  assert.deepEqual(s.policy, { premium: null, draftDay: 9 })
  assert.deepEqual(s.replaces, { carrier: 'Americo', draftDay: 9, cancelWhen: 'after_new_issued_before_old_draft' })
  assert.deepEqual(missingFields({ ...base, draftDay: '9', replacing: true, oldCarrier: 'Americo' }, { policy: true }), ['oldDraftDay'])
  for (const k of ['email', 'dob', 'product']) assert.equal(k in s, false, k)
  assert.deepEqual(FIELDS.map(f => f.key), ['first_name', 'last_name', 'phone', 'city', 'state', 'carrier', 'draft_day', 'monthly_premium', 'notes'])
  assert.deepEqual(NEEDED, ['first_name', 'last_name', 'phone', 'city', 'state', 'carrier', 'draft_day'])
  assert.equal(checkRow({ first_name: 'Ivy', last_name: 'Tran', phone: '(214) 555-0123', city: 'Dallas', state: 'TX', carrier: 'Americo', draft_day: '3' }).status, 'ok')
})
