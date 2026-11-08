// P889 — one lead product: the split rules (start, weekly move, 10-point cap, 20% floor, call minimum, lock), the VA
// flow for a fresh form lead (in hours Yes, in hours No, out of hours, Appointments only), and that the migration
// carries the same numbers and keeps the split away from agents.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SPLIT_RULES as LAUNCH_RULES, effectiveSplit as splitWith, nextSplit as nextWith, freshLeadRoute, afterCheck, inLiveHours, liveHoursText, liveHoursOk, takeOk, DEFAULT_LIVE_HOURS, DAYS,
} from './lib/leadSplit.js'
import { agentCheck, SAMPLE_AGENTS } from './template/ful/p879.js'
import { expected, dailyTotal, monthlyBill } from './template/spendPlan.js'

// Wed Nov 11 2026: 15:00 UTC = 9:00 AM Central; 23:30 UTC = 5:30 PM Central. Sat Nov 14 16:00 UTC = 10 AM Central.
const WED_9AM_CT = Date.UTC(2026, 10, 11, 15, 0)
const WED_530PM_CT = Date.UTC(2026, 10, 11, 23, 30)
const SAT_10AM_CT = Date.UTC(2026, 10, 14, 16, 0)
const transferAgent = { mode: 'both', hours: DEFAULT_LIVE_HOURS, tz: 'America/Chicago' }
// P901: call ads are off at launch (src/p901.test.js covers that). These tests cover the split itself, so they run
// with the Call ads (Google) switch on.
const SPLIT_RULES = { ...LAUNCH_RULES, callAdsOn: true }
const effectiveSplit = (o, r = SPLIT_RULES) => splitWith(o, r)
const nextSplit = (o, r = SPLIT_RULES) => nextWith(o, r)

test('the split starts at 70/30 and only transfer agents are split', () => {
  assert.equal(SPLIT_RULES.startFormPct, 70)
  assert.deepEqual(effectiveSplit({ daily: 100, mode: 'both' }), { form: 70, call: 30, formPct: 70, reason: 'split' })
  assert.deepEqual(effectiveSplit({ daily: 100, mode: 'appts' }), { form: 100, call: 0, formPct: 100, reason: 'appts_only' })
  // The floor holds even when a stored split is out of range.
  assert.equal(effectiveSplit({ daily: 200, mode: 'both', formPct: 95 }).formPct, 80)
  assert.equal(effectiveSplit({ daily: 200, mode: 'both', formPct: 5 }).formPct, 20)
})

test('call ads need the minimum daily budget, or it all goes to form ads', () => {
  assert.equal(SPLIT_RULES.callMinDaily, 20)
  assert.deepEqual(effectiveSplit({ daily: 60, mode: 'both' }), { form: 60, call: 0, formPct: 100, reason: 'call_min' }) // 30% of 60 = 18
  assert.equal(effectiveSplit({ daily: 67, mode: 'both' }).call, 20) // 30% of 67 = 20.1 → 20
  assert.equal(effectiveSplit({ daily: 60, mode: 'both' }, { ...SPLIT_RULES, callMinDaily: 15 }).call, 18)
})

test('the weekly move goes toward the lower cost per sale, at most 10 points', () => {
  // 6 sales: cost per sale form 1680/4 = 420, call 720/2 = 360 → call cheaper → form 70 → 60.
  const m = nextSplit({ formPct: 70, form: { spent: 1680, sales: 4, shows: 9 }, call: { spent: 720, sales: 2, transfers: 8 } })
  assert.deepEqual([m.formPct, m.moved, m.metric, m.reason], [60, -10, 'sale', 'call_cheaper'])
  assert.equal(m.numbers.form.cost, 420)
  const up = nextSplit({ formPct: 50, form: { spent: 1000, sales: 5 }, call: { spent: 1000, sales: 1 } })
  assert.deepEqual([up.formPct, up.moved], [60, 10])
  // Never more than the step, whatever the gap.
  assert.equal(Math.abs(nextSplit({ formPct: 50, form: { spent: 100, sales: 5 }, call: { spent: 10000, sales: 1 } }).moved), 10)
})

test('under 5 sales it compares cost per show or transfer', () => {
  // 3 sales: form 1000 / (4 shows + 1 transfer) = 200, call 600 / 2 transfers = 300 → form cheaper → up.
  const m = nextSplit({ formPct: 70, form: { spent: 1000, sales: 2, shows: 4, transfers: 1 }, call: { spent: 600, sales: 1, transfers: 2 } })
  assert.deepEqual([m.metric, m.formPct, m.reason], ['early', 80, 'form_cheaper'])
  // Costs within 10% hold.
  assert.equal(nextSplit({ formPct: 70, form: { spent: 1000, shows: 5 }, call: { spent: 950, transfers: 5 } }).reason, 'even')
  // A side with spend and nothing back loses; no results anywhere holds.
  assert.equal(nextSplit({ formPct: 70, form: { spent: 500, shows: 2 }, call: { spent: 300, transfers: 0 } }).formPct, 80)
  assert.equal(nextSplit({ formPct: 70, form: { spent: 500 }, call: { spent: 300 } }).reason, 'no_results')
  assert.equal(nextSplit({ formPct: 70, form: { spent: 500, shows: 2 }, call: { spent: 0 } }).reason, 'no_spend')
})

