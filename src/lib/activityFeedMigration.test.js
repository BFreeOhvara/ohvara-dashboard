// The all-events Activity feed migration (*_activity_feed.sql): read-only, scoped
// by auth.uid() and never returning a phone number, a Stripe id or a full message.
//   node --test src/lib/activityFeedMigration.test.js
// Static: reads the file only, no database. ACTIVITY_FEED_SQL points the checks at
// another copy, to prove a check fails when the file is broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
// The number right before the name: 111_team_activity_feed.sql is a different feed.
const files = readdirSync(MIGRATIONS).filter(f => /^\d+_activity_feed\.sql$/.test(f))
const path = process.env.ACTIVITY_FEED_SQL || `${MIGRATIONS}${files[0]}`

const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
const header = raw.split('\n').filter(l => l.startsWith('--')).join('\n')
const code = raw.replace(/--.*$/gm, '')
const body = code.slice(code.indexOf('$$'), code.lastIndexOf('$$'))

const KINDS = [
  'inbound', 'text_auto', 'text_reply', 'va_call', 'booked', 'moved', 'no_answer', 'in_progress',
  'edited', 'reassigned', 'transferred', 'outcome', 'sold', 'cancelled', 'servicing',
]
const PENDING = ['billing_subscription', 'billing_spend_change', 'billing_spend_pause']

test('there is exactly one activity feed migration, on its reserved number', () => {
  assert.deepEqual(files, ['185_activity_feed.sql'])
})

test('nothing in it writes or changes a table', () => {
  assert.doesNotMatch(raw, /^\s*(insert into|update \w+ set|delete from|drop |alter table|truncate)/im)
  assert.doesNotMatch(code, /\b(insert\s+into|delete\s+from|truncate|create\s+(or\s+replace\s+)?trigger|create\s+table|create\s+policy|drop\s+\w+)\b/i)
  assert.doesNotMatch(code, /\bupdate\s+\w+(\.\w+)?\s+set\b/i)
  const statements = code.split(/\$\$[\s\S]*?\$\$/).join(' ').split(';').map(s => s.trim()).filter(Boolean)
  for (const s of statements) {
    assert.match(s, /^(create index if not exists|create or replace function|revoke execute|grant execute)\b/i, s)
  }
})

test('the function is security definer with its search_path pinned', () => {
  assert.match(code, /security definer/i)
  assert.match(code, /set search_path = public/)
  assert.match(code, /\bstable\b/i)
})

test('only signed-in users can call it', () => {
  assert.match(code, /revoke execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) from public, anon;/i)
  assert.match(code, /grant execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) to authenticated;/i)
})

test('the signature and return columns are the ones the UI builds against', () => {
  assert.match(code, /public\.agent_activity_feed\(\s*p_from timestamptz,\s*p_to timestamptz,\s*p_agent uuid default null,\s*p_limit int default 1000\s*\)/i)
  const cols = /returns table \(([^)]*)\)/i.exec(code)?.[1]
  assert.equal(cols, 'id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb')
})

test('the visible set comes from auth.uid() and the caller\'s role', () => {
  assert.match(body, /v_uid\s+uuid := auth\.uid\(\)/)
  assert.match(body, /select pr\.role::text into v_role\s+from profiles pr\s+where pr\.id = v_uid and pr\.is_active/)
  assert.match(body, /if v_role is null or v_role not in \('admin', 'agent', 'fulfillment'\) then\s+return;/)
  assert.match(body, /if v_role = 'agent' then\s+v_agents := array\(select v_uid union select d\.id from public\.downline_of\(v_uid\) d\)/)
  assert.match(body, /\(v_role = 'admin'\s+or \(v_role = 'agent' and e\.agent_id = any \(v_agents\)\)\s+or \(v_role = 'fulfillment' and e\.pool_rep = v_uid\)\)/)
})

