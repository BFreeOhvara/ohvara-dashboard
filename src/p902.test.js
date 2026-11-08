// P902 — after the speed-to-lead call, the right texts for each outcome (brain/ohvara/Lead Text Workflows.md).
// One outcome per first call → the right flow; any action stops the flow and starts the right one; no text before the
// first call; the AI never hands a new lead to a VA; the GoHighLevel event carries the outcome; P696 is switched off.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FIRST_CALL_OUTCOMES, FLOWS, flowFor, landingFor, fromVaOutcome, planFlow, onAction, ACTIONS, FLOW_STEPS, TEXT_STEPS,
  GHL_OUTCOME_FIELDS, ghlOutcomeDetail, outcomeTag, OUTCOME_TAGS, fillWords, nextInWindow,
} from './lib/leadFlows.js'
import { runCall, OUTCOMES, SAMPLE_AI_CALLS, SAMPLE_BAD_LEADS, agentPrompt } from './lib/aiCaller.js'
import { seedEvents } from './template/leadLifecycle.js'
import { agentEvents } from './template/agentView.js'
import { LEAD_TEXTS } from './template/leadTexts.js'
import { tagsFor, workflowFor, customFieldsFor, run } from '../supabase/functions/ghl-push/core.ts'
import { ghlClient, GHL_BASE } from '../supabase/functions/ghl-push/api.ts'

const SQL = readFileSync('supabase/migrations/p902_lead_outcomes.sql', 'utf8')
const DEFAULT_DATE = '2026-11-02T14:14'

// ── Each outcome → the right workflow ───────────────────────────────────────────────────────────────────────────
test('each first-call outcome starts the right flow: only no answer and booked text; not now with a time = booked', () => {
  assert.deepEqual(FIRST_CALL_OUTCOMES, ['no_answer', 'booked', 'transferred', 'not_now', 'hard_no', 'wrong_number', 'opt_out'])
  assert.deepEqual(OUTCOMES, FIRST_CALL_OUTCOMES) // the AI caller uses the same list
  const want = { no_answer: 'no_answer', booked: 'booked', transferred: null, not_now: null, hard_no: null, wrong_number: null, opt_out: null }
  for (const o of FIRST_CALL_OUTCOMES) assert.equal(flowFor(o), want[o], o)
  assert.equal(flowFor('not_now', { callbackAt: '2026-11-03T17:30' }), 'booked')
  assert.deepEqual(FLOWS, ['no_answer', 'booked'])
})

test('where each outcome lands; wrong number is a bad lead (Closed); a VA result maps to the same outcomes', () => {
  assert.equal(landingFor('no_answer').stage, 'calling')
  assert.equal(landingFor('booked').stage, 'booked')
  assert.equal(landingFor('transferred').stage, 'ringing')
  assert.equal(landingFor('not_now', { callbackAt: '2026-11-03T17:30' }).stage, 'booked')
  assert.deepEqual([landingFor('not_now').stage, landingFor('not_now').db], ['follow_up', 'follow_up'])
  assert.deepEqual([landingFor('hard_no').db, landingFor('hard_no').bad], ['lost', false])
  assert.deepEqual([landingFor('wrong_number').db, landingFor('wrong_number').reason, landingFor('wrong_number').bad], ['lost', 'Wrong number', true])
  assert.equal(fromVaOutcome('not_reached'), 'no_answer')
  assert.equal(fromVaOutcome('callback'), 'not_now')
  assert.equal(fromVaOutcome('not_interested', { reason: 'Wrong number' }), 'wrong_number')
  assert.equal(fromVaOutcome('not_interested', { reason: 'Has coverage' }), 'hard_no')
})

test('the no-answer flow: missed-call text now, calls today/day 1/day 3, texts day 1/3/7, check-ins 30/60/90, close day 97', () => {
  const p = planFlow('no_answer', { start: '2026-11-02T10:00', now: '2026-11-02T10:00' })
  assert.deepEqual(p.map(s => s.key), FLOW_STEPS.no_answer.map(s => s.key))
  const at = Object.fromEntries(p.map(s => [s.key, s.at]))
  assert.equal(at.na_text_now, '2026-11-02T10:00')
  assert.equal(at.na_call_today, '2026-11-02T13:00')
  assert.equal(at.na_text_d1, '2026-11-03T09:35')
  assert.equal(at.na_text_d7, '2026-11-09T12:00')
  assert.match(at.na_close, /^2027-02-07T09:00/)
  assert.ok(p.every(s => s.state === 'planned' || s.state === 'done'))
  // Too late for a same-day call: skipped, not pushed past the window.
  const late = planFlow('no_answer', { start: '2026-11-02T19:10', now: '2026-11-02T19:10' })
  assert.ok(!late.some(s => s.key === 'na_call_today'))
  // Texts and calls stay inside 8 AM to 9 PM in the lead's zone.
  assert.equal(nextInWindow('2026-11-02T22:30'), '2026-11-03T08:00')
})

