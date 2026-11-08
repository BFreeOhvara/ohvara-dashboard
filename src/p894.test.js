import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { AGENT_STATUSES, AGENT_RESULTS, agentStatusOf, canMove, agentMove, needsResult, countByStatus, soldLeadClients, withSoldLeads } from './template/agentView.js'
import { seedEvents, applyMove, rebookLead, SAMPLE_NOW, addMin } from './template/leadLifecycle.js'
import { stageOfInbound, noShowOpen } from './lib/agentReal.js'
import { agentSlots, agentFree, agentGap, slotOptions, instantOf } from './lib/callSlots.js'

// P894 — the agent's statuses rebuilt around live transfers and booked appointments, and the 30-minute booking gap.
const mk = (id, stage, o = {}) => {
  const l = { id, first_name: 'Ann', last_name: 'Test', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC', kind: 'appointment', status: 'assigned', outcome: null, stage, came: '2026-10-30T10:00', apptAt: null, reply: null, tries: 1, ...o }
  return { ...l, events: seedEvents(l) }
}
const BY_STATUS = {
  booked: mk('b', 'booked', { apptAt: '2026-11-02T13:00' }),
  no_show: mk('n', 'no_show', { apptAt: '2026-11-02T11:00' }),
  follow: mk('f', 'follow_up', { follow: 'Mon, Nov 9', apptAt: '2026-10-30T15:00' }),
  sold: mk('s', 'sold', { apptAt: '2026-10-27T11:00', submitted: true }),
  not_interested: mk('c', 'not_interested', { reason: 'Already covered', apptAt: '2026-10-29T10:00' }),
  closed: mk('u', 'unreachable', { tries: 3 }),
  team: mk('t', 'calling'),
}
const ALL_RESULTS = ['sold', 'no_show', 'follow_up', 'not_interested', 'booked']

test('the five statuses, left to right, and where every stage lands', () => {
  // P898: no Live transfer column; Not interested is on the board.
  assert.deepEqual(AGENT_STATUSES.map(s => s.key), ['booked', 'no_show', 'follow', 'not_interested', 'sold'])
  for (const [key, l] of Object.entries(BY_STATUS)) assert.equal(agentStatusOf(l), key, key)
  assert.equal(agentStatusOf(mk('r', 'ringing', { kind: 'live_call' })), 'booked')
  assert.equal(agentStatusOf(mk('l', 'showed', { kind: 'live_call' })), 'booked')
  assert.equal(agentStatusOf(mk('w', 'not_interested', { reason: 'Wrong number' })), 'closed')
  for (const st of ['new', 'calling', 'missed', 'rebooking']) assert.equal(agentStatusOf(mk(st, st)), 'team', st)
  // "Needs you" and "Our team is on it" are gone as statuses.
  assert.equal(AGENT_STATUSES.some(s => /needs you|on it/i.test(s.label)), false)
})

test('every allowed result moves, every other one is refused', () => {
  const allowed = {
    booked: ['sold', 'no_show', 'follow_up', 'not_interested'],
    live: ['sold', 'follow_up', 'not_interested'],
    no_show: ['not_interested'],
    follow: ['sold', 'booked', 'not_interested'],
    not_interested: ['follow_up'],
    sold: [], closed: [], team: [],
  }
  assert.deepEqual(AGENT_RESULTS, allowed)
  delete allowed.live
  for (const [key, l] of Object.entries(BY_STATUS)) {
    for (const r of ALL_RESULTS) {
      const ok = allowed[key].includes(r)
      assert.equal(canMove(l, r), ok, `${key} -> ${r}`)
      if (ok) assert.equal(agentMove(l, r, r === 'follow_up' ? { follow: 'Thu, Nov 5' } : {}, SAMPLE_NOW).stage, r, `${key} -> ${r}`)
      else assert.throws(() => agentMove(l, r, {}, SAMPLE_NOW), /can’t be moved/, `${key} -> ${r}`)
    }
  }
  // Answering a ringing live transfer is taking the call (P898: it waits on Booked, asking for the result).
  const ringing = mk('r', 'ringing', { kind: 'live_call' })
  assert.equal(canMove(ringing, 'showed'), true)
  assert.equal(canMove(BY_STATUS.booked, 'showed'), false)
  const took = agentMove(ringing, 'showed', {}, SAMPLE_NOW)
  assert.equal(agentStatusOf(took), 'booked')
  assert.equal(needsResult(took), true)
  assert.deepEqual(['sold', 'follow_up', 'not_interested'].map(r => canMove(took, r)), [true, true, true])
})

test('Booked shows Mark result once the time has passed; leads still being called are the team’s', () => {
  assert.equal(needsResult(mk('a', 'booked', { apptAt: addMin(SAMPLE_NOW, 60) })), false)
  assert.equal(needsResult(mk('a', 'booked', { apptAt: addMin(SAMPLE_NOW, -30) })), true)
  const leads = [mk('a', 'new'), mk('b', 'calling'), mk('c', 'missed', { kind: 'live_call' }), mk('d', 'rebooking'), mk('e', 'new'), mk('f', 'calling'), BY_STATUS.booked]
  assert.equal(countByStatus(leads).team, 6)
})

test('a no-show that rebooks goes back to Booked, with the new time; anything else is refused', () => {
  const ns = applyMove(BY_STATUS.booked, 'no_show', {}, SAMPLE_NOW)
  assert.equal(agentStatusOf(ns), 'no_show')
  const back = rebookLead(ns, '2026-11-04T15:00', SAMPLE_NOW)
  assert.equal(back.stage, 'booked')
  assert.equal(agentStatusOf(back), 'booked')
  assert.equal(back.apptAt, '2026-11-04T15:00')
  assert.equal(back.events.find(e => e.kind === 'booked' && /^Rebooked for/.test(e.label)).role, 'lead')
  assert.equal(back.events.some(e => e.state === 'scheduled' && /rebook/i.test(e.label)), false) // the team's rebook call is dropped
  assert.equal(needsResult(back), false)
  assert.throws(() => rebookLead(BY_STATUS.follow, '2026-11-04T15:00', SAMPLE_NOW))
  assert.throws(() => rebookLead(ns, addMin(SAMPLE_NOW, -5), SAMPLE_NOW))
})

test('real rows: a no_show after the booking is No show; a newer booking puts it back on Booked', () => {
  const r = { inbound_stage: 'contacting', inbound_product: 'appointment' }
  const booked = { kind: 'booked', state: 'done', at: '2026-11-02T15:00:00Z', created_at: '2026-11-01T10:00:00Z', detail: { appointment_at: '2026-11-02T15:00:00Z' } }
  const noShow = { kind: 'no_show', state: 'done', at: '2026-11-02T15:40:00Z', created_at: '2026-11-02T15:40:00Z' }
  const rebooked = { kind: 'booked', state: 'done', at: '2026-11-02T18:00:00Z', created_at: '2026-11-02T18:00:00Z', detail: { at: '2026-11-04T16:00:00Z' } }
  assert.equal(noShowOpen([booked, noShow]), true)
  assert.equal(stageOfInbound(r, '2026-11-02T15:00:00Z', [booked, noShow]), 'no_show')
  assert.equal(noShowOpen([booked, noShow, rebooked]), false)
  assert.equal(stageOfInbound({ ...r, inbound_stage: 'booked' }, '2026-11-04T16:00:00Z', [booked, noShow, rebooked]), 'booked')
  assert.equal(stageOfInbound(r, '2026-11-04T16:00:00Z', [booked, noShow, rebooked]), 'booked')
  assert.equal(stageOfInbound(r, null, []), 'calling')
})

test('every sold lead is on Clients as Setting up', () => {
  const nina = mk('nina', 'sold', { first_name: 'Nina', phone: '(704) 555-0119', apptAt: '2026-10-30T13:00', submitted: false })
  const denise = mk('denise', 'sold', { first_name: 'Denise', phone: '(404) 555-0127', apptAt: '2026-10-27T11:00', submitted: true })
  const fresh = agentMove(BY_STATUS.booked, 'sold', {}, SAMPLE_NOW)
  const clients = [{ id: 'c4', client_first_name: 'Denise', client_last_name: 'Test', client_phone: '(404) 555-0127', stage: 'setting_up', steps: [], calls: [] }]
  const made = soldLeadClients([nina, denise, fresh, BY_STATUS.follow], clients)
  assert.deepEqual(made.map(c => c.lead_id), ['nina', 'b']) // Denise already has her client row; a follow-up isn't sold
  for (const c of made) {
    assert.equal(c.stage, 'setting_up')
    assert.equal(c.next_step, 'Add the policy details')
    assert.ok(Array.isArray(c.steps) && Array.isArray(c.calls))
  }
  assert.equal(made[0].submitted, 'Fri, Oct 30')
  assert.equal(withSoldLeads(clients, [nina, denise]).length, 2)
  // A real sale links its client row by id.
  assert.equal(soldLeadClients([{ ...nina, real: true, phone: '', clientId: 'p1' }], [{ id: 'p1', client_phone: '' }]).length, 0)
})

test('the 30-minute gap: nothing bookable within 30 minutes of another booked call, whatever the length setting', () => {
  const tz = 'America/Chicago'
  const at = c => instantOf('2026-11-04', c, tz)
  const appts = [{ id: 'x', iso: at('3:00 PM') }]
  assert.equal(agentGap(15, 0), 30)
  assert.equal(agentGap(30, 15), 45)
  assert.equal(agentFree(at('2:31 PM'), appts, { length: 15 }), false)
  assert.equal(agentFree(at('3:29 PM'), appts, { length: 15 }), false)
  assert.equal(agentFree(at('3:30 PM'), appts, { length: 15 }), true)
  assert.equal(agentFree(at('2:30 PM'), appts, { length: 15 }), true)
  const slots = agentSlots({ date: '2026-11-04', clocks: ['2:15 PM', '2:30 PM', '2:45 PM', '3:00 PM', '3:15 PM', '3:30 PM'], clientTz: tz, appts, length: 15 })
  assert.deepEqual(slots.map(s => [s.clock, s.open]), [['2:15 PM', true], ['2:30 PM', true], ['2:45 PM', false], ['3:00 PM', false], ['3:15 PM', false], ['3:30 PM', true]])
  // The picker greys the taken ones out: shown, not pickable.
  const opts = slotOptions(slots)
  assert.deepEqual(opts.filter(o => o.disabled).map(o => [o.value, o.sub]), [['2:45 PM', 'Taken'], ['3:00 PM', 'Taken'], ['3:15 PM', 'Taken']])
})

test('the server refuses a booking inside the gap (migration p894, not applied)', () => {
  const sql = readFileSync('supabase/migrations/p894_booking_gap.sql', 'utf8')
  assert.match(sql, /create trigger inbound_events_booking_gap\s+before insert on public\.inbound_events/)
  assert.match(sql, /abs\(extract\(epoch from \(t\.at - p_at\)\)\) < 30 \* 60/)
  assert.match(sql, /hint = 'booking_gap'/)
  // The AI's slots, the desk's next slot and the rebook suggestion all skip the gap.
  for (const fn of ['ai_caller_slots', 'va_next_open_slot', 'lead_next_rebook_slot']) assert.match(sql, new RegExp(`function public\\.${fn}[\\s\\S]*?P894`), fn)
  assert.match(sql, /greatest\(v_gap, interval '30 minutes'\)/)
  // The desk's picker reads the agent's booked times, Fulfillment and admin only.
  assert.match(sql, /function public\.agent_booked_slots[\s\S]*?is_fulfillment\(\) or public\.is_admin\(\)/)
})
