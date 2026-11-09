// P910 — agent side, round 3: live calls pinned (no column), Your to-dos, follow-up auto-booking 30 minutes clear,
// the no-show VA booking, Sold pre-fill, and one paid day ahead (sample side + the unapplied migration).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { followUpSlot, FOLLOW_CLEAR_MIN, instantOf, clockOf } from './lib/callSlots.js'
import { agentStatusOf, liveCalls, liveFacts, followUpPick, AGENT_STATUSES } from './template/agentView.js'
import { applyMove, needsYouNow, SAMPLE_NOW } from './template/leadLifecycle.js'
import { nightly, paidAhead, adsRunOn } from './template/spendPlan.js'

const TZ = 'America/Chicago'
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const lead = (id, stage, o = {}) => ({ id, first_name: 'Ann', last_name: id, phone: '(918) 555-0100', city: 'Tulsa', state: 'OK', stage, came: '2026-11-02T09:00', events: [], ...o })
const at = (d, c) => instantOf(d, c, TZ)
const from = at('2026-11-02', '2:14 PM')

test('live calls get no column: pinned (ringing first), with what the AI collected', () => {
  assert.equal(AGENT_STATUSES.some(s => s.key === 'live'), false)
  const a = lead('a', 'showed', { kind: 'live_call', came: '2026-11-02T13:41', wants: 'Final expense, $15k', note: 'Wife is on the policy' })
  const b = lead('b', 'ringing', { kind: 'live_call', came: '2026-11-02T14:10' })
  const booked = lead('c', 'showed', { apptAt: '2026-11-02T10:00' })
  assert.deepEqual(liveCalls([a, booked, b]).map(l => l.id), ['b', 'a'])
  assert.equal(agentStatusOf(a), 'live')
  assert.equal(agentStatusOf(booked), 'booked')
  const facts = Object.fromEntries(liveFacts(a))
  assert.equal(facts.Wants, 'Final expense, $15k')
  assert.equal(facts.Notes, 'Wife is on the policy')
  // Marking it moves it to that status and unpins it.
  for (const [r, st] of [['sold', 'sold'], ['follow_up', 'follow'], ['not_interested', 'not_interested']]) {
    const m = applyMove(a, r, r === 'follow_up' ? { follow: 'Tue', followAt: '2026-11-03T15:00' } : r === 'not_interested' ? { reason: 'Already covered' } : {}, SAMPLE_NOW)
    assert.equal(agentStatusOf(m), st, r)
    assert.equal(liveCalls([m]).length, 0, r)
  }
})

test('an unmarked live call becomes a to-do after its day; the to-do box can be empty', () => {
  const today = lead('t', 'showed', { kind: 'live_call', came: '2026-11-02T10:00' })
  const old = lead('o', 'showed', { kind: 'live_call', came: '2026-10-30T16:17' })
  assert.deepEqual(needsYouNow({ leads: [today] }, SAMPLE_NOW), [])
  assert.deepEqual(needsYouNow({ leads: [today, old] }, SAMPLE_NOW).map(n => [n.trigger, n.ref, n.action]), [['live', 'o', 'Mark result']])
  const ui = read('./template/screens/Overview.jsx')
  assert.match(ui, /Your to-dos/)
  assert.match(ui, /You\{'’'\}re all caught up\./)
  assert.doesNotMatch(read('./template/screens/Leads.jsx'), /Live call · Mark result|label="Lead type"/)
})

test('follow-up auto-booking: the lead’s window, else afternoon, never within 30 minutes of another call', () => {
  assert.equal(FOLLOW_CLEAR_MIN, 30)
  // No best time → afternoon.
  const s0 = followUpSlot({ from, agentTz: TZ, leadTz: TZ })
  assert.equal(s0.window, 'afternoon')
  assert.equal(clockOf(s0.iso, TZ), '2:30 PM')
  // A call at 3:00 → 2:30 and 3:30 are too close (30 min clear around a 30-minute call), so 4:00.
  const appts = [{ id: 'x', iso: at('2026-11-02', '3:00 PM') }]
  const s1 = followUpSlot({ from, agentTz: TZ, leadTz: TZ, appts })
  assert.equal(clockOf(s1.iso, TZ), '4:00 PM')
  // Mornings → the next morning.
  const s2 = followUpSlot({ from, window: 'Mornings', agentTz: TZ, leadTz: TZ })
  assert.equal(s2.date, '2026-11-03')
  assert.equal(s2.window, 'morning')
  // A picked day and time is used as is, and flagged if it isn't 30 minutes clear.
  const p = followUpSlot({ from, date: '2026-11-02', exact: '3:30 PM', agentTz: TZ, leadTz: TZ, appts })
  assert.equal(p.picked, true)
  assert.equal(p.free, false)
  // followUpPick puts it on the agent's clock and ignores the lead's own old follow-up.
  const l = lead('r', 'follow_up', { best_time: 'Afternoons' })
  const pick = followUpPick(l, { appts: [{ id: 'old', ref: 'r', label: 'Follow-up call', iso: at('2026-11-02', '2:30 PM') }], settings: { timeZone: TZ }, now: SAMPLE_NOW })
  assert.equal(pick.at, '2026-11-02T14:30')
})

