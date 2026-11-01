// The Activity lapse migration (*_activity_lapse_events.sql): the trigger that writes a
// policy_events row when a policy goes to Lapsed, and the feed showing it as its own row.
//   node --test src/lib/activityLapseMigration.test.js
// Static: reads the files only, no database. ACTIVITY_LAPSE_SQL points the checks at
// another copy, to prove a check fails when the file is broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const files = readdirSync(MIGRATIONS).filter(f => /^\d+_activity_lapse_events\.sql$/.test(f))
const path = process.env.ACTIVITY_LAPSE_SQL || `${MIGRATIONS}${files[0]}`
const read = p => readFileSync(p, 'utf8').replaceAll('\r\n', '\n')

const raw = read(path)
const header = raw.slice(0, raw.search(/^(?!--)\S/m))
const code = raw.replace(/--.*$/gm, '')
const feedOf = sql => sql.slice(sql.indexOf('create or replace function public.agent_activity_feed('))
const feedFile = feedOf(code)
const body = feedFile.slice(feedFile.indexOf('$$'), feedFile.lastIndexOf('$$'))
const trigger = code.slice(code.indexOf('create or replace function public.log_policy_lapsed'), code.indexOf('create or replace function public.agent_activity_feed('))
const triggerBody = trigger.slice(trigger.indexOf('$$'), trigger.lastIndexOf('$$'))

// 206's feed, comments and all: from its create to the next section's heading.
const source = read(`${MIGRATIONS}206_va_servicing.sql`)
const feed206 = source.slice(source.indexOf('create or replace function public.agent_activity_feed('), source.indexOf('-- ── 15. policy_servicing_status')).trimEnd()
const LAPSED_TITLE = "             when pe.kind = 'lapsed' then 'Policy lapsed. Payments stopped.'\n"

test('there is one lapse migration, on its reserved number', () => {
  assert.deepEqual(files, ['209_activity_lapse_events.sql'])
})

test('the header says not applied, the apply order, the second-to-apply rule and the branch check', () => {
  assert.match(header, /NOT APPLIED/)
  assert.match(header, /APPLY ORDER: 206_va_servicing first, then this file/)
  assert.match(header, /Whichever feed migration applies second must carry the other's\s+(-- )?lines/)
  assert.match(header, /Checked .* across every local and remote branch/s)
  assert.match(header, /real run is at the apply step/)
})

test('the first statement is the guard on 206', () => {
  assert.match(code.trimStart(), /^do \$\$\s+begin\s+if to_regprocedure\('public\.va_servicing_queue\(\)'\) is null then\s+raise exception '209 needs 206_va_servicing applied first';/)
  const guard = code.slice(0, code.indexOf('end $$;'))
  for (const need of ['085_not_approved_and_lapsed', '186_is_sample_flag']) assert.ok(guard.includes(need), need)
  assert.ok(code.indexOf('end $$;') < code.indexOf('alter table'), 'the guard runs before anything changes')
})

test('the kind check keeps every kind from 206 and adds lapsed', () => {
  const list = s => {
    const m = /policy_events_kind_check\s+check \(kind = any \(array\[([^\]]*)\]\)\)/.exec(s)
    return [...m[1].matchAll(/'(\w+)'/g)].map(x => x[1])
  }
  assert.deepEqual(list(code), [...list(source.replace(/--.*$/gm, '')), 'lapsed'])
  assert.deepEqual(list(code), ['booked', 'in_progress', 'no_answer', 'cancelled', 'moved', 'edited', 'reassigned', 'submitted', 'service_request', 'servicing', 'lapsed'])
})

test('nothing else in the file changes a table, and there is no backfill', () => {
  assert.equal((code.match(/\balter table\b/gi) || []).length, 2)
  assert.doesNotMatch(code, /\b(delete\s+from|truncate|drop\s+table|drop\s+function|drop\s+policy|create\s+policy)\b/i)
  assert.doesNotMatch(code, /\bupdate\s+(public\.)?\w+\s+set\b/i)
  assert.equal((code.match(/\binsert into\b/gi) || []).length, 1, 'the trigger writes the only row')
  assert.doesNotMatch(code, /insert into[^;]*\bselect\b[^;]*\bfrom\b/i)
})

