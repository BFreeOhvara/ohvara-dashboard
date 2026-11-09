// The lead outcomes migration (*_lead_outcomes.sql): Sold only records, Follow up takes a
// date, Not interested takes a reason, and no second set_inbound_outcome is left behind.
//   node --test src/lib/leadOutcomesMigration.test.js
// Static: reads the file only, no database. LEAD_OUTCOMES_SQL points the checks at another
// copy, to prove a check fails when the file is broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const files = readdirSync(MIGRATIONS).filter(f => /^215_lead_outcomes\.sql$/.test(f)) // P904: 248_lead_outcomes (from P902) is a different file
const path = process.env.LEAD_OUTCOMES_SQL || `${MIGRATIONS}${files[0]}`

const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
const header = raw.split('\n').filter(l => l.startsWith('--')).join('\n')
const code = raw.replace(/--.*$/gm, '')

const NEW_SIG = 'public.set_inbound_outcome(uuid, text, text, timestamptz, text)'
const dropAt = code.indexOf('drop function public.set_inbound_outcome(uuid, text, text);')
const createAt = code.indexOf('create function public.set_inbound_outcome(')
const fnFile = code.slice(createAt)
const fnHead = fnFile.slice(0, fnFile.indexOf('$$'))
const fnBody = fnFile.slice(fnFile.indexOf('$$') + 2, fnFile.indexOf('$$', fnFile.indexOf('$$') + 2))
const inboundsAt = code.indexOf('create function public.agent_inbounds(')
const inbounds = code.slice(inboundsAt)
const inboundsHead = inbounds.slice(0, inbounds.indexOf('$$'))
const inboundsBody = inbounds.slice(inbounds.indexOf('$$') + 2, inbounds.lastIndexOf('$$'))

