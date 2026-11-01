// The Activity events migration (*_activity_events.sql): the trigger that writes a row
// at the moment of a VA attempt or a transfer, and the feed reading it, with an agent's
// spend kept from their upline and no phone number, Stripe id or Twilio id coming back.
//   node --test src/lib/activityEventsMigration.test.js
// Static: reads the file only, no database. ACTIVITY_EVENTS_SQL points the checks at
// another copy, to prove a check fails when the file is broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const files = readdirSync(MIGRATIONS).filter(f => /^\d+_activity_events\.sql$/.test(f))
const path = process.env.ACTIVITY_EVENTS_SQL || `${MIGRATIONS}${files[0]}`

const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
const header = raw.split('\n').filter(l => l.startsWith('--')).join('\n')
const code = raw.replace(/--.*$/gm, '')
const feedAt = code.indexOf('create or replace function public.agent_activity_feed(')
const feedFile = code.slice(feedAt)
const body = feedFile.slice(feedFile.indexOf('$$'), feedFile.lastIndexOf('$$'))
const trigger = code.slice(code.indexOf('create or replace function public.log_lead_call_events'), feedAt)
const triggerBody = trigger.slice(trigger.indexOf('$$'), trigger.lastIndexOf('$$'))

test('there is one events migration, and 185 is still the only activity_feed file', () => {
  assert.equal(files.length, 1)
  assert.deepEqual(readdirSync(MIGRATIONS).filter(f => /^\d+_activity_feed\.sql$/.test(f)), ['185_activity_feed.sql'])
})

test('the header says it is not applied, and names what is still pending', () => {
  assert.match(header, /NOT APPLIED/)
  assert.match(header, /billing_subscription\s+no charge-history source exists through 197/)
  assert.match(header, /a plan change\s+needs 201/)
})

test('the feed is still security definer with its search_path pinned', () => {
  const sig = feedFile.slice(0, feedFile.indexOf('$$'))
  assert.match(sig, /\bstable\b/i)
  assert.match(sig, /security definer/i)
  assert.match(sig, /set search_path = public/)
})

test('the signature, return columns and grants are unchanged', () => {
  assert.match(feedFile, /public\.agent_activity_feed\(\s*p_from timestamptz,\s*p_to timestamptz,\s*p_agent uuid default null,\s*p_limit int default 1000\s*\)/i)
  assert.equal(/returns table \(([^)]*)\)/i.exec(feedFile)?.[1], 'id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb')
  assert.match(feedFile, /revoke execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) from public, anon;/i)
  assert.match(feedFile, /grant execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) to authenticated;/i)
})

test('the gate is unchanged, and the own-only line sits between it and p_agent', () => {
  const gate = /\(v_role = 'admin'\s+or \(v_role = 'agent' and e\.agent_id = any \(v_agents\)\)\s+or \(v_role = 'fulfillment' and e\.pool_rep = v_uid\)\)/
  assert.match(body, gate)
  assert.match(body, /if v_role = 'agent' then\s+v_agents := array\(select v_uid union select d\.id from public\.downline_of\(v_uid\) d\)/)
  const own = "and (e.kind not in ('billing_spend_change', 'billing_spend_pause') or v_role = 'admin' or e.agent_id = v_uid)"
  assert.ok(body.includes(own), 'the own-only line is there')
  assert.ok(body.indexOf('e.pool_rep = v_uid') < body.indexOf(own), 'after the gate')
  assert.ok(body.indexOf(own) < body.indexOf('and (p_agent is null or e.agent_id = p_agent)'), 'before the p_agent line')
  assert.equal((body.match(/p_agent/g) || []).length, 2, 'p_agent only narrows')
  assert.match(body, /limit greatest\(least\(coalesce\(p_limit, 1000\), 5000\), 0\)/)
})

test('fulfillment only reaches the policy_events branch', () => {
  assert.equal([...body.matchAll(/(\S+)\s+as pool_rep/g)].length, 1)
  assert.match(body, /case when p\.fulfillment_assigned then p\.assigned_fulfillment_id end as pool_rep/)
  const branches = body.slice(body.indexOf('events as (')).split(/\bunion all\b/)
  assert.ok(branches.length >= 16)
  for (const b of branches.slice(1)) assert.match(b, /null::uuid/, 'every other branch sets pool_rep to null')
})

test('no phone, Stripe or error column is read', () => {
  assert.doesNotMatch(code, /to_phone|from_phone|client_phone|\bl\.phone\b|from_number/i)
  assert.doesNotMatch(code, /stripe/i)
  assert.doesNotMatch(body, /\berror\b/i)
  assert.equal((body.slice(body.lastIndexOf('select e.id')).match(/raw_text/g) || []).length, 1, 'message text only comes back as the scrubbed preview')
})