test('follow up: on the agent’s calendar, with reminder texts the day before and that morning', () => {
  const m = applyMove(lead('f', 'showed', { apptAt: '2026-11-02T10:00' }), 'follow_up', { follow: 'Wed, Nov 4', followAt: '2026-11-04T15:00', followAuto: true }, SAMPLE_NOW)
  const call = m.events.find(e => e.kind === 'follow_up')
  assert.equal(call.at, '2026-11-04T15:00')
  assert.match(call.label, /booked for you/)
  assert.deepEqual(m.events.filter(e => e.kind === 'text_sent').map(e => e.step), ['follow_day_before', 'follow_morning'])
})

test('no show: the rebook text goes out and a VA call is booked on the VA Schedule', () => {
  const m = applyMove(lead('n', 'booked', { apptAt: '2026-11-02T11:00' }), 'no_show', { vaCall: { at: '2026-11-02T15:00', va: 'Maria' } }, SAMPLE_NOW)
  assert.equal(m.events.some(e => e.step === 'no_show_link'), true)
  const va = m.events.find(e => e.kind === 'va_call')
  assert.equal(va.at, '2026-11-02T15:00')
  assert.match(va.label, /Maria is booked/)
  const ful = read('./template/ful/data.js')
  assert.match(ful, /export function bookNoShowCall/)
  assert.match(ful, /why: 'no_show'/)
  assert.match(read('./template/data/index.js'), /cancelNoShowCall\(id\)/)
})

test('Sold pre-fills Submit a policy with what the AI took down', () => {
  assert.match(read('./template/screens/Submit.jsx'), /l\.wants && `Wants: \$\{l\.wants\}`/)
})

test('one paid day ahead: today and tomorrow paid, tonight charges the day after; a declined day runs no ads', () => {
  const n = { today: 'Mon, Nov 2', tomorrow: 'Tue, Nov 3', forDay: 'Wed, Nov 4', nights: [
    { day: 'Mon, Nov 2', spend: 100, delivered: null, status: 'paid' },
    { day: 'Tue, Nov 3', spend: 100, delivered: null, status: 'paid' },
  ] }
  assert.deepEqual(paidAhead(n).map(d => [d.day, d.status]), [['Mon, Nov 2', 'paid'], ['Tue, Nov 3', 'paid'], ['Wed, Nov 4', 'tonight']])
  const declined = { ...n, nights: [n.nights[0], { ...n.nights[1], status: 'failed' }] }
  assert.equal(adsRunOn(declined, 'Mon, Nov 2'), true)
  assert.equal(adsRunOn(declined, 'Tue, Nov 3'), false)
  assert.equal(paidAhead(declined)[1].status, 'failed')
  assert.equal(paidAhead(declined)[2].status, 'held') // no new day is charged while a decline is open
  assert.equal(nightly(declined, { daily: 100 }, 'paid').failed, true)
  // Unspent credit only counts days already run.
  assert.equal(nightly({ ...n, nights: [{ day: 'Sun', spend: 100, delivered: 90, status: 'paid' }, ...n.nights] }, { daily: 100 }, 'paid').credit, 10)
})

test('the P910 migration (not applied): two days ahead, never run an unpaid day, a payment settles only its day', () => {
  const sql = read('../supabase/migrations/250_paid_day_ahead.sql')
  assert.match(sql, /create or replace function public\.lead_spend_nightly/)
  assert.match(sql, /create or replace function public\.billing_runs/)
  assert.match(sql, /when nightly and not lead_spend_day_paid\(p_agent, today\) then 'unpaid_day'/)
  assert.match(sql, /days_ahead int not null default 2/)
  // A payment settles only its own day.
  assert.match(sql, /kind = 'nightly' and for_day = c\.for_day and id <> c\.id/)
  assert.doesNotMatch(sql, /for_day <= c\.for_day/)
})
