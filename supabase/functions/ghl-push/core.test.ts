/**
 * Unit tests for ghl-push (Prompt 850): the switch keeps it a no-op, rows are
 * pushed to GHL in the right calls and order, failures retry or stop, and the
 * API key never leaks. Fake database, fake fetch with recorded GHL responses
 * (fixtures/), no network: nothing here can reach GoHighLevel.
 * Run: node --test supabase/functions/ghl-push/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contactBody, ghlClient, GhlError, GHL_BASE, GHL_VERSION, type Fetch } from './api.ts'
import { handle, run, tagsFor, type Deps, type OutboxRow, type Settings } from './core.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')
const KEY = 'pit-test-0000-secret'
const LOC = 'l1C08ntBrFjLS0elLIYU'
const CONTACT = 'cI08i1Bls3iTB9bKgFJh'
const LEAD = '0b7e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d'

const ON: Settings = {
  enabled: true, location_id: LOC, workflow_new_inbound: 'wf-new-000001', workflow_appointment_reminder: 'wf-appt-00001',
  workflow_no_show: 'wf-noshow-001', workflow_opt_out: null,
}

const row = (o: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 1, event: 'new_inbound', lead_id: LEAD, stage: 'new', contact_id: null,
  contact_name: 'Dana  Reyes', phone: '+15551234567', email: 'dana@example.com', state: 'TX', ...o,
})

type Sent = { method: string; url: string; headers: Record<string, string>; body: any }

// Fake GHL: answers each path with a recorded response, or a scripted failure.
function fakeGhl(fail: Record<string, { status: number; body: string }> = {}) {
  const sent: Sent[] = []
  const fetchFn: Fetch = async (url, init) => {
    sent.push({ method: init.method, url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined })
    const path = url.slice(GHL_BASE.length)
    const key = Object.keys(fail).find(k => path.includes(k))
    if (key) return { ok: false, status: fail[key].status, text: async () => fail[key].body }
    const body = path === '/contacts/upsert' ? fx('upsert-contact-response.json')
      : path.includes('/workflow/') ? fx('add-to-workflow-response.json') : fx('add-tags-response.json')
    return { ok: true, status: 200, text: async () => body }
  }
  return { sent, fetchFn }
}

function deps(o: { settings?: Settings | null; rows?: OutboxRow[]; apiKey?: string; fail?: Record<string, { status: number; body: string }> } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const logs: string[] = []
  const g = fakeGhl(o.fail)
  const d: Deps = {
    apiKey: 'apiKey' in o ? o.apiKey : KEY,
    ghl: key => ghlClient(key, g.fetchFn),
    settings: async () => ({ data: o.settings === undefined ? ON : o.settings, error: null }),
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      return { data: fn === 'ghl_claim_outbox' ? (o.rows ?? [row()]) : null, error: null }
    },
    log: m => logs.push(m),
  }
  return { d, calls, logs, sent: g.sent }
}

test('switch off: claims nothing and calls GHL never', async () => {
  for (const settings of [null, { ...ON, enabled: false }]) {
    const t = deps({ settings })
    const res = await run(t.d)
    assert.deepEqual(await res.json(), { skipped: 'off' })
    assert.equal(t.calls.length, 0)
    assert.equal(t.sent.length, 0)
  }
})

test('on but not configured: notes it, sends nothing', async () => {
  const t = deps({ apiKey: undefined })
  assert.deepEqual(await (await run(t.d)).json(), { skipped: 'not_configured' })
  assert.deepEqual(t.calls, [{ fn: 'ghl_note_sync', args: { p_status: 'not_configured', p_error: 'GHL_API_KEY not set' } }])
  assert.equal(t.sent.length, 0)
  const u = deps({ settings: { ...ON, location_id: null } })
  await run(u.d)
  assert.equal(u.calls[0].args.p_error, 'location ID not set')
})

test('new inbound: upsert, stage tags, workflow, then done with the contact ID', async () => {
  const t = deps()
  assert.deepEqual(await (await run(t.d)).json(), { claimed: 1, sent: 1, failed: 0 })
  assert.deepEqual(t.sent.map(s => `${s.method} ${s.url.slice(GHL_BASE.length)}`), [
    'POST /contacts/upsert',
    `DELETE /contacts/${CONTACT}/tags`,
    `POST /contacts/${CONTACT}/tags`,
    `POST /contacts/${CONTACT}/workflow/wf-new-000001`,
  ])
  for (const s of t.sent) {
    assert.equal(s.headers.Authorization, `Bearer ${KEY}`)
    assert.equal(s.headers.Version, GHL_VERSION)
  }
  const up = t.sent[0].body
  assert.deepEqual(up, {
    locationId: LOC, source: 'Ohvara', name: 'Dana Reyes', firstName: 'Dana', lastName: 'Reyes',
    phone: '+15551234567', email: 'dana@example.com', state: 'TX',
  })
  assert.equal('tags' in up, false, 'upsert must not send tags (GHL would replace them all)')
  assert.deepEqual(t.sent[2].body, { tags: ['ohvara', 'ohvara-stage-new'] })
  assert.ok(t.sent[1].body.tags.includes('ohvara-stage-booked'))
  assert.ok(!t.sent[1].body.tags.includes('ohvara-stage-new'))
  const fin = t.calls.find(c => c.fn === 'ghl_finish_outbox')!
  assert.deepEqual(fin.args, { p_id: 1, p_ok: true, p_contact_id: CONTACT, p_error: null, p_final: false })
  assert.deepEqual(t.calls.at(-1), { fn: 'ghl_note_sync', args: { p_status: 'ok', p_error: null } })
})

test('stage change has no workflow; booked uses the reminder workflow; no workflow ID set = no call', async () => {
  const t = deps({ rows: [row({ id: 2, event: 'stage', stage: 'met' }), row({ id: 3, event: 'appointment_reminder', stage: 'booked' }), row({ id: 4, event: 'opt_out', stage: null })] })
  await run(t.d)
  const wf = t.sent.filter(s => s.url.includes('/workflow/')).map(s => s.url.split('/workflow/')[1])
  assert.deepEqual(wf, ['wf-appt-00001'])   // opt_out has no workflow ID in ON
})

test('opt-out sets SMS DND on the contact and the opted-out tag', async () => {
  const t = deps({ rows: [row({ event: 'opt_out', stage: null })] })
  await run(t.d)
  assert.deepEqual(t.sent[0].body.dndSettings, { SMS: { status: 'active', message: 'Opted out in Ohvara' } })
  const add = t.sent.find(s => s.method === 'POST' && s.url.endsWith('/tags'))!
  assert.deepEqual(add.body, { tags: ['ohvara', 'ohvara-opted-out'] })
})

test('a 422 is final; a 401, 429 or 500 retries; the API key is never logged', async () => {
  const cases: [number, string, boolean][] = [[422, fx('error-422.json'), true], [401, fx('error-401.json'), false], [429, '{}', false], [500, 'oops', false]]
  for (const [status, body, final] of cases) {
    const t = deps({ fail: { '/contacts/upsert': { status, body } } })
    assert.deepEqual(await (await run(t.d)).json(), { claimed: 1, sent: 0, failed: 1 })
    const fin = t.calls.find(c => c.fn === 'ghl_finish_outbox')!
    assert.equal(fin.args.p_ok, false)
    assert.equal(fin.args.p_final, final, `status ${status}`)
    assert.equal(t.calls.at(-1)!.args.p_status, 'error')
    for (const l of [...t.logs, String(fin.args.p_error)]) {
      assert.ok(!l.includes(KEY))
      assert.ok(!l.includes('5551234567') && !l.includes('dana@'))
    }
  }
  const t = deps({ fail: { '/contacts/upsert': { status: 422, body: fx('error-422.json') } } })
  await run(t.d)
  assert.match(String(t.calls.find(c => c.fn === 'ghl_finish_outbox')!.args.p_error), /phone must be a valid phone number/)
})

test('one bad row does not stop the batch', async () => {
  const t = deps({ rows: [row({ id: 1, phone: null, email: null }), row({ id: 2 })] })
  assert.deepEqual(await (await run(t.d)).json(), { claimed: 2, sent: 1, failed: 1 })
  const fins = t.calls.filter(c => c.fn === 'ghl_finish_outbox').map(c => [c.args.p_id, c.args.p_ok, c.args.p_final])
  assert.deepEqual(fins, [[1, false, true], [2, true, false]])
})

test('a bad key (401) stops the batch after the first row', async () => {
  const t = deps({ rows: [row({ id: 1 }), row({ id: 2 })], fail: { '/contacts/upsert': { status: 401, body: fx('error-401.json') } } })
  assert.deepEqual(await (await run(t.d)).json(), { claimed: 2, sent: 0, failed: 1 })
  assert.equal(t.sent.length, 1)
  assert.deepEqual(t.calls.filter(c => c.fn === 'ghl_finish_outbox').map(c => c.args.p_id), [1])
})

test('empty outbox: no GHL calls, no sync stamp', async () => {
  const t = deps({ rows: [] })
  assert.deepEqual(await (await run(t.d)).json(), { claimed: 0, sent: 0, failed: 0 })
  assert.equal(t.sent.length, 0)
  assert.deepEqual(t.calls.map(c => c.fn), ['ghl_claim_outbox'])
})

test('upsert without a contact ID in the answer is an error, not a silent success', async () => {
  const g = ghlClient(KEY, async () => ({ ok: true, status: 200, text: async () => '{"contact":{}}' }))
  await assert.rejects(g.upsertContact({ locationId: LOC, phone: '+15551234567' }), GhlError)
})

test('handle: POST only, cron only, action run only', async () => {
  const t = deps()
  const mk = (method: string, body?: string) => new Request('https://x/functions/v1/ghl-push', { method, body })
  const h = (req: Request, cron = true) => handle(req, { ...t.d, isCron: async () => cron })
  assert.equal((await h(mk('GET'))).status, 405)
  assert.equal((await h(mk('POST', '{"action":"run"}'), false)).status, 403)
  assert.equal((await h(mk('POST', '{"action":"nope"}'))).status, 400)
  assert.equal((await h(mk('POST', 'not json'))).status, 400)
  assert.equal(t.sent.length, 0)
  assert.equal((await h(mk('POST', '{"action":"run"}'))).status, 200)
})

test('tags and contact body helpers', () => {
  assert.deepEqual(tagsFor(row({ event: 'no_show', stage: 'follow_up' })).add, ['ohvara', 'ohvara-no-show', 'ohvara-stage-follow-up'])
  assert.deepEqual(tagsFor(row({ stage: 'weird' })), { add: ['ohvara'], remove: [] })
  assert.deepEqual(contactBody({ locationId: LOC, name: 'Cher' }), { locationId: LOC, source: 'Ohvara', name: 'Cher', firstName: 'Cher' })
})
