// The client page log rules (src/lib/clientPageLog.js): words vs plain label, not-ready detection,
// the filter, two time zones, and the loader's two failure modes.
// Run: node --test src/lib/clientPageLog.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isNotReadyError, normalizeContactRow, normalizeContactLog, filterContactRows, contactCounts, dualTime, dualTimeText,
  callResultText, fetchContactLog, normalizeEvent, normalizeEvents, policyChoice, groupThread, rowLabel,
} from './clientPageLog.js'

const row = o => ({
  id: 'recovery_sms_log:1', subject: 'client', channel: 'text', direction: 'out', occurred_at: '2026-11-01T19:00:00Z',
  body: null, call_result: null, sender_type: 'system', sender_name: null, label: 'Recovery text sent', has_recording: false, ...o,
})

test('a row with a body shows the words exactly as stored', () => {
  const r = normalizeContactRow(row({ body: '  Hi Dana, this is Sam.\nCall me back.' }))
  assert.equal(r.body, '  Hi Dana, this is Sam.\nCall me back.')
  assert.equal(r.label, 'Recovery text sent')
})

test('a row with a null or blank body shows the plain label and never rebuilt words', () => {
  for (const body of [null, undefined, '', '   ']) {
    const r = normalizeContactRow(row({ body, label: 'Follow-up text sent' }))
    assert.equal(r.body, null)
    assert.equal(r.label, 'Follow-up text sent')
  }
})

test('with no label from the row, a text reads Text sent and a call reads Call attempt', () => {
  assert.equal(rowLabel({ channel: 'text' }), 'Text sent')
  assert.equal(rowLabel({ channel: 'call', label: ' ' }), 'Call attempt')
})

test('a missing function is not ready, any other failure is not', () => {
  assert.equal(isNotReadyError({ code: 'PGRST202', message: 'Could not find the function public.contact_log' }), true)
  assert.equal(isNotReadyError({ code: '42883', message: 'function contact_log(text) does not exist' }), true)
  assert.equal(isNotReadyError({ message: 'Could not find the function public.contact_log(p_client_key) in the schema cache' }), true)
  assert.equal(isNotReadyError({ code: 'PGRST205', message: 'Could not find the table' }), true)
  assert.equal(isNotReadyError({ code: '42501', message: 'permission denied' }), false)
  assert.equal(isNotReadyError({ code: '22023', message: 'Pass a client key or a lead, not both' }), false)
  assert.equal(isNotReadyError({ message: 'Failed to fetch' }), false)
  assert.equal(isNotReadyError(null), false)
})

const ok = data => ({ data, error: null })
const fail = (code, message) => ({ data: null, error: { code, message } })

test('fetchContactLog: a missing function returns notReady with no rows', async () => {
  const out = await fetchContactLog({ rpc: async () => fail('PGRST202', 'Could not find the function public.contact_log'), clientKey: 'k1' })
  assert.deepEqual(out, { rows: [], notReady: true })
})

test('fetchContactLog: any other error is thrown for the error state', async () => {
  await assert.rejects(fetchContactLog({ rpc: async () => fail('XX000', 'boom'), leadId: 'l1' }), { message: 'boom' })
})

test('fetchContactLog: a missing client-key view is notReady, another lookup error is thrown', async () => {
  const rpc = async () => ok([])
  const a = await fetchContactLog({ rpc, policyIds: ['p1'], lookupKeys: async () => fail('PGRST205', 'Could not find the table') })
  assert.equal(a.notReady, true)
  await assert.rejects(fetchContactLog({ rpc, policyIds: ['p1'], lookupKeys: async () => fail('42501', 'denied') }), { message: 'denied' })
})

test('fetchContactLog: calls the agreed arguments, merges client and lead, newest first, one row per id', async () => {
  const calls = []
  const rpc = async args => {
    calls.push(args)
    return ok(args.p_lead
      ? [row({ id: 'lead_sms_replies:9', subject: 'lead', direction: 'in', occurred_at: '2026-11-01T20:00:00Z', body: 'Yes' })]
      : [row({ id: 'a', occurred_at: '2026-11-01T18:00:00Z' }), row({ id: 'b', occurred_at: '2026-11-01T21:00:00Z' }), row({ id: 'b' })])
  }
  const out = await fetchContactLog({
    rpc, policyIds: ['p1', 'p2'], leadId: 'l1', lookupKeys: async ids => { assert.deepEqual(ids, ['p1', 'p2']); return ok([{ policy_id: 'p1', client_key: 'k1' }, { policy_id: 'p2', client_key: 'k1' }]) },
  })
  assert.deepEqual(calls, [{ p_lead: 'l1', p_limit: 200 }, { p_client_key: 'k1', p_limit: 200 }])
  assert.deepEqual(out.rows.map(r => r.id), ['b', 'lead_sms_replies:9', 'a'])
  assert.equal(out.notReady, false)
})