test('the booked flow: the booking text, the evening before 6:30 PM, the morning of 8:30 AM, 1 hour before', () => {
  const p = planFlow('booked', { start: '2026-11-02T11:00', appt: '2026-11-05T15:00', now: '2026-11-02T11:00' })
  assert.deepEqual(p.map(s => [s.key, s.at]), [
    ['bk_confirm', '2026-11-02T11:00'], ['bk_day_before', '2026-11-04T18:30'], ['bk_morning', '2026-11-05T08:30'], ['bk_1h', '2026-11-05T14:00']])
  // A 10 AM call skips the morning-of text (less than 2.5 hours after 8:30).
  const early = planFlow('booked', { start: '2026-11-02T11:00', appt: '2026-11-05T10:00', now: '2026-11-02T11:00' })
  assert.ok(!early.some(s => s.key === 'bk_morning'))
  assert.equal(fillWords('Hi {first}, {agent} calls {day} at {time} {zone}', { first: 'Pat', agent: 'Dana', day: 'Thu', time: '3:00 PM', zone: 'CT' }), 'Hi Pat, Dana calls Thu at 3:00 PM CT')
})

// ── Any action stops the flow and starts the right one ─────────────────────────────────────────────────────────────
test('any action stops the current flow and starts the right one', () => {
  for (const a of ['answered', 'replied', 'confirmed', 'booked_link', 'booked', 'opted_out']) assert.ok(ACTIONS.includes(a), a)
  for (const a of ACTIONS) assert.equal(onAction('no_answer', a).stop, true, a)
  assert.equal(onAction('no_answer', 'booked_link').start, 'booked')
  assert.equal(onAction('no_answer', 'booked').start, 'booked')
  assert.equal(onAction('no_answer', 'replied').task, 'va_call')
  assert.equal(onAction('no_answer', 'answered').start, null)
  assert.deepEqual([onAction('booked', 'opted_out').stop, onAction('booked', 'opted_out').start], [true, null])
  assert.deepEqual([onAction('booked', 'booked_link').stop, onAction('booked', 'booked_link').start], [true, 'booked']) // a rebook restarts
  assert.equal(onAction('booked', 'confirmed').stop, false) // C keeps the reminders
  // Stopped steps after the stop are marked stopped, never planned.
  const p = planFlow('no_answer', { start: '2026-11-02T10:00', now: '2026-11-02T14:00', stoppedAt: '2026-11-02T10:30' })
  assert.ok(p.filter(s => s.at > '2026-11-02T10:30').every(s => s.state === 'stopped'))
  assert.equal(p.find(s => s.key === 'na_text_now').state, 'done')
})

test('the SQL stops the flow on a reply, a booking, an opt-out or a later answer, and queues flow_stop for GoHighLevel', () => {
  for (const s of ["'text_received'", "'booked_link'", 'sms_opt_outs', 'lead_flow_on_va_result', "'flow_stop'", "'call_outcome'"]) assert.ok(SQL.includes(s), s)
  assert.match(SQL, /create trigger inbound_events_lead_flow/)
  assert.match(SQL, /create trigger sms_opt_outs_lead_flow/)
  assert.match(SQL, /create trigger leads_lead_flow_va/)
  // The outcome list in the SQL is the shared list.
  for (const o of FIRST_CALL_OUTCOMES) assert.ok(SQL.includes(`'${o}'`), o)
  assert.match(SQL, /NOT APPLIED/)
})