test('p_agent only narrows: one and-condition after the gate, nothing else', () => {
  const uses = body.match(/p_agent/g) || []
  assert.equal(uses.length, 2, 'p_agent appears once as a null test and once as the comparison')
  assert.match(body, /\n\s+and \(p_agent is null or e\.agent_id = p_agent\)\n/)
  assert.ok(body.indexOf('e.pool_rep = v_uid') < body.indexOf('p_agent is null'), 'the narrowing comes after the gate')
  assert.match(header, /non-admin passing another agent's uuid gets zero rows/)
})

test('fulfillment only reaches the policy_events branch', () => {
  const pool = [...body.matchAll(/(\S+)\s+as pool_rep/g)]
  assert.equal(pool.length, 1)
  assert.match(body, /case when p\.fulfillment_assigned then p\.assigned_fulfillment_id end as pool_rep/)
  const branches = body.slice(body.indexOf('events as (')).split(/\bunion all\b/)
  assert.ok(branches.length > 1)
  for (const b of branches.slice(1)) assert.match(b, /null::uuid/, 'every other branch sets pool_rep to null')
})

test('every kind and its source is in the header', () => {
  for (const k of [...KINDS, ...PENDING]) assert.match(header, new RegExp(`^--\\s+${k}\\s`, 'm'), k)
  for (const k of PENDING) {
    assert.match(header, new RegExp(`${k}\\s+source pending: added when the Billing rebuild migration is on main`), k)
    assert.ok(!body.includes(k), `${k} produces no rows yet`)
  }
  for (const k of KINDS) {
    if (!['booked', 'moved', 'no_answer', 'in_progress', 'edited', 'reassigned', 'cancelled'].includes(k)) {
      assert.ok(body.includes(`'${k}'`), `${k} has a source in the body`)
    }
  }
  assert.match(header, /is_sample: no source table has that column/)
})

test('auto texts are sent rows only, and every lead source skips cancellation leads', () => {
  assert.match(body, /from lead_followup_sms_log s[\s\S]*?where s\.status = 'sent'/)
  assert.match(body, /from leads l[\s\S]*?where l\.lead_type <> 'cancellation'/)
  assert.match(body, /join lead_rows lr on lr\.lead_id = s\.lead_id/)
  assert.match(body, /join lead_rows lr on lr\.lead_id = r\.lead_id/)
  assert.match(body, /where m\.sender_id <> p\.agent_id/)
})

test('no ledger, tier or money source', () => {
  assert.doesNotMatch(raw, /agent_lead_ledger|agent_billing_tiers/)
  assert.doesNotMatch(code, /stripe|balance|price_cents|membership_tiers/i)
})

test('no phone column, Twilio id or sending number is read', () => {
  assert.doesNotMatch(code, /\b\w*phone\w*\b|from_number|twilio_sid|\bconfirmation\b/i)
})

test('policy_events.detail is read key by key, never copied', () => {
  for (const m of body.matchAll(/\bdetail\b(\s*\S{0,3})/g)) assert.match(m[1], /^\s*->/, `detail${m[1]}`)
  assert.match(body, /c ->> 'field'/)
  assert.doesNotMatch(body, /to_jsonb\((pe|p|l|lr|m|r|s|ev|t)\)/)
})

test('message text only comes back as a scrubbed 140-character preview', () => {
  assert.match(body, /'preview', left\(regexp_replace\(e\.raw_text, '[^']+', '\[number removed\]', 'g'\), 140\)/)
  const outerSelect = body.slice(body.lastIndexOf('select e.id'))
  assert.equal((outerSelect.match(/raw_text/g) || []).length, 1, 'raw_text is used only inside the preview')
  assert.doesNotMatch(outerSelect, /\bbody\b/)
})

test('a name holding a digit is dropped from meta', () => {
  assert.match(body, /'client_first_name', case when e\.first_name !~ '\[0-9\]' then e\.first_name end/)
  assert.match(body, /'client_last_name', case when e\.last_name !~ '\[0-9\]' then e\.last_name end/)
})

test('call times in meta stay ISO, the same format policy_events.detail holds', () => {
  assert.doesNotMatch(body, /_at::text/)
  assert.match(body, /to_jsonb\(lr\.va_callback_at\) #>> '\{\}'/)
  assert.match(body, /to_jsonb\(t\.due_at\) #>> '\{\}'/)
})

test('the limit is capped', () => {
  assert.match(body, /limit greatest\(least\(coalesce\(p_limit, 1000\), 5000\), 0\)/)
})
