// The Overview's data rules (src/lib/overviewBook.js). They fail if the week, the book counts, the
// steps lists or the Leads flag drift from the spec.
// Run: npm run test:unit   (or: node --test src/lib/overviewBook.test.js)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isMissingRelation, isMissingColumn, weekBounds, bookFromRows, bookUnavailable, submissionsFromUsage,
  dueSoonSteps, doneByDay, clientNameOf, hasLeadsOf, hasServicingOf,
} from './overviewBook.js'

const iso = s => new Date(s).toISOString()
const LABELS = { packet_check: 'Policy packet check', review_call: 'Review call', chargeback_watch: 'Chargeback watch', lapse_save: 'Lapse save' }
// The same rule as agentBookings.stageOf(p) === 'cancelled'.
const isCancelled = p => p.replaced_old_policy !== false && p.fulfillment_stage === 'Complete'

// ── Weeks ────────────────────────────────────────────────────────────────────
test('weekBounds: Monday to Sunday in Central, last week is 7 days from last Monday', () => {
  // Wed Oct 28 2026 15:00 Central (CDT, UTC-5)
  const w = weekBounds(Date.parse('2026-10-28T20:00:00Z'), 'America/Chicago')
  assert.equal(w.today, '2026-10-28')
  assert.equal(w.thisMonday, '2026-10-26')
  assert.equal(w.lastMonday, '2026-10-19')
  assert.deepEqual(w.lastWeekDays, ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  assert.equal(w.thisWeekStartMs, Date.parse('2026-10-26T05:00:00Z'))
  assert.equal(w.lastWeekStartMs, Date.parse('2026-10-19T05:00:00Z'))
})

test('weekBounds: a non-Central zone rolls the week on its own Monday, not Central\'s', () => {
  // Sun Nov 1 2026 22:00 UTC: Sunday evening in Chicago, but already Monday Nov 2 in Auckland (UTC+13).
  const now = Date.parse('2026-11-01T22:00:00Z')
  const chi = weekBounds(now, 'America/Chicago')
  const akl = weekBounds(now, 'Pacific/Auckland')
  assert.equal(chi.today, '2026-11-01')
  assert.equal(chi.thisMonday, '2026-10-26')
  assert.equal(akl.today, '2026-11-02')
  assert.equal(akl.thisMonday, '2026-11-02')
  assert.equal(akl.lastMonday, '2026-10-26')
  assert.equal(akl.lastWeekDays.length, 7)
  assert.equal(akl.lastWeekDays[6], '2026-11-01')
  // Auckland midnight Monday Nov 2 = Sunday Nov 1 11:00 UTC (NZDT, UTC+13)
  assert.equal(akl.thisWeekStartMs, Date.parse('2026-11-01T11:00:00Z'))
})

test('weekBounds: Sunday night and Monday morning land on different weeks', () => {
  const sun = weekBounds(Date.parse('2026-11-02T04:59:00Z'), 'America/Chicago') // Sun 11:59 PM CST
  const mon = weekBounds(Date.parse('2026-11-02T06:00:00Z'), 'America/Chicago') // Mon 12:00 AM CST
  assert.equal(sun.thisMonday, '2026-10-26')
  assert.equal(mon.thisMonday, '2026-11-02')
})

test('weekBounds: no zone falls back to Central', () => {
  assert.equal(weekBounds(Date.parse('2026-10-28T20:00:00Z'), null).thisMonday, '2026-10-26')
})

// ── Missing sources ──────────────────────────────────────────────────────────
test('isMissingRelation: 42P01, PGRST205 and HTTP 404, nothing else', () => {
  assert.equal(isMissingRelation({ code: '42P01' }), true)
  assert.equal(isMissingRelation({ code: 'PGRST205' }), true)
  assert.equal(isMissingRelation({ code: 'PGRST116' }, 404), true)
  assert.equal(isMissingRelation({ code: 'X', status: 404 }), true)
  assert.equal(isMissingRelation({ code: '42501' }), false)
  assert.equal(isMissingRelation({ code: '42703' }), false)
  assert.equal(isMissingRelation(null), false)
})

test('isMissingColumn: 42703 only', () => {
  assert.equal(isMissingColumn({ code: '42703' }), true)
  assert.equal(isMissingColumn({ code: '42P01' }), false)
  assert.equal(isMissingColumn(null), false)
})

test('book: a missing view is available=false with no numbers, never zeros', () => {
  const b = bookUnavailable()
  assert.equal(b.available, false)
  for (const k of ['protected', 'settingUp', 'needsAttention', 'requestsOpen']) assert.equal(b[k], null, k)
  assert.ok(Object.values(b).every(v => v !== 0))
})

// ── Book counts ──────────────────────────────────────────────────────────────
test('bookFromRows: counts by stage key; ongoing counts under protected; ended counts nowhere', () => {
  const rows = [
    { stage: 'protected', open_requests: 0 },
    { stage: 'protected', open_requests: 2 },
    { stage: 'ongoing', open_requests: 0 },
    { stage: 'setting_up', open_requests: 1 },
    { stage: 'needs_attention', open_requests: 1 },
    { stage: 'needs_attention', open_requests: 0 },
    { stage: 'ended', open_requests: 0 },
    { stage: 'ended', open_requests: 0 },
  ]
  assert.deepEqual(bookFromRows(rows), {
    available: true, protected: 3, settingUp: 1, needsAttention: 2, requestsOpen: 3,
  })
})

test('bookFromRows: a loaded view with no clients is a real zero, available=true', () => {
  assert.deepEqual(bookFromRows([]), { available: true, protected: 0, settingUp: 0, needsAttention: 0, requestsOpen: 0 })
})

// ── Submissions ──────────────────────────────────────────────────────────────
test('submissionsFromUsage: used, cap and the reset time; uncapped agent has cap null', () => {
  assert.deepEqual(submissionsFromUsage({ used: 5, weekly_cap: 7, week_end: '2026-11-02T06:00:00Z' }),
    { used: 5, cap: 7, resetsAt: '2026-11-02T06:00:00Z' })
  assert.deepEqual(submissionsFromUsage({ used: 3, weekly_cap: null, week_end: null }), { used: 3, cap: null, resetsAt: null })
  assert.deepEqual(submissionsFromUsage(null), { used: null, cap: null, resetsAt: null })
})

// ── Due soon ─────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-28T20:00:00Z')
const task = (over = {}) => ({
  id: 't', agent_id: 'a', lead_id: null, policy_id: 'p1', kind: 'review_call', status: 'scheduled',
  due_at: iso('2026-10-30T15:00:00Z'), done_at: null, created_at: iso('2026-10-01T00:00:00Z'), ...over,
})

test('dueSoonSteps: open steps with a due_at, soonest first, with labels, client name and policy id', () => {
  const policies = new Map([['p1', { client_first_name: 'Ana', client_last_name: 'Ruiz' }]])
  const out = dueSoonSteps([
    task({ id: 'late', due_at: iso('2026-11-05T15:00:00Z') }),
    task({ id: 'soon', kind: 'packet_check', due_at: iso('2026-10-29T15:00:00Z'), status: 'requested' }),
    task({ id: 'overdue', due_at: iso('2026-10-27T15:00:00Z'), status: 'in_progress' }),
  ], { policies, labels: LABELS, nowMs: NOW })
  assert.deepEqual(out.map(t => t.id), ['overdue', 'soon', 'late'])
  assert.equal(out[0].overdue, true)
  assert.equal(out[1].overdue, false)
  assert.deepEqual(out[1], {
    id: 'soon', kind: 'packet_check', label: 'Policy packet check', dueAt: iso('2026-10-29T15:00:00Z'),
    overdue: false, status: 'requested', clientName: 'Ana Ruiz', policyId: 'p1', leadId: null,
  })
})

test('dueSoonSteps: leaves out cancelled, done, chargeback_watch, requests and tasks without due_at', () => {
  const out = dueSoonSteps([
    task({ id: 'ok' }),
    task({ id: 'cancelled', status: 'cancelled' }),
    task({ id: 'done', status: 'done', done_at: iso('2026-10-27T15:00:00Z') }),
    task({ id: 'watch', kind: 'chargeback_watch', due_at: iso('2027-10-01T00:00:00Z') }),
    task({ id: 'nodue', due_at: null }),
    task({ id: 'request', kind: 'address_change' }),
    task({ id: 'save', kind: 'lapse_save' }),
  ], { labels: LABELS, nowMs: NOW })
  assert.deepEqual(out.map(t => t.id), ['ok'])
})

test('dueSoonSteps: limit, and a name falls back from policy to lead to "Client"', () => {
  const many = Array.from({ length: 15 }, (_, i) => task({ id: `t${i}`, due_at: iso(`2026-11-${String(i + 1).padStart(2, '0')}T15:00:00Z`) }))
  assert.equal(dueSoonSteps(many, { nowMs: NOW }).length, 10)
  assert.equal(dueSoonSteps(many, { nowMs: NOW, limit: 3 }).length, 3)
  const leads = new Map([['l1', { contact_name: ' Bo Chen ' }]])
  assert.equal(clientNameOf(task({ policy_id: null, lead_id: 'l1' }), { leads }), 'Bo Chen')
  assert.equal(clientNameOf(task({ policy_id: 'zz', lead_id: 'zz' }), { policies: new Map(), leads }), 'Client')
})

// ── Steps done by day ────────────────────────────────────────────────────────
// Now = Wed Oct 28 2026 Central. Last week = Mon Oct 19 to Sun Oct 25.
const done = (kind, at, over = {}) => task({ id: `${kind}-${at}`, kind, status: 'done', due_at: null, done_at: iso(at), ...over })
const policy = (at, over = {}) => ({ id: `p-${at}`, fulfillment_stage: 'Complete', fulfillment_completed_at: iso(at), replaced_old_policy: true, ...over })

test('doneByDay: always 7 entries, Monday to Sunday of last week, even with no data', () => {
  const days = doneByDay({ tasks: [], policies: [], saves: [], nowMs: NOW, tz: 'America/Chicago', isCancelled })
  assert.equal(days.length, 7)
  assert.deepEqual(days.map(d => d.date), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  assert.ok(days.every(d => d.total === 0 && d.save === 0))
  assert.equal(doneByDay({ tasks: null, policies: null, saves: null, nowMs: NOW, tz: 'America/Chicago', isCancelled }).length, 7)
})

test('doneByDay: packet checks and review calls come from done_at; cancelled and open tasks do not count', () => {
  const days = doneByDay({
    tasks: [
      done('packet_check', '2026-10-20T15:00:00Z'),
      done('packet_check', '2026-10-20T16:00:00Z', { id: 'x' }),
      done('review_call', '2026-10-20T17:00:00Z'),
      done('review_call', '2026-10-22T17:00:00Z'),
      done('packet_check', '2026-10-21T15:00:00Z', { status: 'cancelled' }),
      task({ kind: 'review_call', status: 'scheduled', done_at: null }),
      done('packet_check', '2026-10-28T15:00:00Z'), // this week
    ],
    policies: [], saves: [], nowMs: NOW, tz: 'America/Chicago', isCancelled,
  })
  assert.deepEqual([days[1].packet_check, days[1].review_call, days[1].total], [2, 1, 3])
  assert.deepEqual([days[3].packet_check, days[3].review_call, days[3].total], [0, 1, 1])
  assert.equal(days[2].packet_check, 0)
  assert.equal(days.reduce((n, d) => n + d.total, 0), 4)
})

test('doneByDay: cancellations come from the policy rows, not from servicing_tasks', () => {
  const days = doneByDay({
    tasks: [done('packet_check', '2026-10-23T15:00:00Z', { kind: 'cancellation' })], // not a counted kind
    policies: [
      policy('2026-10-21T18:00:00Z'),
      policy('2026-10-21T19:00:00Z', { id: 'b' }),
      policy('2026-10-22T18:00:00Z', { fulfillment_stage: 'Booked' }),          // not cancelled
      policy('2026-10-22T18:00:00Z', { replaced_old_policy: false }),           // no old policy to cancel
      policy('2026-10-27T18:00:00Z'),                                           // this week
    ],
    saves: [], nowMs: NOW, tz: 'America/Chicago', isCancelled,
  })
  assert.equal(days[2].cancellation, 2)
  assert.equal(days[3].cancellation, 0)
  assert.equal(days[2].total, 2)
  assert.equal(days.reduce((n, d) => n + d.cancellation, 0), 2)
})

test('doneByDay: day edges use the agent zone (Auckland), not UTC or Central', () => {
  // Now: Tue Nov 3 2026 in Auckland. Last week = Mon Oct 26 to Sun Nov 1 (NZ).
  const now = Date.parse('2026-11-03T02:00:00Z')
  const days = doneByDay({
    tasks: [
      done('packet_check', '2026-10-25T11:30:00Z'), // Mon Oct 26 00:30 NZDT: Monday
      done('packet_check', '2026-10-25T10:30:00Z'), // Sun Oct 25 23:30 NZDT: the week before
      done('review_call', '2026-11-01T10:30:00Z'),  // Sun Nov 1 23:30 NZDT: Sunday
      done('review_call', '2026-11-01T11:30:00Z'),  // Mon Nov 2 00:30 NZDT: this week
    ],
    policies: [], saves: [], nowMs: now, tz: 'Pacific/Auckland', isCancelled,
  })
  assert.equal(days[0].date, '2026-10-26')
  assert.equal(days[6].date, '2026-11-01')
  assert.equal(days[0].packet_check, 1)
  assert.equal(days[6].review_call, 1)
  assert.equal(days.reduce((n, d) => n + d.total, 0), 2)
})

test('doneByDay: saves are lapse_save rows with outcome saved, passed in separately', () => {
  const days = doneByDay({
    tasks: [done('lapse_save', '2026-10-22T15:00:00Z')], // a done lapse_save is not a counted kind here
    policies: [], saves: [{ done_at: iso('2026-10-22T15:00:00Z') }, { done_at: iso('2026-10-22T16:00:00Z') }],
    nowMs: NOW, tz: 'America/Chicago', isCancelled,
  })
  assert.equal(days[3].save, 2)
  assert.equal(days[3].total, 2)
})

test('doneByDay: outcome column missing (saves null) gives zero saves while the other counts still work', () => {
  const days = doneByDay({
    tasks: [done('packet_check', '2026-10-20T15:00:00Z'), done('review_call', '2026-10-20T16:00:00Z')],
    policies: [policy('2026-10-20T17:00:00Z')],
    saves: null, nowMs: NOW, tz: 'America/Chicago', isCancelled,
  })
  assert.deepEqual([days[1].packet_check, days[1].review_call, days[1].cancellation, days[1].save, days[1].total], [1, 1, 1, 0, 3])
  assert.ok(days.every(d => d.save === 0))
})

test('doneByDay: a failed source gives null counts, never zeros, and the other source still counts', () => {
  const days = doneByDay({
    tasks: null, policies: [policy('2026-10-20T17:00:00Z')], saves: null, nowMs: NOW, tz: 'America/Chicago', isCancelled,
  })
  assert.equal(days[1].packet_check, null)
  assert.equal(days[1].review_call, null)
  assert.equal(days[1].total, null)
  assert.equal(days[1].cancellation, 1)
})

// ── Plan flags ───────────────────────────────────────────────────────────────
test('hasLeads: true for a Leads buyer with no inbounds', () => {
  assert.equal(hasLeadsOf({ leads_weekly_cents: 5000 }, []), true)
  assert.equal(hasLeadsOf({ leads_weekly_cents: 5000 }, undefined), true)
})

test('hasLeads: true for any inbound even when leads_weekly_cents is 0 (a paused buyer)', () => {
  assert.equal(hasLeadsOf({ leads_weekly_cents: 0 }, [{ lead_id: 'l1' }]), true)
})

test('hasLeads: false with neither; unknown column (migration 190 not applied) falls back to inbounds only', () => {
  assert.equal(hasLeadsOf({ leads_weekly_cents: 0 }, []), false)
  assert.equal(hasLeadsOf({}, []), false)
  assert.equal(hasLeadsOf({}, [{ lead_id: 'l1' }]), true)
  assert.equal(hasLeadsOf(null, null), false)
})

test('hasServicing: only an explicit false turns it off', () => {
  assert.equal(hasServicingOf({ has_servicing: false }), false)
  assert.equal(hasServicingOf({ has_servicing: true }), true)
  assert.equal(hasServicingOf({}), true)
  assert.equal(hasServicingOf(null), true)
})

// ── The hook's promises, read from its source ────────────────────────────────
const hook = readFileSync(new URL('../hooks/useOverviewBook.js', import.meta.url), 'utf8')
const tasksHook = readFileSync(new URL('../hooks/useServicingTasks.js', import.meta.url), 'utf8')

test('hook: read only (no insert, update, delete, upsert or rpc call)', () => {
  const code = hook.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /\.(insert|update|delete|upsert)\s*\(/)
  assert.doesNotMatch(code, /\.rpc\s*\(/)
})

test('hook: outcome is read in its own query, and TASK_COLS does not carry it', () => {
  assert.match(hook, /\.eq\('outcome', 'saved'\)/)
  const cols = tasksHook.match(/const TASK_COLS = '([^']*)'/)[1]
  assert.doesNotMatch(cols, /outcome/)
})

test('hook: the stage is read from agent_clients as a key, not recomputed', () => {
  assert.match(hook, /from\('agent_clients'\)/)
  assert.doesNotMatch(hook, /policy_servicing_status|fulfillment_assigned|archived_at/)
})
