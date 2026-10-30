// VA desk (/fulfillment/leads): the rules behind the queue, the 4-item
// checklist lock and the claim hold, plus a source guard that keeps prices,
// premiums, quotes and any send path out of the VA screen.
//   node --test src/lib/vaQueue.test.js
// Pure functions only: no network, no Supabase, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  BUCKETS, CHECKLIST_ITEMS, QUESTION_TYPES, URGENCIES,
  bucketCounts, bucketRows, checklistProgress, isChecklistComplete, itemDone, startingChecklist,
  heldRow, secondsLeft, countdown, holdGone, lostRace, notInQueue, callbackOk, rowMeta,
} from './vaQueue.js'

const NOW = Date.parse('2026-10-28T20:00:00Z')
const ago = m => new Date(NOW - m * 60e3).toISOString()
const ahead = m => new Date(NOW + m * 60e3).toISOString()
const ids = list => list.map(r => r.lead_id)

// ── Bucket order and counts ─────────────────────────────────────────────────

const QUEUE = [
  { lead_id: 'n-old', bucket: 'new', created_at: ago(180) },
  { lead_id: 'r-old', bucket: 'not_reached', created_at: ago(600), va_attempts: 2 },
  { lead_id: 'n-new', bucket: 'new', created_at: ago(10) },
  { lead_id: 'c-late', bucket: 'callback_due', created_at: ago(900), va_callback_at: ago(5) },
  { lead_id: 'r-new', bucket: 'not_reached', created_at: ago(240), va_attempts: 1 },
  { lead_id: 'c-early', bucket: 'callback_due', created_at: ago(900), va_callback_at: ago(45) },
  { lead_id: 'n-mid', bucket: 'new', created_at: ago(60) },
]

test('sections show in the order Callback due, New, Not reached (callback first)', () => {
  assert.deepEqual(BUCKETS, ['callback_due', 'new', 'not_reached'])
  assert.deepEqual(Object.keys(bucketRows(QUEUE)), ['callback_due', 'new', 'not_reached'])
})

test('counts per section add up to the rows and zero out for an empty queue', () => {
  assert.deepEqual(bucketCounts(QUEUE), { callback_due: 2, new: 3, not_reached: 2 })
  assert.deepEqual(bucketCounts([]), { callback_due: 0, new: 0, not_reached: 0 })
  assert.deepEqual(bucketCounts(null), { callback_due: 0, new: 0, not_reached: 0 })
  const total = Object.values(bucketCounts(QUEUE)).reduce((a, b) => a + b, 0)
  assert.equal(total, QUEUE.length)
})

test('callbacks sort by the time they are due, the one due first at the top', () => {
  assert.deepEqual(ids(bucketRows(QUEUE).callback_due), ['c-early', 'c-late'])
})

test('a callback with no time falls back to when the lead arrived', () => {
  const g = bucketRows([
    { lead_id: 'b', bucket: 'callback_due', created_at: ago(10) },
    { lead_id: 'a', bucket: 'callback_due', created_at: ago(50) },
  ])
  assert.deepEqual(ids(g.callback_due), ['a', 'b'])
})

test('New and Not reached sort newest arrival first (the approved mockup order)', () => {
  const g = bucketRows(QUEUE)
  assert.deepEqual(ids(g.new), ['n-new', 'n-mid', 'n-old'])
  assert.deepEqual(ids(g.not_reached), ['r-new', 'r-old'])
})

test('every row lands in exactly one section; an unknown bucket is treated as New', () => {
  const g = bucketRows([...QUEUE, { lead_id: 'odd', bucket: 'something_else', created_at: ago(1) }])
  assert.equal(g.new[0].lead_id, 'odd')
  assert.equal(g.callback_due.length + g.new.length + g.not_reached.length, QUEUE.length + 1)
  assert.deepEqual(bucketCounts([{ bucket: undefined }, null]), { callback_due: 0, new: 2, not_reached: 0 })
})

test('sorting does not change the rows it was given', () => {
  const copy = JSON.parse(JSON.stringify(QUEUE))
  bucketRows(QUEUE)
  assert.deepEqual(QUEUE, copy)
  assert.deepEqual(bucketRows(undefined), { callback_due: [], new: [], not_reached: [] })
})

// ── The 4-item checklist ────────────────────────────────────────────────────

const FULL = { question_type: 'Claim', carrier: 'Carrier A', state: 'TX', urgency: 'Today' }

test('the checklist has exactly the four items: Question type, Carrier, State, Urgency', () => {
  assert.deepEqual(CHECKLIST_ITEMS.map(i => i.label), ['Question type', 'Carrier', 'State', 'Urgency'])
})

test('4 of 4 unlocks the outcomes', () => {
  assert.deepEqual(checklistProgress(FULL), { done: 4, total: 4, complete: true })
  assert.equal(isChecklistComplete(FULL), true)
})

test('3 of 4 stays locked, whichever item is missing', () => {
  for (const { key } of CHECKLIST_ITEMS) {
    for (const empty of ['', undefined, null]) {
      const three = { ...FULL, [key]: empty }
      assert.deepEqual(checklistProgress(three), { done: 3, total: 4, complete: false }, `${key} = ${String(empty)}`)
      assert.equal(isChecklistComplete(three), false)
      assert.equal(itemDone(three, key), false)
    }
  }
})

