// The live-transfer miss migration (*_transfer_missed.sql): Accept only acknowledges,
// the miss and working-hours helpers are closed to the browser, va_set_lead_outcome
// keeps its signature and grants, and nothing in the file sends anything.
//   node --test src/lib/transferMissedMigration.test.js
// Static: reads the file only, no database. TRANSFER_MISSED_SQL points the checks at
// another copy, to prove a check fails when the file is broken.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
const files = readdirSync(MIGRATIONS).filter(f => /^\d+_transfer_missed\.sql$/.test(f))
const path = process.env.TRANSFER_MISSED_SQL || `${MIGRATIONS}${files[0]}`

const raw = readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
const header = raw.split('\n').filter(l => l.startsWith('--')).join('\n')
const code = raw.replace(/--.*$/gm, '')

// One function's whole definition: its signature, $$ body and the grants after it.
function fn(name) {
  const at = code.indexOf(`create or replace function public.${name}(`)
  assert.ok(at >= 0, `${name} is in the file`)
  const open = code.indexOf('$$', at)
  const close = code.indexOf('$$', open + 2)
  const next = code.indexOf('create or replace function', close)
  return { sig: code.slice(at, open), body: code.slice(open + 2, close), grants: code.slice(close, next < 0 ? undefined : next) }
}

const grantees = (grants, name) =>
  [...grants.matchAll(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to ([^;]+);`, 'g'))].map(m => m[1].trim())

test('there is one migration, 208, and its header says it is not applied', () => {
  assert.deepEqual(files, ['208_transfer_missed.sql'])
  assert.match(header, /NOT APPLIED/)
  assert.match(header, /help-voice must be deployed/)
})

test('agent_accept_transfer only sets agent_ack_at', () => {
  const { body } = fn('agent_accept_transfer')
  assert.deepEqual([...body.matchAll(/\bset\s+(\w+)\s*=/g)].map(m => m[1]), ['agent_ack_at'])
  assert.doesNotMatch(body, /\bstatus\s*=/)
  assert.doesNotMatch(body, /\boutcome\s*=/)
  assert.doesNotMatch(body, /\btransferred_at\b/)
  assert.doesNotMatch(body, /\binbound_events\b|\bleads\b/, 'and touches no other table')
  assert.match(body, /c\.transfer_agent_id = v_uid/, 'only the caller\'s own call')
})

test('the helper and the log function are the service role\'s only', () => {
  for (const [name, args] of [['agents_slots_in_hours', 'uuid, timestamptz\\[\\]'], ['log_missed_transfer', 'text']]) {
    const { grants } = fn(name)
    assert.match(grants, new RegExp(`revoke all on function public\\.${name}\\(${args}\\) from public, anon, authenticated;`), name)
    assert.deepEqual(grantees(grants, name), ['service_role'], name)
  }
  // Across the whole file, not only next to the definition.
  const all = [...code.matchAll(/grant execute on function public\.(agents_slots_in_hours|log_missed_transfer)\([^)]*\) to ([^;]+);/g)]
  assert.deepEqual(all.map(m => m[2].trim()), ['service_role', 'service_role'])
})

test('the private helpers are granted to nobody', () => {
  for (const name of ['lead_transfer_missed', 'lead_booking_agent']) {
    assert.deepEqual(grantees(fn(name).grants, name), [], name)
    assert.match(fn(name).grants, /revoke all on function/, name)
  }
})

test('the browser functions are for signed-in users only', () => {
  for (const name of ['agent_accept_transfer', 'agent_missed_transfer', 'va_next_open_slot', 'va_agent_in_hours', 'va_missed_leads']) {
    const { grants } = fn(name)
    assert.match(grants, new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon;`), name)
    assert.deepEqual(grantees(grants, name), ['authenticated'], name)
  }
})

test('every function is security definer with its search_path pinned', () => {
  const sigs = [...code.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$/g)]
  assert.equal(sigs.length, 11)
  for (const m of sigs) {
    assert.match(m[0], /security definer/i, m[1])
    assert.match(m[0], /set search_path (to |= )'?public'?/i, m[1])
  }
})

test('the miss is idempotent by construction', () => {
  assert.match(code, /create unique index if not exists inbound_events_missed_call_uidx\s+on public\.inbound_events \(\(detail ->> 'help_call_id'\)\)\s+where kind = 'missed'/)
  const { body } = fn('log_missed_transfer')
  assert.match(body, /on conflict \(\(detail ->> 'help_call_id'\)\) where kind = 'missed' do nothing/)
  assert.match(fn('agent_missed_transfer').body, /return public\.log_missed_transfer\(v_sid\)/, 'one logic for both paths')
  assert.doesNotMatch(body, /\bstatus\s*=\s*'(transferred|connected)'\s*,|set status/, 'never moves the call')
  assert.doesNotMatch(body, /'step'/, '184\'s unique index and the workflow read that key')
})

test('the helper is one query over the whole array, not one per slot', () => {
  const { sig, body } = fn('agents_slots_in_hours')
  assert.match(sig, /returns setof timestamptz/)
  assert.match(sig, /language sql/)
  assert.match(body, /unnest\(p_slots\)/)
  assert.equal((body.match(/pg_timezone_names/g) || []).length, 1)
  assert.doesNotMatch(body, /agent_in_working_hours/)
  assert.doesNotMatch(fn('va_next_open_slot').body, /\b(loop|agent_in_working_hours)\b/)
})

test('va_next_open_slot checks the role, uses the helper and looks one hour ahead', () => {
  const { body } = fn('va_next_open_slot')
  assert.ok(body.indexOf('public.is_fulfillment()') < body.indexOf('agents_slots_in_hours'), 'role check comes first')
  assert.match(body, /date_bin\('15 minutes'/)
  assert.match(body, /now\(\) \+ interval '60 minutes', interval '15 minutes'/)
})

test('va_set_lead_outcome keeps its signature and grants, and refuses out-of-hours bookings', () => {
  const { sig, body, grants } = fn('va_set_lead_outcome')
  assert.match(sig, /public\.va_set_lead_outcome\(\s*p_lead uuid, p_agent uuid default null, p_outcome text default 'booked',\s*p_callback_at timestamptz default null, p_booking_id uuid default null,\s*p_checklist jsonb default null\s*\) returns void/)
  assert.match(grants, /revoke execute on function public\.va_set_lead_outcome\(uuid, uuid, text, timestamptz, uuid, jsonb\) from public, anon;/)
  assert.deepEqual(grantees(grants, 'va_set_lead_outcome'), ['authenticated'])
  assert.match(body, /agents_slots_in_hours\(p_agent, array\[v_at\]\)/)
  assert.match(body, /outside this agent''s working hours/)
  // The original guard and write are all still there.
  for (const s of ['Take the lead first', 'That booking is not on the agent', 'Pick a callback time', "booking_id = case when p_outcome = 'booked'"]) assert.ok(body.includes(s), s)
})

test('nothing sends: no text-message or calling objects, no live switch', () => {
  assert.doesNotMatch(raw, /sms|text_sent/i)
  assert.doesNotMatch(raw, /voice_live|recording_live|payouts_live|invite_.*_live|carrier_lookup_live/)
  assert.doesNotMatch(code, /\bdrop (table|column|function|policy|trigger)\b|\btruncate\b|\bdelete from\b/i)
  assert.doesNotMatch(code, /net\.http|http_post|notify\(/)
})
