import { assertEquals } from 'jsr:@std/assert'
import { handle, type Deps, type Lead } from './core.ts'

const ID = '11111111-1111-4111-8111-111111111111'
function make(over: Partial<Deps> = {}, lead: Partial<Lead> = {}) {
  const sent: { to: string; body: string }[] = []
  const logs: { status: string }[] = []
  const deps: Deps = {
    smsLive: async () => true,
    getLead: async () => ({ id: ID, lead_type: 'mortgage_protection', phone: '(555) 123-4567', contact_name: 'Pat Doe', agent_name: 'Sam Lee', ...lead }),
    optedOut: async () => false,
    alreadySent: async () => false,
    bookingLink: 'https://example.test/book',
    send: async (to, body) => { sent.push({ to, body }); return { ok: true, sid: 'SMstub' } },
    log: async r => { logs.push(r) },
    ...over,
  }
  return { deps, sent, logs }
}

Deno.test('sms_live off: nothing sent, skipped_gate logged', async () => {
  const t = make({ smsLive: async () => false })
  const r = await handle(t.deps, { lead_id: ID })
  assertEquals(r.body, { status: 'skipped_gate' })
  assertEquals(t.sent.length, 0)
  assertEquals(t.logs.map(l => l.status), ['skipped_gate'])
})

Deno.test('opted out: nothing sent', async () => {
  const t = make({ optedOut: async () => true })
  assertEquals((await handle(t.deps, { lead_id: ID })).body, { status: 'skipped_opt_out' })
  assertEquals(t.sent.length, 0)
})

Deno.test('live + stub sender: one text from the template, agent first name, link', async () => {
  const t = make()
  assertEquals((await handle(t.deps, { lead_id: ID })).body, { status: 'sent' })
  assertEquals(t.sent.length, 1)
  assertEquals(t.sent[0].to, '+15551234567')
  assertEquals(t.sent[0].body.includes('this is Sam about'), true)
  assertEquals(t.sent[0].body.includes('https://example.test/book'), true)
  assertEquals(t.logs.map(l => l.status), ['sent'])
})

Deno.test('other lead types, bad ids, missing link and repeats send nothing', async () => {
  let t = make({}, { lead_type: 'cancellation' })
  assertEquals((await handle(t.deps, { lead_id: ID })).body, { status: 'skipped_not_mp' })
  t = make()
  assertEquals((await handle(t.deps, { lead_id: 'nope' })).status, 400)
  t = make({ bookingLink: null })
  assertEquals((await handle(t.deps, { lead_id: ID })).body, { status: 'skipped_no_link' })
  t = make({ alreadySent: async () => true })
  assertEquals((await handle(t.deps, { lead_id: ID })).body, { status: 'duplicate' })
  assertEquals(t.sent.length, 0)
})