test('neither side goes under 20%, and a locked split never moves', () => {
  const f = nextSplit({ formPct: 75, form: { spent: 100, sales: 5 }, call: { spent: 1000, sales: 1 } })
  assert.deepEqual([f.formPct, f.moved], [80, 5]) // capped by the floor, not the step
  assert.equal(nextSplit({ formPct: 80, form: { spent: 100, sales: 5 }, call: { spent: 1000, sales: 1 } }).reason, 'floor')
  assert.equal(nextSplit({ formPct: 20, form: { spent: 1000, sales: 1 }, call: { spent: 100, sales: 5 } }).formPct, 20)
  const l = nextSplit({ formPct: 40, locked: true, form: { spent: 100, sales: 5 }, call: { spent: 1000, sales: 1 } })
  assert.deepEqual([l.formPct, l.moved, l.reason], [40, 0, 'locked'])
  assert.ok(l.numbers.form, 'a held week still logs the numbers behind it')
})

test('live-call hours are read on the agent clock', () => {
  assert.equal(inLiveHours(DEFAULT_LIVE_HOURS, 'America/Chicago', WED_9AM_CT), true)
  assert.equal(inLiveHours(DEFAULT_LIVE_HOURS, 'America/Chicago', WED_530PM_CT), false)
  assert.equal(inLiveHours(DEFAULT_LIVE_HOURS, 'America/Chicago', SAT_10AM_CT), false)
  assert.equal(inLiveHours(DEFAULT_LIVE_HOURS, 'America/New_York', WED_9AM_CT), true) // 10 AM Eastern
  assert.equal(inLiveHours(DEFAULT_LIVE_HOURS, 'America/Los_Angeles', WED_9AM_CT), false) // 7 AM Pacific
  assert.equal(liveHoursText(DEFAULT_LIVE_HOURS), 'Mon–Fri, 9:00 AM–5:00 PM')
  const off = Object.fromEntries(DAYS.map(d => [d, { ...DEFAULT_LIVE_HOURS[d], on: false }]))
  assert.equal(liveHoursOk(off), false)
  assert.equal(takeOk({ mode: 'both', hours: off }), false)
  assert.equal(takeOk({ mode: 'appts', hours: off }), true)
})

test('VA flow, fresh form lead: in hours Yes → transfer; in hours No → book', () => {
  const r = freshLeadRoute(transferAgent, WED_9AM_CT)
  assert.equal(r.route, 'check')
  assert.equal(afterCheck('yes'), 'transfer')
  for (const a of ['no', 'none', 'fail', 'bounced']) assert.equal(afterCheck(a), 'book', a)
  // The desk's Check agent button is on for a transfer agent in hours.
  const dana = { ...SAMPLE_AGENTS[0], hours: DEFAULT_LIVE_HOURS }
  assert.equal(agentCheck(dana, 'TX', WED_9AM_CT).ok, true)
})

test('VA flow, fresh form lead: out of hours → book; Appointments only → book', () => {
  const out = freshLeadRoute(transferAgent, WED_530PM_CT)
  assert.deepEqual([out.route, out.key], ['book', 'out_of_hours'])
  const appts = freshLeadRoute({ ...transferAgent, mode: 'appts' }, WED_9AM_CT)
  assert.deepEqual([appts.route, appts.key], ['book', 'appts_only'])
  const dana = { ...SAMPLE_AGENTS[0], hours: DEFAULT_LIVE_HOURS }
  const c = agentCheck(dana, 'TX', WED_530PM_CT)
  assert.deepEqual([c.ok, c.why, c.bookOk], [false, 'Outside their live-call hours: book them', true])
  const marcus = SAMPLE_AGENTS.find(a => a.mode === 'appts')
  assert.deepEqual([agentCheck(marcus, 'AZ', WED_9AM_CT).ok, agentCheck(marcus, 'AZ', WED_9AM_CT).why], [false, 'Appointments only: book them'])
})

test('one daily spend: the bill and the estimates read one number', () => {
  assert.equal(dailyTotal({ daily: 100 }), 100)
  assert.equal(dailyTotal({ appts: 60, live: 40 }), 100) // older saved shape
  assert.equal(monthlyBill({ plan: 'paid', spend: { daily: 100 } }).tier.key, 'growth')
  const both = expected({ daily: 100 }, 'both')
  const appts = expected({ daily: 100 }, 'appts')
  assert.ok(both.live.delivered.mid > 0)
  assert.equal(appts.live.delivered.high, 0)
  assert.ok(appts.appts.booked.mid > both.appts.booked.mid)
})

test('the migration matches the rules and keeps the split from agents', () => {
  const sql = readFileSync('supabase/migrations/p889_one_lead_product.sql', 'utf8')
  assert.match(sql, /NOT NUMBERED, NOT APPLIED/)
  for (const [k, v] of [['start_form_pct', 70], ['max_step', 10], ['floor_pct', 20], ['min_sales', 5], ['call_min_daily_cents', 2000], ['lookback_weeks', 4]]) {
    assert.match(sql, new RegExp(`${k}\\s+int not null default ${v}\\b`), k)
  }
  assert.match(sql, /create table public\.agent_lead_split_log/)
  assert.match(sql, /billing_append_only/)
  assert.match(sql, /create policy als_admin_read on public\.agent_lead_spend .* using \(is_admin\(\)\)/)
  assert.match(sql, /cron\.schedule\('lead-split-weekly', '0 6 \* \* 1'/) // before lead-spend-week-open (6:05 Monday)
  assert.match(sql, /revoke execute on function public\.my_billing_p884\(\) from/)
  // Agent-facing words never name the ad side.
  const agentText = ['src/template/PlanBuilder.jsx', 'src/template/screens/Billing.jsx', 'src/template/Results.jsx']
    .map(f => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/className="[^"]*"/g, '')).join(' ')
  assert.doesNotMatch(agentText, /\b(Meta|Google|ads?|form ads|call ads|split)\b/i)
})