test('twilio_sid appears only in the one where line', () => {
  const hits = code.split('\n').filter(l => l.includes('twilio_sid'))
  assert.deepEqual(hits.map(l => l.trim()), ["and nullif(ev.detail ->> 'twilio_sid', '') is not null"])
})

test('detail is read key by key in the feed, never copied, and never gives a title', () => {
  for (const m of body.matchAll(/\bdetail\b(\s*\S{0,3})/g)) assert.match(m[1], /^\s*->/, `detail${m[1]}`)
  assert.doesNotMatch(body, /to_jsonb\((pe|p|l|lr|m|r|s|ev|t|rs|sl)\)/)
  assert.doesNotMatch(body, /detail ->> 'label'/)
  assert.doesNotMatch(body, /\bev\.label\b/)
})

test('a submit, a request and a lapse read in the agreed words', () => {
  assert.match(body, /when pe\.kind = 'submitted' then 'servicing'/)
  assert.match(body, /when pe\.kind = 'submitted' then 'Submitted for servicing'/)
  assert.match(body, /pe\.kind <> 'service_request'/)
  assert.ok(body.indexOf("'Lapse risk flagged.'") < body.indexOf("'Request opened: '"), 'lapse is checked first')
  assert.ok(body.indexOf("'Lapse work done.'") < body.indexOf("'Request done: '"), 'on both rows')
  for (const s of ['Policy saved from lapse.', 'Policy lapsed.', 'The client cancelled the policy.']) assert.ok(body.includes(`'${s}'`), s)
  assert.ok(body.includes("'Servicing task added: '"))
  assert.ok(body.includes("'Servicing task done: '"))
})

test('each column row hides only behind its own kind, with no date window', () => {
  const checks = [...body.matchAll(/not exists \(select 1 from inbound_events x\s+where ([^)]*)\)/g)].map(m => m[1].replace(/\s+/g, ' '))
  assert.deepEqual(checks, [
    "x.lead_id = lr.lead_id and x.kind = 'va_call' and x.state = 'done'",
    "x.lead_id = lr.lead_id and x.kind = 'transferred' and x.state = 'done'",
  ])
})

test('a spend row is one row, and never says who sells the leads', () => {
  const b = body.slice(body.indexOf("'spend_log:'"))
  assert.match(b, /sl\.old_paused is distinct from sl\.new_paused or sl\.old_cents is distinct from sl\.new_cents/)
  for (const s of ['Lead spend paused.', 'Lead spend resumed.', 'Weekly lead spend changed.']) assert.ok(b.includes(`'${s}'`), s)
  assert.doesNotMatch(code, /'[^']*\b(Meta|Google|ads?)\b[^']*'/)
})

test('billing_subscription stays pending', () => {
  assert.ok(!body.includes('billing_subscription'))
})

test('the trigger runs on insert too, and is shut off from every API role', () => {
  assert.match(code, /create trigger leads_log_call_events\s+after insert or update of va_attempts, transfer_status, transferred_at on public\.leads\s+for each row execute function public\.log_lead_call_events\(\)/)
  assert.match(trigger, /security definer/)
  assert.match(trigger, /set search_path = public/)
  assert.match(code, /revoke execute on function public\.log_lead_call_events\(\) from public, anon, authenticated;/)
  assert.doesNotMatch(code, /function public\.va_/, 'p_va_desk.sql pins the whole va_ list')
  assert.match(triggerBody, /if new\.lead_type = 'cancellation' then/)
})

test('the trigger writes only its two kinds, with no step key', () => {
  const kinds = [...triggerBody.matchAll(/, '(\w+)', 'done',/g)].map(m => m[1])
  assert.deepEqual(kinds.sort(), ['transferred', 'transferred', 'va_call'])
  assert.doesNotMatch(triggerBody, /'step'/)
  assert.doesNotMatch(triggerBody, /'(booked|rebooked|no_show|text_received)'/)
  assert.doesNotMatch(triggerBody, /\belse 'A VA called and the client is not interested/, 'the not interested wording is never a fallback')
  assert.match(triggerBody, /new\.va_attempts > old\.va_attempts and new\.va_outcome in \('not_reached', 'callback', 'not_interested'\)/)
  assert.doesNotMatch(triggerBody, /va_last_worked_at (is distinct from|<>)/, 'a moved work time is not an attempt')
  assert.ok(triggerBody.indexOf("tg_op = 'INSERT'") < triggerBody.indexOf('old.'), 'old is only read after the branch on TG_OP')
})