test('there is one lead outcomes migration, after 212, and no later file replaces its function', () => {
  assert.equal(files.length, 1)
  assert.ok(files[0] > '212_', '212 stops if the five arguments are already there')
  assert.match(code, /to_regproc\('public\.servicing_seed_steps'\) is null/)
  const later = readdirSync(MIGRATIONS).filter(f => f > files[0])
  for (const f of later) {
    assert.doesNotMatch(readFileSync(`${MIGRATIONS}${f}`, 'utf8'), /function public\.set_inbound_outcome\(/, f)
  }
})

test('the header says it is not applied, and warns about the page that ships today', () => {
  assert.match(header, /NOT APPLIED/)
  assert.match(header, /useInbounds\.js:179/)
})

test('the 3-argument signature is dropped once, before the one create', () => {
  assert.ok(dropAt >= 0, 'the drop is there')
  assert.ok(createAt >= 0, 'the create is there')
  assert.ok(dropAt < createAt, 'the drop comes first')
  assert.equal((code.match(/drop function[^;]*set_inbound_outcome/g) || []).length, 1)
  assert.equal((code.match(/create (or replace )?function public\.set_inbound_outcome\(/g) || []).length, 1, 'no overload')
})

test('the new signature keeps the old three arguments and defaults the new ones', () => {
  assert.match(fnHead, /p_lead\s+uuid,\s+p_outcome\s+text,\s+p_note\s+text default null,\s+p_follow_up_at\s+timestamptz default null,\s+p_reason\s+text default null\s*\)/)
})

test('both functions are grants-redone and closed to public and anon', () => {
  assert.ok(code.includes(`revoke all on function ${NEW_SIG} from public, anon;`))
  assert.ok(code.includes(`grant execute on function ${NEW_SIG} to authenticated;`))
  assert.ok(code.includes('revoke all on function public.agent_inbounds() from public, anon;'))
  assert.ok(code.includes('grant execute on function public.agent_inbounds() to authenticated;'))
  assert.doesNotMatch(code, /grant [^;]* to [^;]*\b(anon|public)\b/i)
})

test('the write is security definer with its search_path pinned, and checks the caller', () => {
  assert.match(fnHead, /security definer/)
  assert.match(fnHead, /set search_path = public/)
  assert.match(fnBody, /v_uid\s+uuid := auth\.uid\(\)/)
  assert.match(fnBody, /v_lead\.assigned_rep_id = v_uid/)
  assert.match(fnBody, /if not found or not coalesce\(\(/, '181\'s fix stays')
  assert.match(fnBody, /'Only the lead''s agent can do this' using errcode = '42501'/)
})

test('Sold only records: no servicing task and no became_client in the body', () => {
  assert.doesNotMatch(fnBody, /servicing_tasks/i)
  assert.doesNotMatch(fnBody, /became_client/i)
  assert.doesNotMatch(fnBody, /servicing_seed_steps/, '212 moved the seed into this call')
  assert.doesNotMatch(fnBody, /client_policy_id/)
  assert.equal((fnBody.match(/insert into /g) || []).length, 1, 'the one insert is the outcome event')
  assert.match(fnBody, /insert into inbound_events[^;]*'outcome',/)
})

test('Follow up and Not interested are refused without a date or reason, after the caller check', () => {
  const caller = fnBody.indexOf("'Only the lead''s agent can do this'")
  for (const [guard, words] of [
    ['if p_follow_up_at is null then', 'Pick a follow up date'],
    ['if p_follow_up_at <= now() then', 'Pick a follow up date in the future'],
    ['if v_reason is null then', 'Say why they are not interested'],
    ['if length(v_reason) > 500 then', 'Keep the reason to 500 characters'],
  ]) {
    assert.ok(fnBody.indexOf(guard) > caller, guard)
    assert.ok(fnBody.includes(`raise exception '${words}' using errcode = '22023'`), words)
  }
  assert.ok(fnBody.indexOf('if p_follow_up_at is null then') < fnBody.indexOf('update leads'), 'checked before the write')
  assert.ok(fnBody.indexOf('if v_reason is null then') < fnBody.indexOf('update leads'), 'checked before the write')
  assert.ok(fnBody.includes(String.raw`v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r\f\v'), '');`), 'line breaks are not a reason')
})

test('the date and the reason are stored, cleared by the other outcomes, and logged', () => {
  assert.match(fnBody, /follow_up_at = case when p_outcome = 'follow_up' then p_follow_up_at end/)
  assert.match(fnBody, /outcome_reason = case when p_outcome = 'not_interested' then v_reason end/)
  assert.match(fnBody, /jsonb_build_object\('follow_up_at', p_follow_up_at\)/)
  assert.match(fnBody, /jsonb_build_object\('reason', v_reason\)/)
})

test('the columns are nullable and the reason has its 500 limit', () => {
  assert.match(code, /add column if not exists follow_up_at timestamptz,/)
  assert.match(code, /add column if not exists outcome_reason text check \(length\(outcome_reason\) <= 500\);/)
})

test('agent_inbounds is dropped first and returns the three new columns in the same order', () => {
  assert.ok(code.indexOf('drop function public.agent_inbounds();') >= 0)
  assert.ok(code.indexOf('drop function public.agent_inbounds();') < inboundsAt)
  assert.match(inboundsHead, /delivered_at timestamptz, created_at timestamptz,\s+follow_up_at timestamptz, outcome_reason text, follow_up_due boolean\s*\)/)
  assert.match(inboundsBody, /l\.delivered_at, l\.created_at,\s+l\.follow_up_at, l\.outcome_reason,\s+coalesce\(l\.outcome = 'follow_up' and l\.follow_up_at <= now\(\), false\)/)
})

test('agent_inbounds stays security invoker, scoped to the caller', () => {
  assert.match(inboundsHead, /stable security invoker/)
  assert.match(inboundsHead, /set search_path = public/)
  assert.match(inboundsBody, /where l\.assigned_rep_id = auth\.uid\(\)\s+and l\.lead_type <> 'cancellation'/)
})

test('nothing texts anyone: no text objects, no send function, no queue, no job', () => {
  assert.doesNotMatch(raw, /lead_text_templates|agent_send_lead_text|sms|twilio/i)
  assert.doesNotMatch(code, /create table|create trigger|cron\.|net\.http/i)
  assert.equal((code.match(/create function /g) || []).length, 2, 'only the two functions')
})

test('nothing destructive to data, and no live switch', () => {
  assert.doesNotMatch(code, /\b(drop (table|column|view)|truncate|delete from|drop schema)\b/i)
  assert.doesNotMatch(code, /_live\b/)
})