test('nothing picked reads 0 of 4; a missing checklist is locked', () => {
  assert.deepEqual(checklistProgress({}), { done: 0, total: 4, complete: false })
  assert.equal(isChecklistComplete(null), false)
  assert.equal(isChecklistComplete(undefined), false)
})

test('an answer only counts when it is one the screen offers', () => {
  assert.equal(isChecklistComplete({ ...FULL, urgency: 'Whenever' }), false)
  assert.equal(isChecklistComplete({ ...FULL, question_type: 'Quote' }), false)
  assert.equal(isChecklistComplete({ ...FULL, state: 'Texas' }), false)
  assert.equal(isChecklistComplete({ ...FULL, state: 'tx' }), false)
  assert.equal(isChecklistComplete({ ...FULL, carrier: '   ' }), false)
  for (const q of QUESTION_TYPES) assert.equal(itemDone({ question_type: q }, 'question_type'), true)
  for (const u of URGENCIES) assert.equal(itemDone({ urgency: u }, 'urgency'), true)
})

test('the starting checklist: state from the lead, then the server, then the device draft', () => {
  const row = { state: 'tx', va_checklist: { carrier: 'A', urgency: 'Today' } }
  assert.deepEqual(
    startingChecklist(row, { urgency: 'This week' }),
    { question_type: '', carrier: 'A', state: 'TX', urgency: 'This week' },
  )
  // A lead with only its state starts at 1 of 4: still locked.
  assert.equal(checklistProgress(startingChecklist({ state: 'TX' })).done, 1)
  assert.equal(isChecklistComplete(startingChecklist({ state: 'TX' })), false)
})

// ── The hold: claim expired sends the VA back to the queue ──────────────────

test('the hold clock counts down and stops at 0:00 once the claim has expired', () => {
  assert.equal(secondsLeft(ahead(14.5), NOW), 870)
  assert.equal(countdown(870), '14:30')
  assert.equal(secondsLeft(ago(1), NOW), 0)
  assert.equal(secondsLeft(new Date(NOW).toISOString(), NOW), 0)
  assert.equal(secondsLeft(null, NOW), 0)
  assert.equal(countdown(0), '0:00')
  assert.equal(countdown(-30), '0:00')
})

test('an expired claim is not restored on reload: heldRow gives nothing back', () => {
  const live = { lead_id: 'x', claimed_by_me: true, claim_expires_at: ahead(10) }
  const expired = { lead_id: 'x', claimed_by_me: true, claim_expires_at: ago(1) }
  const theirs = { lead_id: 'y', claimed_by_me: false, claim_expires_at: ahead(10) }
  assert.equal(heldRow([theirs, live], NOW).lead_id, 'x')
  assert.equal(heldRow([expired], NOW), null)
  assert.equal(heldRow([theirs], NOW), null)
  assert.equal(heldRow([], NOW), null)
  assert.equal(heldRow(null, NOW), null)
})

test('once the hold ends the lead is an ordinary queue row again and counts again', () => {
  // va_queue() drops claimed_by_me and claim_expires_at after expiry (migration 175).
  const afterExpiry = { lead_id: 'x', bucket: 'new', created_at: ago(30), claimed_by_me: false, claim_expires_at: null }
  assert.equal(heldRow([afterExpiry], NOW), null)
  assert.deepEqual(bucketCounts([afterExpiry]), { callback_due: 0, new: 1, not_reached: 0 })
  assert.deepEqual(ids(bucketRows([afterExpiry]).new), ['x'])
})

test('hold errors: 55006 is a lost race or a hold that is gone; 22023 / P0002 mean not in the queue', () => {
  assert.equal(lostRace({ code: '55006' }), true)
  assert.equal(holdGone({ code: '55006' }), true)
  assert.equal(lostRace({ code: '22023' }), false)
  assert.equal(notInQueue({ code: '22023' }), true)
  assert.equal(notInQueue({ code: 'P0002' }), true)
  assert.equal(notInQueue({ code: '55006' }), false)
  assert.equal(holdGone(null), false)
  assert.equal(holdGone({ code: '42501' }), false)
})

// The screen's own wiring: an ended hold shows "Your hold on this lead ended"
// and its button gives the lead up and returns to the queue.
const root = rel => fileURLToPath(new URL(rel, import.meta.url))
const read = rel => readFileSync(root(rel), 'utf8')
const flat = s => s.replace(/\s+/g, ' ')

test('the desk shows the hold-ended card when the time is up or the server says the hold is gone', () => {
  const desk = flat(read('../components/fulfillment/VaDesk.jsx'))
  assert.match(desk, /const gone = ended \|\| \(!done && secondsLeft\(expiresAt, now\) === 0\)/)
  assert.match(desk, /if \(gone\) return <HoldEnded name=\{displayName\(row\)\} onBack=\{onBack\} \/>/)
  assert.match(desk, /Your hold on this lead ended/)
  assert.match(desk, /<button type="button" className="ov-ghost" onClick=\{onBack\}>Back to queue<\/button>/)
  // A save that comes back "hold gone" (55006) ends the hold instead of showing a plain error.
  assert.match(desk, /holdGone\(e\) \? onHoldGone\(\)/)
  assert.match(desk, /onHoldGone=\{\(\) => setEnded\(true\)\}/)
})