test('fetchContactLog: nothing to ask about makes no call', async () => {
  const out = await fetchContactLog({ rpc: async () => { throw new Error('should not run') } })
  assert.deepEqual(out, { rows: [], notReady: false })
})

test('filter chips and counts', () => {
  const rows = normalizeContactLog([
    row({ id: 't1' }), row({ id: 'c1', channel: 'call', label: 'Call to client', call_result: 'answered' }), row({ id: 't2', occurred_at: '2026-11-01T10:00:00Z' }),
  ])
  assert.deepEqual(filterContactRows(rows, 'text').map(r => r.id), ['t1', 't2'])
  assert.deepEqual(filterContactRows(rows, 'call').map(r => r.id), ['c1'])
  assert.equal(filterContactRows(rows, 'all').length, 3)
  assert.deepEqual(contactCounts(rows), { all: 3, text: 2, call: 1 })
})

test('call results use plain words and are hidden when the label already says them', () => {
  assert.equal(callResultText('no_answer'), 'Not answered')
  assert.equal(callResultText('some_new_key'), 'Some new key')
  const r = normalizeContactRow(row({ channel: 'call', label: 'Call to client', call_result: 'answered', has_recording: true, sender_type: 'va', sender_name: 'Rae' }))
  assert.equal(r.result, 'Answered')
  assert.equal(r.hasRecording, true)
  assert.equal(r.who, 'Rae · Fulfillment')
  assert.equal(normalizeContactRow(row({ channel: 'call', label: 'Call not answered', call_result: 'no_answer' })).result, '')
})

test('both zones show, with the client zone left out only when it is unknown', () => {
  const iso = '2026-11-01T19:00:00Z'
  assert.equal(dualTimeText(iso, 'America/Chicago', 'America/New_York'), '1:00 PM your time / 2:00 PM client')
  assert.equal(dualTimeText(iso, 'America/Chicago', null), '1:00 PM your time')
  assert.deepEqual(dualTime(iso, 'America/Los_Angeles', 'America/New_York'), { date: 'Nov 1', mine: '11:00 AM', client: '2:00 PM' })
  assert.deepEqual(dualTime('', 'America/Chicago', 'America/New_York'), { date: '', mine: '', client: '' })
})

test('activity events: newest first, plain titles, 50-row limit is the hook', () => {
  const ev = normalizeEvents([
    { id: '1', kind: 'booked', at: '2026-10-30T10:00:00Z', actor_name: null, detail: {} },
    { id: '2', kind: 'rescheduling', at: '2026-11-01T10:00:00Z', actor_name: 'Rae', detail: { reason: 'Wants evening' } },
  ])
  assert.deepEqual(ev.map(e => e.title), ['Needs another call', 'Cancellation call booked'])
  assert.equal(ev[0].sub, 'Rae · Wants evening')
  const hook = readFileSync(new URL('../hooks/useClientContactLog.js', import.meta.url), 'utf8')
  assert.match(hook, /\.limit\(50\)/)
  assert.match(hook, /order\('at', \{ ascending: false \}\)/)
})

test('the hook uses the contact_log function and never reads the raw log tables', () => {
  const hook = readFileSync(new URL('../hooks/useClientContactLog.js', import.meta.url), 'utf8')
  assert.match(hook, /supabase\.rpc\('contact_log'/)
  assert.doesNotMatch(hook, /lead_followup_sms_log|recovery_sms_log|lead_sms_replies/)
})

test('switcher labels and thread runs', () => {
  assert.equal(policyChoice({ policy_number: 'AB123456', carrier_name: 'Aetna' }, 0), 'Aetna 3456')
  assert.equal(policyChoice({}, 1), 'Policy 2')
  const runs = groupThread([
    { id: 'm1', sender_id: 'a', created_at: '2026-11-01T18:00:00Z' },
    { id: 'm2', sender_id: 'a', created_at: '2026-11-01T18:02:00Z' },
    { id: 'm3', sender_id: 'b', created_at: '2026-11-01T18:03:00Z' },
    { id: 'm4', sender_id: 'b', created_at: '2026-11-03T18:00:00Z' },
  ], 'America/Chicago')
  assert.deepEqual(runs.map(g => g.type === 'day' ? 'day' : g.msgs.length), ['day', 2, 1, 'day', 1])
})

test('activity events: a lapse reads Policy lapsed, not Update', () => {
  const [ev] = normalizeEvents([{ id: '9', kind: 'lapsed', at: '2026-11-01T10:00:00Z', actor_name: null, detail: {} }])
  assert.equal(ev.title, 'Policy lapsed')
  assert.equal(normalizeEvent({ id: '9', kind: 'lapsed', at: '2026-11-01T10:00:00Z', detail: {} }).title, 'Policy lapsed')
})
