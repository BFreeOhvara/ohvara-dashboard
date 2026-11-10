/**
 * Unit tests for ghl-webhook (Prompt 850): only signed or secret-carrying
 * requests get in, replies land in lead_sms_replies once, texts GHL sent land
 * on the timeline, opt-outs are always honoured, the switch drops the rest.
 * Recorded GHL payloads (fixtures/), signed with a TEST Ed25519 key made here;
 * fake database, no network.
 * Run: node --test supabase/functions/ghl-webhook/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync, sign } from 'node:crypto'
import { classify, GHL_ED25519_PUBLIC_KEY, handle, SECRET_HEADER, verifyGhlSignature, type Deps, type ReplyRow, type Settings } from './core.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8').trim()
const LOC = 'l1C08ntBrFjLS0elLIYU'
const LEAD = '0b7e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d'
const AGENT = '9f1c2b3a-4d5e-4f60-8a7b-1c2d3e4f5a6b'
const SECRET = 'whsec-test-0123456789'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const PUB = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const signed = (raw: string) => sign(null, Buffer.from(raw, 'utf8'), privateKey).toString('base64')

const ON: Settings = { enabled: true, location_id: LOC }

function fakeDb(o: { settings?: Settings | null; lead?: boolean; rpcError?: string; insertError?: string } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const rows: ReplyRow[] = []
  const logs: string[] = []
  const d: Deps = {
    sharedSecret: SECRET,
    publicKey: PUB,
    settings: async () => ({ data: o.settings === undefined ? ON : o.settings, error: null }),
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (o.rpcError) return { data: null, error: { message: o.rpcError } }
      if (fn === 'ghl_lead_for_contact') return { data: o.lead === false ? [] : [{ lead_id: LEAD, agent_id: AGENT, is_sample: false }], error: null }
      if (fn === 'ghl_log_text') return { data: 'inserted', error: null }
      if (fn === 'client_text_intake') return { data: { ok: true, intent: 'question' }, error: null }
      return { data: null, error: null }
    },
    insertReply: async row => {
      if (o.insertError) return { error: { message: o.insertError } }
      if (rows.some(r => r.twilio_sid === row.twilio_sid)) return { error: { message: 'duplicate key', code: '23505' } }
      rows.push(row)
      return { error: null }
    },
    log: m => logs.push(m),
  }
  return { d, calls, rows, logs }
}

const req = (raw: string, headers: Record<string, string> = {}, method = 'POST') =>
  new Request('https://x/functions/v1/ghl-webhook', { method, body: method === 'GET' ? undefined : raw, headers })
const viaSig = (raw: string) => req(raw, { 'x-ghl-signature': signed(raw) })
const viaSecret = (raw: string) => req(raw, { [SECRET_HEADER]: SECRET })

test('unsigned, badly signed, wrong secret or tampered: 401 and nothing touched', async () => {
  const raw = fx('inbound-message.json')
  const db = fakeDb()
  for (const r of [
    req(raw),
    req(raw, { 'x-ghl-signature': 'N/A' }),
    req(raw, { 'x-ghl-signature': signed(raw + ' ') }),
    req(raw.replace('3 works', '4 works'), { 'x-ghl-signature': signed(raw) }),
    req(raw, { [SECRET_HEADER]: 'wrong' }),
    req(raw, { 'x-wh-signature': 'legacy-rsa-not-accepted' }),
  ]) assert.equal((await handle(r, db.d)).status, 401)
  assert.equal(db.calls.length + db.rows.length, 0)
  const noSecret = fakeDb()
  noSecret.d.sharedSecret = undefined
  assert.equal((await handle(req(raw, { [SECRET_HEADER]: '' }), noSecret.d)).status, 401)
  assert.equal((await handle(req('', {}, 'GET'), db.d)).status, 405)
})

test('signature checks use the real GHL key format', async () => {
  assert.equal(await verifyGhlSignature('{}', signed('{}'), PUB), true)
  assert.equal(await verifyGhlSignature('{}', signed('{}'), GHL_ED25519_PUBLIC_KEY), false)   // our test key is not GHL's
  assert.equal(await verifyGhlSignature('{}', 'not base64!!', PUB), false)
})

test('a reply is saved once for the VA queue, tied to the lead', async () => {
  const raw = fx('inbound-message.json')
  const db = fakeDb()
  const res = await handle(viaSig(raw), db.d)
  assert.deepEqual(await res.json(), { ok: 'reply_saved', matched: true, client: 'question' })
  assert.deepEqual(db.rows, [{ twilio_sid: 'ghl:msgInb0000000000001', from_phone: '+15551234567', body: 'Yes tomorrow at 3 works', lead_id: LEAD }])
  assert.deepEqual(db.calls[0], { fn: 'ghl_lead_for_contact', args: { p_contact_id: 'cI08i1Bls3iTB9bKgFJh', p_phone: '+15551234567' } })
  // P924: the text becomes a pod task and a drafted reply.
  assert.deepEqual(db.calls[1], { fn: 'client_text_intake', args: { p_phone: '+15551234567', p_body: 'Yes tomorrow at 3 works', p_message_id: 'ghl:msgInb0000000000001' } })
  // GHL retries the same delivery: nothing saved twice, still 200.
  const again = await handle(viaSig(raw), db.d)
  assert.equal(again.status, 200)
  assert.deepEqual(await again.json(), { ok: 'duplicate', matched: true })
  assert.equal(db.rows.length, 1)
})

test('a reply from an unknown number is kept with no lead', async () => {
  const db = fakeDb({ lead: false })
  await handle(viaSig(fx('inbound-message.json')), db.d)
  assert.equal(db.rows[0].lead_id, null)
})

test('STOP opts the number out (source GHL) and is not saved as a reply, even with the switch off', async () => {
  for (const settings of [ON, { enabled: false, location_id: LOC }, null]) {
    const db = fakeDb({ settings })
    const res = await handle(viaSig(fx('inbound-stop.json')), db.d)
    assert.deepEqual(await res.json(), { ok: 'opted_out' })
    assert.deepEqual(db.calls, [{ fn: 'sms_set_opt', args: { p_phone: '+15551234567', p_opted_out: true, p_source: 'GHL' } }])
    assert.equal(db.rows.length, 0)
  }
})

test('START opts back in only while the switch is on', async () => {
  const raw = fx('inbound-stop.json').replace('"STOP"', '"START"')
  const on = fakeDb()
  assert.deepEqual(await (await handle(viaSig(raw), on.d)).json(), { ok: 'opted_in' })
  assert.equal(on.calls[0].args.p_opted_out, false)
  const off = fakeDb({ settings: { enabled: false, location_id: LOC } })
  assert.deepEqual(await (await handle(viaSig(raw), off.d)).json(), { skipped: 'off' })
  assert.equal(off.calls.length, 0)
})

test('a text GHL sent goes on the lead timeline with its status', async () => {
  const db = fakeDb()
  const res = await handle(viaSig(fx('outbound-message.json')), db.d)
  assert.deepEqual(await res.json(), { ok: 'inserted' })
  const log = db.calls.find(c => c.fn === 'ghl_log_text')!
  assert.deepEqual(log.args, {
    p_lead: LEAD, p_agent: AGENT, p_message_id: 'msgOut0000000000001',
    p_body: 'Hi Dana, this is Ohvara confirming your call tomorrow at 3 PM.', p_status: 'sent',
    p_at: '2026-11-05T17:30:00.000Z', p_is_sample: false,
  })
  const none = fakeDb({ lead: false })
  assert.deepEqual(await (await handle(viaSig(fx('outbound-message.json')), none.d)).json(), { ignored: 'no lead' })
  assert.equal(none.calls.some(c => c.fn === 'ghl_log_text'), false)
})

test('switch off: replies and sent texts are dropped with a 200', async () => {
  for (const f of ['inbound-message.json', 'outbound-message.json']) {
    const db = fakeDb({ settings: { enabled: false, location_id: LOC } })
    const res = await handle(viaSig(fx(f)), db.d)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { skipped: 'off' })
    assert.equal(db.calls.length + db.rows.length, 0)
  }
})

test('another location, email, unknown events: ignored', async () => {
  const db = fakeDb({ settings: { enabled: true, location_id: 'OtherLocation01' } })
  assert.deepEqual(await (await handle(viaSig(fx('inbound-message.json')), db.d)).json(), { ignored: 'other location' })
  assert.deepEqual(await (await handle(viaSig(fx('inbound-email.json')), db.d)).json(), { ignored: 'not sms' })
  assert.deepEqual(await (await handle(viaSig('{"type":"ContactCreate","locationId":"x"}'), db.d)).json(), { ignored: 'event ContactCreate' })
  assert.deepEqual(await (await handle(viaSig('not json'), db.d)).json(), { ignored: 'not json' })
  assert.equal(db.calls.length + db.rows.length, 0)
})

test('ContactDndUpdate with SMS DND on opts out; DND off does not opt in', async () => {
  const db = fakeDb()
  assert.deepEqual(await (await handle(viaSig(fx('contact-dnd.json')), db.d)).json(), { ok: 'opted_out' })
  assert.equal(db.calls[0].args.p_source, 'GHL')
  const off = fx('contact-dnd.json').replace('"dnd":true', '"dnd":false').replace('"SMS":{"status":"active"', '"SMS":{"status":"inactive"')
  assert.deepEqual(await (await handle(viaSig(off), db.d)).json(), { ignored: 'not an sms opt-out' })
  assert.equal(db.calls.length, 1)
})

test('workflow webhooks (shared secret): reply saved once by body hash, opt-out honoured', async () => {
  const raw = fx('workflow-reply.json')
  const db = fakeDb()
  assert.deepEqual(await (await handle(viaSecret(raw), db.d)).json(), { ok: 'reply_saved', matched: true, client: 'question' })
  assert.match(db.rows[0].twilio_sid, /^ghl:wf-[0-9a-f]{32}$/)
  assert.equal(db.rows[0].body, 'Can we move it to Friday?')
  await handle(viaSecret(raw), db.d)
  assert.equal(db.rows.length, 1)
  const opt = fakeDb({ settings: { enabled: false, location_id: LOC } })
  assert.deepEqual(await (await handle(viaSecret(fx('workflow-opt-out.json')), opt.d)).json(), { ok: 'opted_out' })
  assert.deepEqual(await classify({ customData: {} }, '{}'), { kind: 'ignore', why: 'unknown payload' })
})

test('database errors answer 500 so GHL retries; logs never carry the phone or body', async () => {
  const a = fakeDb({ rpcError: 'boom' })
  assert.equal((await handle(viaSig(fx('inbound-stop.json')), a.d)).status, 500)
  assert.equal((await handle(viaSig(fx('outbound-message.json')), a.d)).status, 500)
  const b = fakeDb({ insertError: 'disk full' })
  assert.equal((await handle(viaSig(fx('inbound-message.json')), b.d)).status, 500)
  for (const l of [...a.logs, ...b.logs]) {
    assert.ok(!l.includes('5551234567'))
    assert.ok(!l.includes('3 works') && !l.includes('Dana'))
  }
})

test('oversized requests are refused before anything else', async () => {
  const db = fakeDb()
  const big = JSON.stringify({ type: 'InboundMessage', body: 'x'.repeat(70 * 1024) })
  assert.equal((await handle(viaSig(big), db.d)).status, 413)
})

// ── P858: lead_created (the Deedstone page / Meta form lead) ─────────────────
test('lead_created: the lead goes to ghl_intake_lead with the agent ID, type and Meta option', async () => {
  const raw = fx('workflow-lead.json')
  const db = fakeDb()
  db.d.rpc = async (fn, args) => { db.calls.push({ fn, args }); return { data: { lead_id: LEAD, routing: 'matched', duplicate: false }, error: null } }
  const res = await handle(viaSecret(raw), db.d)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: 'lead_saved', routing: 'matched' })
  assert.equal(db.calls.length, 1)
  assert.equal(db.calls[0].fn, 'ghl_intake_lead')
  const p = db.calls[0].args.p as Record<string, unknown>
  assert.equal(p.agent_id, AGENT)
  assert.equal(p.lead_type, 'booked_appointment')
  assert.equal(p.meta_option, 'form_page')
  assert.equal(p.phone, '+15125558201')
  assert.equal(p.campaign_id, 'cmp-dana-mp')
  assert.equal(p.contact_id, 'cL3adC0nt4ct00000001')
  assert.match(String(p.intake_key), /^wf-[0-9a-f]{32}$/)
})

test('lead_created: no agent ID still saves (admin Unassigned); short words map to the two types', async () => {
  const a = await classify(JSON.parse(fx('workflow-lead-no-agent.json')), fx('workflow-lead-no-agent.json'))
  assert.equal(a.kind, 'lead')
  if (a.kind !== 'lead') return
  assert.equal(a.lead.agent_id, null)
  assert.equal(a.lead.lead_type, 'live_call')
  assert.equal(a.lead.meta_option, 'page_only')
})

test('lead_created: the same delivery twice has the same intake key (saved once by the database)', async () => {
  const raw = fx('workflow-lead.json')
  const [a, b] = await Promise.all([classify(JSON.parse(raw), raw), classify(JSON.parse(raw), raw)])
  assert.ok(a.kind === 'lead' && b.kind === 'lead' && a.lead.intake_key === b.lead.intake_key)
  const withId = { ...JSON.parse(raw), customData: { ...JSON.parse(raw).customData, intake_id: 'evt-123456' } }
  const c = await classify(withId, JSON.stringify(withId))
  assert.ok(c.kind === 'lead' && c.lead.intake_key === 'evt-123456')
})

test('lead_created: bad payloads are dropped, not retried; switch off saves nothing; db down retries', async () => {
  const raw = fx('workflow-lead.json')
  const noPhone = JSON.stringify({ ...JSON.parse(raw), phone: undefined })
  assert.deepEqual(await classify(JSON.parse(noPhone), noPhone), { kind: 'ignore', why: 'no phone' })
  const badType = JSON.stringify({ ...JSON.parse(raw), customData: { ohvara_event: 'lead_created', lead_type: 'cold' } })
  assert.deepEqual(await classify(JSON.parse(badType), badType), { kind: 'ignore', why: 'unknown lead type' })

  const off = fakeDb({ settings: { enabled: false, location_id: LOC } })
  assert.deepEqual(await (await handle(viaSecret(raw), off.d)).json(), { skipped: 'off' })
  assert.equal(off.calls.length, 0)

  const refused = fakeDb()
  refused.d.rpc = async () => ({ data: null, error: { message: 'bad phone', code: '22023' } })
  const r1 = await handle(viaSecret(raw), refused.d)
  assert.equal(r1.status, 200)
  assert.deepEqual(await r1.json(), { ignored: 'bad lead' })

  const down = fakeDb({ rpcError: 'connection reset' })
  assert.equal((await handle(viaSecret(raw), down.d)).status, 500)
  assert.ok(down.logs.every(l => !l.includes('5558201') && !l.includes('Angela')), 'logs carry no phone or name')

  const other = JSON.stringify({ ...JSON.parse(raw), location: { id: 'zzOtherLocation01' } })
  const o = fakeDb()
  assert.deepEqual(await (await handle(viaSecret(other), o.d)).json(), { ignored: 'other location' })

  const dup = fakeDb()
  dup.d.rpc = async () => ({ data: { lead_id: LEAD, routing: 'duplicate', duplicate: true }, error: null })
  assert.deepEqual(await (await handle(viaSecret(raw), dup.d)).json(), { ok: 'duplicate', routing: 'duplicate' })
})

// ── P915: the short agent code, the test flag, "campaign created" and "campaign state" ──
test('lead_created: a DS-XXXX code in the link and the test flag reach ghl_intake_lead', async () => {
  const base = JSON.parse(fx('workflow-lead.json'))
  const body = { ...base, customData: { ...base.customData, agent_id: 'DS-OWEN', is_test: 'true' } }
  const a = await classify(body, JSON.stringify(body))
  assert.ok(a.kind === 'lead')
  if (a.kind !== 'lead') return
  assert.equal(a.lead.agent_id, 'DS-OWEN')
  assert.equal(a.lead.is_test, true)
  const plain = await classify(base, JSON.stringify(base))
  assert.ok(plain.kind === 'lead' && plain.lead.is_test === false)
})

test('campaign_created: GoHighLevel\'s new campaign is saved on the agent (ghl_campaign_created)', async () => {
  const raw = fx('workflow-campaign-created.json')
  const db = fakeDb()
  const res = await handle(viaSecret(raw), db.d)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: 'campaign_saved' })
  assert.equal(db.calls.length, 1)
  assert.equal(db.calls[0].fn, 'ghl_campaign_created')
  assert.deepEqual(db.calls[0].args.p, {
    agent_id: 'DS-OWEN', campaign_id: 'ghl-cmp-owen-01', fb_campaign_id: '120210000188',
    campaign_name: 'Deedstone · Owen Fisher · DS-OWEN', lead_type: 'appts',
  })
})

test('campaign_created: no agent or no campaign is ignored; an unknown agent is not retried; db down retries; off saves nothing', async () => {
  const base = JSON.parse(fx('workflow-campaign-created.json'))
  const noAgent = { ...base, customData: { ...base.customData, agent_id: undefined } }
  assert.deepEqual(await classify(noAgent, JSON.stringify(noAgent)), { kind: 'ignore', why: 'no agent id' })
  const noCamp = { ...base, customData: { ...base.customData, campaign_id: undefined, fb_campaign_id: undefined } }
  assert.deepEqual(await classify(noCamp, JSON.stringify(noCamp)), { kind: 'ignore', why: 'no campaign id' })
  const raw = fx('workflow-campaign-created.json')
  const unknown = fakeDb()
  unknown.d.rpc = async () => ({ data: null, error: { message: 'unknown agent', code: '22023' } })
  const r = await handle(viaSecret(raw), unknown.d)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ignored: 'unknown agent' })
  assert.equal((await handle(viaSecret(raw), fakeDb({ rpcError: 'connection reset' }).d)).status, 500)
  const off = fakeDb({ settings: { enabled: false, location_id: LOC } })
  assert.deepEqual(await (await handle(viaSecret(raw), off.d)).json(), { skipped: 'off' })
  assert.equal(off.calls.length, 0)
})

test('campaign_state: what GoHighLevel did with an on/off push goes to ghl_campaign_state', async () => {
  const raw = fx('workflow-campaign-state.json')
  const db = fakeDb()
  assert.deepEqual(await (await handle(viaSecret(raw), db.d)).json(), { ok: 'state_saved' })
  assert.equal(db.calls[0].fn, 'ghl_campaign_state')
  assert.deepEqual(db.calls[0].args.p, { agent_id: 'DS-OWEN', lead_type: 'appts', state: 'paused' })
  const noState = { ...JSON.parse(raw), customData: { ohvara_event: 'campaign_state', agent_id: 'DS-OWEN' } }
  assert.deepEqual(await classify(noState, JSON.stringify(noState)), { kind: 'ignore', why: 'no state' })
})