test('going back clears the held lead and reloads the queue', () => {
  const page = flat(read('../pages/fulfillment/VaLeads.jsx'))
  assert.match(page, /const back = \(\) => \{ setHeld\(null\); setNotice\(''\); desk\.queue\.refetch\(\) \}/)
  assert.match(page, /onBack=\{back\}/)
})

test('outcomes stay disabled until the checklist is complete', () => {
  const desk = flat(read('../components/fulfillment/VaDesk.jsx'))
  assert.match(desk, /const complete = checklistProgress\(draft\.checklist\)\.complete/)
  assert.match(desk, /const active = complete \? pick : null/)
  assert.match(desk, /disabled=\{!complete\}/)
  assert.match(desk, /Finish the checklist to pick an outcome\./)
})

// ── Callback time ───────────────────────────────────────────────────────────

test('a callback must be in the future and within 90 days', () => {
  assert.equal(callbackOk(new Date(NOW + 3600e3), NOW), true)
  assert.equal(callbackOk(new Date(NOW - 1), NOW), false)
  assert.equal(callbackOk(new Date(NOW + 91 * 864e5), NOW), false)
  assert.equal(callbackOk(null, NOW), false)
})

test('a queue row reads "State · Lead type · time" and adds tries only in Not reached', () => {
  const base = { state: 'TX', lead_type: 'policy_help', created_at: ago(300), va_attempts: 1 }
  assert.equal(rowMeta({ ...base, bucket: 'not_reached' }, NOW), 'Texas · Policy help · 5 h ago · 1 try')
  assert.equal(rowMeta({ ...base, bucket: 'new' }, NOW), 'Texas · Policy help · 5 h ago')
})

// ── Source guard: no price, premium, quote or send-message words ────────────

const VA_SOURCES = [
  '../lib/vaQueue.js',
  '../hooks/useVaDesk.js',
  '../components/fulfillment/VaDesk.jsx',
  '../components/fulfillment/VaQueue.jsx',
  '../pages/fulfillment/VaLeads.jsx',
]

// What the screen runs and shows: comments out (they explain what is NOT here).
const code = rel => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1')

test('the VA sources are all there to be scanned', () => {
  for (const rel of VA_SOURCES) assert.ok(code(rel).length > 200, rel)
})

test('no price, premium, quote, cost or money wording anywhere on the VA screen', () => {
  const banned = /\b(price[sd]?|pricing|premium[s]?|quot(e|es|ed|ing)|cost[s]?|rate[s]? table|per month|monthly|\/mo|benefit[s]?|payout|death benefit|face amount)\b|[$€£]\s?\d|\bUSD\b|toFixed\(2\)|_cents\b/i
  for (const rel of VA_SOURCES) {
    const hit = code(rel).match(banned)
    assert.equal(hit, null, `${rel} contains "${hit?.[0]}"`)
  }
})

test('"coverage" shows only as the Coverage question label and the logistics line', () => {
  for (const rel of VA_SOURCES) {
    const left = code(rel)
      .replace("'Coverage question'", '')
      .replace("'Logistics only. Any coverage question goes to a licensed agent.'", '')
    assert.equal(left.match(/coverage/i), null, `${rel} says "coverage" somewhere else`)
  }
})

test('nothing on the VA screen texts, emails or calls anyone', () => {
  const banned = /\b(sms|mms|twilio|sendmessage|send_message|send-sms|sendsms|sendtext|sendemail|notify-email|notify-push)\b|functions\.invoke|\bfetch\(|mailto:|\bnew Notification\b|sms:/i
  for (const rel of VA_SOURCES) {
    const hit = code(rel).match(banned)
    assert.equal(hit, null, `${rel} contains "${hit?.[0]}"`)
  }
  // "send" never appears as an action word; the only mentions are the
  // reassurance lines ("No text, email or call was sent / goes out from here").
  for (const rel of VA_SOURCES) assert.equal(code(rel).match(/\bsend(s|ing)?\b/i), null, rel)
})

test('the VA screen reads and writes only through the five migration-175 functions', () => {
  const allowed = new Set(['va_queue', 'va_agent_roster', 'va_claim', 'va_release', 'va_set_lead_outcome'])
  const calls = []
  for (const rel of VA_SOURCES) {
    const src = code(rel)
    for (const m of src.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'/g)) calls.push(m[1])
    assert.equal(src.match(/supabase\s*\.\s*from\(/), null, `${rel} reads or writes a table directly`)
  }
  assert.ok(calls.length >= 5, 'the hook should call the va_ functions')
  for (const c of calls) assert.ok(allowed.has(c), `unexpected rpc ${c}`)
  for (const a of allowed) assert.ok(calls.includes(a), `${a} is never called`)
})
