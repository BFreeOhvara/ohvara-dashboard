// P952 — the reactivation scrub (core.ts). Run: node --test supabase/functions/reactivation/core.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubRun, scrubberFor, stubScrubber, parseBlacklist, blacklistAlliance, textsRun, reactivationTextBody } from './core.ts'

const store = (claims: any[]) => {
  const calls: any[] = []
  return {
    calls,
    rpc: async (name: string, args: any) => {
      calls.push({ name, args })
      return name === 'reactivation_scrub_claim' ? claims : { ok: true, removed: args.p_flagged?.length ?? 0 }
    },
  }
}

test('no provider connected: nothing is claimed, lists keep waiting', async () => {
  const s = store([{ list_id: 'L1', phones: ['+15125550000'] }])
  const r = await scrubRun(s, 'none', scrubberFor('none', { key: '' }, fetch as any))
  assert.equal(r.lists, 0)
  assert.equal(s.calls.length, 0)
})

test('stub: …0000 is national DNC, …9999 a litigator; the rest stay', async () => {
  const s = store([{ list_id: 'L1', phones: ['+15125550000', '+15125559999', '+15125552001'] }])
  const r: any = await scrubRun(s, 'stub', stubScrubber)
  assert.equal(r.lists, 1)
  const done = s.calls.find(c => c.name === 'reactivation_scrub_done')
  assert.deepEqual(done.args, { p_list: 'L1', p_provider: 'stub',
    p_flagged: [{ phone: '+15125550000', reason: 'national_dnc' }, { phone: '+15125559999', reason: 'litigator' }] })
})

test('a provider error leaves the list waiting (no scrub_done)', async () => {
  const s = store([{ list_id: 'L1', phones: ['+15125552001'] }])
  const r: any = await scrubRun(s, 'blacklist_alliance', { name: 'x', check: async () => { throw new Error('down') } })
  assert.equal(r.results[0].error, 'down')
  assert.equal(s.calls.some(c => c.name === 'reactivation_scrub_done'), false)
})

test('Blacklist Alliance answers', async () => {
  assert.deepEqual(parseBlacklist('+1', { message: 'Blacklisted', code: 'litigator' }), { phone: '+1', reason: 'litigator' })
  assert.deepEqual(parseBlacklist('+1', { message: 'Blacklisted', code: 'fed-dnc' }), { phone: '+1', reason: 'national_dnc' })
  assert.equal(parseBlacklist('+1', { message: 'Good', results: 0 }), null)
  const seen: string[] = []
  const b = blacklistAlliance('k', async url => {
    seen.push(url)
    return { ok: true, status: 200, json: async () => (url.endsWith('5125550000') ? { message: 'Blacklisted', code: 'fed-dnc' } : { message: 'Good' }) }
  })
  assert.deepEqual(await b.check(['+15125550000', '+15125552001']), [{ phone: '+15125550000', reason: 'national_dnc' }])
  assert.match(seen[0], /phone=5125550000$/)
  await assert.rejects(blacklistAlliance('', fetch as any).check(['+15125550000']), /SCRUB_API_KEY/)
})

// P957: booking texts to people who said yes on the call.
const job = (o: any = {}) => ({ id: 't1', step: 'bk_confirm', to: '+14805550123', from: '+16025550100', first: 'Dana', agent: 'Marcus',
  appt_at: '2026-11-12T20:30:00Z', tz: 'America/Phoenix', ...o })
test('P957: the confirmation reads the booked words, no link, with how to stop', () => {
  const b = reactivationTextBody(job())!
  assert.match(b, /^You're set, Dana\. Marcus will call you Thursday at 1:30 PM \(MST\)\. Reply C to confirm/)
  assert.match(b, /Reply STOP to opt out\.$/)
  assert.doesNotMatch(b, /\{|http|deedstone\.com/)
  for (const step of ['bk_day_before', 'bk_morning', 'bk_1h']) assert.doesNotMatch(reactivationTextBody(job({ step }))!, /\{|deedstone\.com/)
  assert.equal(reactivationTextBody(job({ step: 'nm_1' })), null)
})
test('P957: textsRun sends what the database hands out and reports each one', async () => {
  const calls: any[] = []
  const st = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return name === 'reactivation_texts_claim' ? [job(), job({ id: 't2', step: 'bk_1h' })] : null } }
  const sent: any[] = []
  const r = await textsRun(st, async (to, from, body) => { sent.push({ to, from, body }); return sent.length === 1 ? { ok: true, id: 'SM1' } : { ok: false, error: 'blocked' } })
  assert.deepEqual([r.sent, r.failed], [1, 1])
  assert.equal(sent[0].from, '+16025550100')
  assert.deepEqual(calls.filter(c => c.name === 'reactivation_text_sent').map(c => [c.args.p_id, c.args.p_ok, c.args.p_provider_id]), [['t1', true, 'SM1'], ['t2', false, null]])
})
test('P957: no Twilio = nothing claimed', async () => {
  const calls: any[] = []
  const r = await textsRun({ rpc: async (n: string) => { calls.push(n); return [] } }, null)
  assert.equal(r.skipped, 'no_twilio')
  assert.equal(calls.length, 0)
})