// ── No text before the first call ─────────────────────────────────────────────────────────────────────────────────
test('no text before the first call: no welcome text anywhere', () => {
  assert.equal(LEAD_TEXTS.instant, undefined)
  const lws = readFileSync('supabase/functions/lead-workflow-sms/core.ts', 'utf8')
  assert.doesNotMatch(lws, /\['instant'/)
  assert.match(lws, /lead\.text_flow === 'no_answer'/)
  const fu = readFileSync('supabase/functions/lead-followup-sms/core.ts', 'utf8')
  assert.match(fu, /P902/)
  // On the sample board, every lead's first event after it came in is a call, not a text.
  const l = { id: 'x', first_name: 'Pat', last_name: 'T', state: 'TX', kind: 'appointment', stage: 'calling', came: '2026-11-02T10:00', apptAt: null }
  const ev = seedEvents(l, DEFAULT_DATE)
  assert.equal(ev[1].kind, 'va_call')
  assert.ok(!ev.slice(0, 2).some(e => e.kind === 'text_sent'))
})

// ── The AI never hands a new lead to a VA ─────────────────────────────────────────────────────────────────────────
test('the AI: one outcome per call, never a VA hand-off; the prompt says "Your agent will go over that with you"', () => {
  assert.equal(runCall([{ type: 'answered' }, { type: 'said', outcome: 'wrong_number' }]).s.outcome, 'wrong_number')
  assert.equal(runCall([{ type: 'answered' }, { type: 'said', outcome: 'hard_no' }]).s.outcome, 'hard_no')
  const cb = runCall([{ type: 'answered' }, { type: 'said', outcome: 'not_now', at: '2026-11-03T17:30' }]).s
  assert.deepEqual([cb.outcome, cb.callbackAt], ['not_now', '2026-11-03T17:30'])
  const p = agentPrompt()
  assert.match(p, /Your agent will go over that with you/)
  assert.doesNotMatch(p, /handoff|hand off|hand you to|a person on our team/i)
  assert.ok(!SAMPLE_AI_CALLS.some(c => c.outcome === 'handed_to_va'))
  for (const f of ['supabase/functions/ai-caller/rules.js', 'supabase/functions/ai-caller/core.ts', 'supabase/functions/ai-caller/index.ts']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /handed_to_va|lineConference|AI_BRIDGE_NUMBER/, f)
  }
  // The SQL retires the hand-off: the RPC refuses, the open hand-off tasks are cancelled, the result never routes to a VA.
  assert.match(SQL, /raise exception 'ai_caller_handoff is retired/)
  assert.match(SQL, /drop trigger if exists call_queue_ai_handoff_taken/)
  const result = SQL.slice(SQL.indexOf('create or replace function public.ai_caller_result'), SQL.indexOf('create or replace function public.ai_caller_handoff'))
  assert.doesNotMatch(result, /route_enqueue\('new_lead'/)
  assert.match(result, /lead_first_call_outcome\(c\.lead_id, p_outcome, 'ai', cb\)/)
})

// ── The timeline: each flow on sample data ──────────────────────────────────────────────────────────────────────
test('the sample timeline: planned texts show as Planned; agents never see the no-answer chase', () => {
  const booked = seedEvents({ id: 'b', first_name: 'Dana', last_name: 'T', state: 'TX', kind: 'appointment', stage: 'booked', came: '2026-11-02T10:52', apptAt: '2026-11-05T15:00' }, DEFAULT_DATE)
  const planned = booked.filter(e => e.state === 'scheduled')
  assert.deepEqual(planned.map(e => e.step), ['bk_day_before', 'bk_morning', 'bk_1h'])
  assert.ok(planned.every(e => /Dana|Pat|calls you/.test(e.text) || e.text.length > 20))
  const leads = readFileSync('src/template/screens/Leads.jsx', 'utf8')
  assert.match(leads, /'Planned'/)
  const chase = seedEvents({ id: 'u', first_name: 'Vic', last_name: 'T', state: 'NC', kind: 'appointment', stage: 'unreachable', came: '2026-07-28T10:05' }, DEFAULT_DATE)
  assert.ok(chase.some(e => e.step?.startsWith('na_')))
  assert.ok(!agentEvents(chase).some(e => e.step?.startsWith('na_')))
  // One sample lead per outcome with no texts: no text rows at all.
  for (const firstCall of ['hard_no', 'wrong_number']) {
    const ev = seedEvents({ id: firstCall, first_name: 'Ray', last_name: 'T', state: 'OK', kind: 'appointment', stage: 'not_interested', firstCall, came: '2026-11-02T09:47' }, DEFAULT_DATE)
    assert.ok(!ev.some(e => e.kind === 'text_sent'), firstCall)
  }
  const later = seedEvents({ id: 'n', first_name: 'Lena', last_name: 'T', state: 'GA', kind: 'appointment', stage: 'follow_up', firstCall: 'not_now', came: '2026-11-02T09:05', follow: 'Wed, Nov 4', followAt: '2026-11-04T16:00' }, DEFAULT_DATE)
  assert.ok(!later.some(e => e.kind === 'text_sent'))
  assert.equal(TEXT_STEPS.length, FLOW_STEPS.no_answer.filter(s => s.kind === 'text').length + FLOW_STEPS.booked.length)
})

test('admin lead quality: wrong numbers listed per agent, admins only', () => {
  assert.ok(SAMPLE_BAD_LEADS.length >= 1 && SAMPLE_BAD_LEADS.every(r => r.reason && r.agent))
  const fn = SQL.slice(SQL.indexOf('create or replace function public.admin_lead_quality_view'))
  assert.match(fn, /is_admin\(\)/)
  assert.match(fn, /bad_lead_at/)
})

// ── GoHighLevel: the call_outcome event ─────────────────────────────────────────────────────────────────────────
const ROW = (o = {}) => ({ id: 9, event: 'call_outcome', lead_id: 'l1', stage: 'contacting', contact_id: null, contact_name: 'Pat Lee', phone: '+15125550123', email: null, state: 'TX', ...o })

test('GoHighLevel call_outcome: the fields, one outcome tag, the no-answer workflow only for the no-answer flow', () => {
  const detail = ghlOutcomeDetail({ lead_id: 'l1', outcome: 'no_answer', flow: 'no_answer', by: 'ai', secs: 8, agent: 'Dana Reyes', agent_phone: '+15125550100' })
  assert.deepEqual(Object.keys(detail).sort(), GHL_OUTCOME_FIELDS.map(([k]) => k).sort())
  const t = tagsFor(ROW({ detail }))
  assert.ok(t.add.includes('ohvara-call-no-answer'))
  for (const x of OUTCOME_TAGS.filter(x => x !== 'ohvara-call-no-answer')) assert.ok(t.remove.includes(x), x)
  assert.ok(t.remove.includes('ohvara-stage-new')) // the stage tags still move with it
  assert.equal(outcomeTag('wrong_number'), 'ohvara-call-wrong-number')
  assert.equal(workflowFor(ROW({ detail })), 'workflow_no_answer')
  assert.equal(workflowFor(ROW({ detail: { ...detail, text_flow: 'booked' } })), null) // booked rides on appointment_reminder
  assert.equal(workflowFor(ROW({ detail: { ...detail, text_flow: 'none' } })), null)
  const cf = customFieldsFor(ROW({ detail }))
  assert.ok(cf.some(f => f.key === 'first_call_outcome' && f.field_value === 'no_answer'))
  assert.ok(cf.every(f => typeof f.field_value === 'string'))
  assert.ok(tagsFor(ROW({ event: 'flow_stop', detail: null })).add.includes('ohvara-flow-stopped'))
})

test('GoHighLevel flow_stop takes the contact out of the no-answer workflow', async () => {
  const sent = []
  const fetchFn = async (url, init) => {
    sent.push(`${init.method} ${url.slice(GHL_BASE.length)}`)
    const body = url.endsWith('/contacts/upsert') ? JSON.stringify({ contact: { id: 'c1' } }) : '{}'
    return { ok: true, status: 200, text: async () => body }
  }
  const S = { enabled: true, location_id: 'l1C08ntBrFjLS0elLIYU', workflow_new_inbound: null, workflow_appointment_reminder: null, workflow_no_show: null, workflow_opt_out: null, workflow_no_answer: 'wf-na-000001' }
  const rows = [ROW({ id: 1, event: 'flow_stop', detail: { reason: 'replied' } }), ROW({ id: 2, detail: { first_call_outcome: 'no_answer', text_flow: 'no_answer' } })]
  await run({ apiKey: 'k', ghl: k => ghlClient(k, fetchFn), settings: async () => ({ data: S, error: null }), rpc: async fn => ({ data: fn === 'ghl_claim_outbox' ? rows : null, error: null }), log: () => {} })
  assert.ok(sent.includes('DELETE /contacts/c1/workflow/wf-na-000001'))
  assert.ok(sent.includes('POST /contacts/c1/workflow/wf-na-000001'))
  assert.ok(sent.indexOf('DELETE /contacts/c1/workflow/wf-na-000001') < sent.indexOf('POST /contacts/c1/workflow/wf-na-000001'))
})

// ── P696 retired ────────────────────────────────────────────────────────────────────────────────────────────────
test('P696 is switched off: tables kept, the sweep unscheduled, its queue gated by a flag that is off', () => {
  assert.match(SQL, /cron\.unschedule\('recovery-sweep'\)/)
  assert.match(SQL, /no_answer_recovery_live boolean not null default false/)
  assert.match(SQL, /rename to recovery_after_no_answer_p696/)
  assert.doesNotMatch(SQL, /drop table/i)
  const rs = readFileSync('supabase/functions/recovery-sms/index.ts', 'utf8')
  assert.match(rs, /no_answer_recovery_live/)
})
