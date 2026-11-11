// P952 — the reactivation scrub (core.ts). Run: node --test supabase/functions/reactivation/core.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scrubRun, scrubberFor, stubScrubber, parseBlacklist, blacklistAlliance } from './core.ts'

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