test('the trigger fires only on a real change of status to Lapsed', () => {
  assert.match(code, /create trigger policies_log_lapsed\s+after update of status on public\.policies\s+for each row\s+when \(new\.status = 'Lapsed' and old\.status is distinct from new\.status\)\s+execute function public\.log_policy_lapsed\(\);/)
  assert.doesNotMatch(trigger, /after insert/i)
})

test('the trigger function is security definer, pinned and revoked', () => {
  const sig = trigger.slice(0, trigger.indexOf('$$'))
  assert.match(sig, /security definer/)
  assert.match(sig, /set search_path = public/)
  assert.match(code, /revoke execute on function public\.log_policy_lapsed\(\) from public, anon, authenticated;/)
  assert.doesNotMatch(code, /grant execute on function public\.log_policy_lapsed/)
  assert.doesNotMatch(code, /function public\.va_/, 'p_va_desk.sql pins the whole va_ list')
})

test('the trigger writes one row, with its detail built key by key', () => {
  assert.match(triggerBody, /kind, from_status, actor_id, actor_name, actor_role, detail, is_sample/)
  assert.match(triggerBody, /new\.id, new\.agent_id, 'lapsed', old\.status::text, v_actor, v_name, v_role,\s+jsonb_build_object\('from', old\.status::text\), new\.is_sample/)
  assert.match(triggerBody, /where pr\.id = auth\.uid\(\)/)
  assert.match(triggerBody, /if v_actor is null then\s+v_name := 'Ohvara';\s+v_role := 'system';/)
  assert.doesNotMatch(trigger, /client_phone|policy_number|carrier|notes|to_jsonb|stripe|twilio/i)
})

test('the feed is 206 copied whole, plus the one lapsed line', () => {
  const copied = feedOf(raw).trimEnd()
  assert.ok(copied.includes(LAPSED_TITLE), 'the title line is there')
  assert.equal(copied.replace(LAPSED_TITLE, ''), feed206)
})

test('a lapsed event keeps its own kind and title', () => {
  assert.match(body, /when pe\.kind = 'submitted' then 'servicing' else pe\.kind end as kind/, 'lapsed passes through as itself')
  assert.ok(body.indexOf("when pe.kind = 'lapsed' then") < body.indexOf("else 'Call updated.'"), 'before the fallback')
  assert.doesNotMatch(body, /pe\.kind = 'lapsed' then pe\.detail/, 'the title is fixed words')
})

test('the 206 lapse_save lines are unchanged', () => {
  for (const line of [
    "case when t.kind = 'lapse_save' then 'Lapse risk flagged.'",
    "case when t.kind = 'lapse_save' then\n                  case t.outcome when 'saved' then 'Policy saved from lapse.'",
    "when 'lapsed' then 'Policy lapsed.'",
    "when 'client_cancelled' then 'The client cancelled the policy.'",
    "else 'Lapse work done.' end",
  ]) {
    assert.ok(feed206.includes(line), `206: ${line}`)
    assert.ok(body.includes(line), `209: ${line}`)
  }
})

test('the signature, return columns and grants match 206', () => {
  assert.match(feedFile, /public\.agent_activity_feed\(\s*p_from timestamptz,\s*p_to timestamptz,\s*p_agent uuid default null,\s*p_limit int default 1000\s*\)/i)
  assert.equal(/returns table \(([^)]*)\)/i.exec(feedFile)?.[1], 'id text, kind text, at timestamptz, lead_id uuid, agent_id uuid, title text, meta jsonb')
  assert.match(feedFile, /revoke execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) from public, anon;/)
  assert.match(feedFile, /grant execute on function public\.agent_activity_feed\(timestamptz, timestamptz, uuid, int\) to authenticated;/)
  assert.match(body, /limit greatest\(least\(coalesce\(p_limit, 1000\), 5000\), 0\)/)
})

test('the pgTAP file holds the two-row case, with its comment', () => {
  const tap = read(fileURLToPath(new URL('../../supabase/tests/p_activity_lapse_events.sql', import.meta.url)))
  assert.match(tap, /EXPECTED CASE: two rows on purpose/)
  assert.match(tap, /'servicing\|Policy lapsed\.,lapsed\|Policy lapsed\. Payments stopped\.'/)
  assert.match(tap, /206 does not change\s+-- policies\.status/)
})
