/**
 * Unit tests for the Booked Appointments texts. Everything is faked: no
 * database, no Twilio, no network. The fake inbound_events store keeps the
 * NNN unique index (one scheduled/done row per lead, step and seq). Every
 * "nothing sent" case counts calls to the fake `send`.
 * Run: deno test --node-modules-dir=none supabase/functions/lead-workflow-sms/
 *  or: node --test supabase/functions/lead-workflow-sms/core.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  handle, plan, tick, nextAllowed, KINDS, STATES, MONTHLY_MAX, NO_SHOW_MAX, STOP_STEP,
  type Deps, type Event, type Lead, type NewEvent, type Patch, type State, type Step,
} from './core.ts'
import { OPT_OUT_PLACEHOLDER, TEMPLATES, type Template } from './templates.ts'

const LEAD = '11111111-1111-4111-8111-111111111111'
const AGENT = '22222222-2222-4222-8222-222222222222'
const CENTRAL = '+13125550199'
// Noon in Chicago (CDT, UTC-5) on a Wednesday; the lead is in Illinois.
const NOON = new Date('2026-10-28T12:00:00-05:00')
// Friday 10:00 AM: the day-before reminder lands Thursday 10:00 AM, the 1 h one 9:00 AM.
const APPT = new Date('2026-10-30T10:00:00-05:00')
const HOUR = 3600e3
const iso = (t: Date | number) => new Date(t).toISOString()

// The drafts with the placeholder taken out, for the cases that must send.
const CLEAN = Object.fromEntries(
  Object.entries(TEMPLATES).map(([k, t]) => [k, { ...t, body: t.body.split(` ${OPT_OUT_PLACEHOLDER}`).join('') }]),
) as Record<Step, Template>

type Row = Event & Partial<Omit<NewEvent, 'kind' | 'state'>>
const live = (r: Row) => r.state === 'scheduled' || r.state === 'done'
const seqKey = (r: Row) => String(r.detail?.seq ?? '1')

function make(o: { live?: boolean; templates?: Record<Step, Template>; lead?: Partial<Lead>; link?: string | null } = {}) {
  const s = {
    now: NOON, live: o.live ?? false, central: CENTRAL as string | null,
    optedOut: false, repliesTable: false,
  }
  const rows: Row[] = []
  const written = new Set<string>()          // ids the core inserted
  const sent: { to: string; body: string; from: string }[] = []
  const lead: Lead = {
    id: LEAD, lead_type: 'mortgage_protection', inbound_stage: 'new', phone: '(312) 555-1234',
    contact_name: 'Maria Lopez', state: 'IL', agent_id: AGENT, agent_name: 'Sam Lee', ...o.lead,
  }
  let n = 0
  const clash = (r: Row, lead_id: string, step: unknown, seq: string) =>
    r.lead_id === lead_id && r.detail?.step === step && seqKey(r) === seq && live(r)

  const deps: Deps = {
    smsLive: async () => s.live,
    centralNumber: async () => s.central,
    getLead: async id => (id === lead.id ? { ...lead } : null),
    events: async id => rows.filter(r => r.lead_id === id).map(r => structuredClone(r)),
    replied: async () => s.repliesTable,
    optedOut: async () => s.optedOut,
    leadsWithScheduled: async () => [...new Set(rows.filter(r => r.state === 'scheduled' && r.detail?.step).map(r => r.lead_id))],
    async insert(row: NewEvent) {
      if (row.detail.step && live(row as Row) && rows.some(r => clash(r, row.lead_id, row.detail.step, String(row.detail.seq ?? '1')))) return false
      const id = `e${++n}`
      written.add(id)
      rows.push({ id, created_at: iso(s.now), ...structuredClone(row) })
      return true
    },
    async update(id: string, patch: Patch, from: State) {
      const r = rows.find(x => x.id === id)
      if (!r || r.state !== from) return false
      const next = { ...r, ...structuredClone(patch) }
      if (next.detail?.step && live(next) && rows.some(x => x !== r && clash(x, r.lead_id, next.detail.step, seqKey(next)))) {
        throw new Error('unique violation')
      }
      Object.assign(r, structuredClone(patch))
      return true
    },
    send: async (to, body, from) => { sent.push({ to, body, from }); return { ok: true, sid: `SM${sent.length}` } },
    now: () => s.now,
    rescheduleUrl: o.link === undefined ? 'https://example.test/reschedule' : o.link,
    templates: o.templates,
  }

  // What other code writes on the inbound (180's VA desk, the webhook).
  const event = (kind: string, at: Date, detail: Record<string, unknown> = {}, state = 'done') => {
    rows.push({ id: `x${++n}`, lead_id: LEAD, kind, state, at: iso(at), detail, created_at: iso(s.now) })
  }
  const book = (appt: Date) => { event('booked', s.now, { appointment_at: iso(appt) }); lead.inbound_stage = 'booked' }
  const noShow = (at: Date) => event('no_show', at)
  const reply = () => event('text_received', s.now, { text: 'yes, call me' })

  const of = (step: string, seq?: number) => rows.filter(r => r.detail?.step === step && (seq === undefined || Number(r.detail.seq) === seq))
  const at = (step: string, seq = 1) => {
    const r = of(step, seq).find(x => x.state === 'scheduled')
    assert.ok(r, `${step} ${seq} is scheduled`)
    return new Date(r.at)
  }
  return {
    s, rows, written, sent, lead, deps, book, noShow, reply, of, at,
    plan: () => plan(deps, LEAD),
    tick: () => tick(deps),
  }
}

const STEPS_ALL: Step[] = [
  'instant', 'not_reached_d0', 'not_reached_d1', 'not_reached_d3', 'not_reached_d7',
  'not_reached_monthly', 'confirm', 'reminder_day_before', 'reminder_1h', 'no_show_rebook',
]
const CADENCE: Step[] = ['not_reached_d0', 'not_reached_d1', 'not_reached_d3', 'not_reached_d7', 'not_reached_monthly']

// Sets up a lead so `step` (seq 1) gets planned, then plans.
async function setup(f: ReturnType<typeof make>, step: Step) {
  if (step === 'confirm' || step === 'reminder_day_before' || step === 'reminder_1h') f.book(APPT)
  if (step === 'no_show_rebook') {
    const past = new Date(NOON.getTime() - 2 * HOUR)
    f.rows.push({ id: 'b1', lead_id: LEAD, kind: 'booked', state: 'done', at: iso(NOON.getTime() - 24 * HOUR), detail: { appointment_at: iso(past) }, created_at: iso(NOON.getTime() - 24 * HOUR) })
    f.lead.inbound_stage = 'booked'
    f.noShow(new Date(NOON.getTime() - HOUR))
  }
  const r = await f.plan()
  assert.equal(r.status, 200)
}

// ── (1) sms_live off: nothing sent, one skipped row per step ────────────────
for (const step of STEPS_ALL) {
  test(`sms_off skips ${step}`, async () => {
    const f = make({ live: false, templates: CLEAN })
    await setup(f, step)
    f.s.now = f.at(step)
    await f.tick()
    assert.equal(f.sent.length, 0)
    const rows = f.of(step)
    assert.equal(rows.length, 1, `${step}: exactly one row`)
    assert.equal(rows[0].state, 'skipped')
    assert.equal(rows[0].detail.reason, 'sms_off')
    // Planning again adds nothing back.
    await f.plan()
    assert.equal(f.of(step).length, 1)
  })
}

// ── (2) stops ───────────────────────────────────────────────────────────────
function assertStopped(f: ReturnType<typeof make>, reason: string, label: string) {
  for (const step of CADENCE) {
    const rows = f.of(step)
    assert.equal(rows.length, 1, `${step}: one row`)
    assert.equal(rows[0].state, 'skipped', `${step} skipped`)
    assert.equal(rows[0].detail.reason, reason)
  }
  const stops = f.of(STOP_STEP)
  assert.equal(stops.length, 1)
  assert.equal(stops[0].kind, 'follow_up')
  assert.equal(stops[0].state, 'done')
  assert.equal(stops[0].label, label)
}

test('reply stops cadence', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  await f.tick()                                   // welcome text goes
  assert.equal(f.sent.length, 1)
  f.s.now = new Date(NOON.getTime() + HOUR)
  f.reply()
  await f.tick()
  assertStopped(f, 'stopped_reply', 'Follow-up texts stopped: they replied')
  f.s.now = new Date(NOON.getTime() + 60 * 24 * HOUR)
  await f.tick()
  await f.plan()
  assert.equal(f.sent.length, 1, 'nothing after the reply')
  assert.equal(f.of(STOP_STEP).length, 1, 'one stop row')

  // A reply saved only in lead_sms_replies stops it too.
  const g = make({ live: true, templates: CLEAN })
  await g.plan()
  g.s.repliesTable = true
  await g.tick()
  assertStopped(g, 'stopped_reply', 'Follow-up texts stopped: they replied')
})

test('booking stops cadence', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  await f.tick()
  f.s.now = new Date(NOON.getTime() + HOUR)
  f.book(APPT)
  await f.plan()
  assertStopped(f, 'stopped_booked', 'Follow-up texts stopped: they booked')
  // ...and the booking still gets its confirmation and reminders.
  for (const step of ['confirm', 'reminder_day_before', 'reminder_1h'] as Step[]) {
    assert.equal(f.of(step).filter(r => r.state === 'scheduled').length, 1, `${step} scheduled`)
  }
  assert.equal(f.at('reminder_day_before').toISOString(), iso(APPT.getTime() - 24 * HOUR))
  assert.equal(f.at('reminder_1h').toISOString(), iso(APPT.getTime() - HOUR))
  await f.tick()
  assert.equal(f.of('confirm')[0].state, 'done')
  assert.match(f.sent[1].body, /Fri, Oct 30, 10:00 AM/)
  assert.match(f.sent[1].body, /example\.test\/reschedule/)
})

test('opt-out stops cadence', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  f.s.optedOut = true
  await f.tick()
  assertStopped(f, 'stopped_opt_out', 'Follow-up texts stopped: they opted out')
  assert.equal(f.of('instant')[0].state, 'skipped')
  assert.equal(f.of('instant')[0].detail.reason, 'opt_out')
  assert.equal(f.sent.length, 0)
})

// ── (3) / (4) the central number ────────────────────────────────────────────
test('every send uses the central number from settings', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  await f.tick()
  f.s.central = '+13125550142'
  f.s.now = f.at('not_reached_d0')
  await f.tick()
  assert.equal(f.sent.length, 2)
  assert.equal(f.sent[0].from, CENTRAL)
  assert.equal(f.sent[1].from, '+13125550142')
  for (const m of f.sent) assert.equal(m.to, '+13125551234')
  assert.equal(f.of('instant')[0].detail.twilio_sid, 'SM1')
})

test('null central number skips no_sender', async () => {
  const f = make({ live: true, templates: CLEAN })
  f.s.central = null
  await f.plan()
  await f.tick()
  assert.equal(f.sent.length, 0)
  const rows = f.of('instant')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].state, 'skipped')
  assert.equal(rows[0].detail.reason, 'no_sender')
})

// ── (5) idempotent ──────────────────────────────────────────────────────────
test('no duplicate steps', async () => {
  const f = make({ live: false })
  await f.plan(); await f.plan(); await f.plan()
  const afterFirst = f.rows.length
  assert.equal(afterFirst, 6)
  await f.tick(); await f.plan()
  assert.equal(f.rows.length, afterFirst, 'a skipped step is not planned again')
  f.book(APPT)
  await f.plan(); await f.plan()
  f.noShow(new Date(APPT.getTime() + HOUR))
  await f.plan(); await f.plan()
  const seen = new Map<string, number>()
  for (const r of f.rows.filter(r => r.detail?.step && live(r))) {
    const k = `${r.detail.step}:${seqKey(r)}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  for (const [k, c] of seen) assert.equal(c, 1, `${k} once`)
  const anyState = new Map<string, number>()
  for (const r of f.rows.filter(r => f.written.has(r.id))) {
    const k = `${r.detail.step}:${seqKey(r)}`
    anyState.set(k, (anyState.get(k) ?? 0) + 1)
  }
  for (const [k, c] of anyState) assert.equal(c, 1, `${k}: one row in any state`)
})

// ── (6) no-show ─────────────────────────────────────────────────────────────
test('no-show at most twice', async () => {
  const f = make({ live: true, templates: CLEAN })
  const past = new Date(NOON.getTime() - 3 * HOUR)
  f.rows.push({ id: 'b1', lead_id: LEAD, kind: 'booked', state: 'done', at: iso(NOON.getTime() - 48 * HOUR), detail: { appointment_at: iso(past) }, created_at: iso(NOON.getTime() - 48 * HOUR) })
  f.lead.inbound_stage = 'booked'
  for (let i = 0; i < 3; i++) {
    f.noShow(f.s.now)
    await f.plan()
    await f.tick()
    f.s.now = new Date(f.s.now.getTime() + 24 * HOUR)
  }
  const rebooks = f.sent.filter(m => /sorry we missed you/.test(m.body))
  assert.equal(rebooks.length, NO_SHOW_MAX)
  assert.equal(NO_SHOW_MAX, 2)
  assert.deepEqual(f.of('no_show_rebook').map(r => Number(r.detail.seq)).sort(), [1, 2])
})

// ── (7) the placeholder ─────────────────────────────────────────────────────
test('placeholder blocks send', async () => {
  for (const t of Object.values(TEMPLATES)) assert.ok(t.body.includes(OPT_OUT_PLACEHOLDER))
  const f = make({ live: true })                   // the real drafts
  f.book(APPT)
  await f.plan()
  await f.tick()
  assert.equal(f.sent.length, 0)
  const confirm = f.of('confirm')
  assert.equal(confirm.length, 1)
  assert.equal(confirm[0].state, 'skipped')
  assert.equal(confirm[0].detail.reason, 'draft_copy')
})

// ── (8) every row fits 180's checks ─────────────────────────────────────────
test('rows match inbound_events checks', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  await f.tick()
  for (const step of ['not_reached_d0', 'not_reached_d1', 'not_reached_d3', 'not_reached_d7', 'not_reached_monthly'] as Step[]) {
    f.s.now = f.at(step)
    await f.tick()
  }
  f.s.now = f.at('not_reached_monthly', 2)
  await f.tick()                                   // monthly 2 goes, 3 is planned
  f.reply()
  await f.tick()                                   // stop row
  f.book(new Date(f.s.now.getTime() + 3 * 24 * HOUR))
  await f.plan()
  f.noShow(f.s.now)
  await f.plan()
  await f.tick()
  const mine = f.rows.filter(r => f.written.has(r.id))
  assert.ok(mine.length >= 12)
  for (const r of mine) {
    assert.ok((KINDS as readonly string[]).includes(r.kind), `kind ${r.kind}`)
    assert.ok((STATES as readonly string[]).includes(r.state), `state ${r.state}`)
    assert.equal(typeof r.detail, 'object')
    assert.ok(r.detail && !Array.isArray(r.detail))
    assert.equal(typeof r.detail.step, 'string')
    assert.equal(typeof r.detail.seq, 'number')
    assert.equal(r.actor_name, 'Ohvara')
    assert.equal(r.actor_role, 'system')
    assert.ok(r.label && r.label.length > 0)
    assert.ok(!Number.isNaN(new Date(r.at).getTime()))
    assert.doesNotMatch(JSON.stringify({ label: r.label, detail: r.detail }), /\+?1?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/, 'no phone number')
    if (r.state === 'skipped') assert.equal(typeof r.detail.reason, 'string')
  }
  assert.ok(mine.some(r => r.kind === 'text_sent') && mine.some(r => r.kind === 'reminder') && mine.some(r => r.kind === 'follow_up'))
})

// ── the rest of the gates ───────────────────────────────────────────────────
test('monthly texts stop at MONTHLY_MAX', async () => {
  const f = make({ live: true, templates: CLEAN })
  await f.plan()
  for (let seq = 1; seq <= MONTHLY_MAX; seq++) {
    f.s.now = f.at('not_reached_monthly', seq)
    await f.tick()
  }
  assert.equal(f.of('not_reached_monthly').filter(r => r.state === 'done').length, MONTHLY_MAX)
  assert.equal(f.of('not_reached_monthly').filter(r => r.state === 'scheduled').length, 0)
})

test('quiet hours: planned and moved into the window, never sent outside it', async () => {
  const late = new Date('2026-10-28T22:30:00-05:00')   // 10:30 PM in Chicago
  assert.equal(nextAllowed(late, 'IL')?.toISOString(), iso(new Date('2026-10-29T08:00:00-05:00')))
  assert.equal(nextAllowed(late, 'ZZ'), null)
  const f = make({ live: true, templates: CLEAN })
  f.s.now = late
  await f.plan()
  assert.equal(f.at('instant').toISOString(), iso(new Date('2026-10-29T08:00:00-05:00')))
  // A row that came due at night (a late tick) is moved, not sent.
  const row = f.of('instant')[0]
  row.at = iso(late)
  await f.tick()
  assert.equal(f.sent.length, 0)
  assert.equal(f.of('instant')[0].state, 'scheduled')
  assert.equal(f.at('instant').toISOString(), iso(new Date('2026-10-29T08:00:00-05:00')))
  // Unknown state: never texted.
  const g = make({ live: true, templates: CLEAN, lead: { state: null } })
  await g.plan()
  await g.tick()
  assert.equal(g.sent.length, 0)
  assert.equal(g.of('instant')[0].detail.reason, 'quiet_hours')
})

test('missing phone and missing reschedule link skip', async () => {
  const f = make({ live: true, templates: CLEAN, lead: { phone: null } })
  await f.plan(); await f.tick()
  assert.equal(f.of('instant')[0].detail.reason, 'no_phone')
  const g = make({ live: true, templates: CLEAN, link: null })
  g.book(APPT)
  await g.plan(); await g.tick()
  assert.equal(g.of('confirm')[0].detail.reason, 'no_link')
  assert.equal(f.sent.length + g.sent.length, 0)
})

test('a moved appointment skips the old reminders and plans new ones', async () => {
  const f = make({ live: false })
  f.book(APPT)
  await f.plan()
  const later = new Date(APPT.getTime() + 24 * HOUR)
  f.s.now = new Date(NOON.getTime() + HOUR)
  f.book(later)
  await f.plan()
  assert.equal(f.of('reminder_1h', 1)[0].state, 'skipped')
  assert.equal(f.of('reminder_1h', 1)[0].detail.reason, 'rescheduled')
  assert.equal(f.at('reminder_1h', 2).toISOString(), iso(later.getTime() - HOUR))
})

test('handle: plan and tick only; bad lead_id and other lead types refused', async () => {
  const f = make()
  assert.equal((await handle(f.deps, { action: 'send' })).status, 400)
  assert.equal((await handle(f.deps, {})).status, 400)
  assert.equal((await handle(f.deps, { action: 'plan', lead_id: 'nope' })).status, 400)
  assert.equal((await handle(f.deps, { action: 'plan', lead_id: '33333333-3333-4333-8333-333333333333' })).status, 404)
  assert.equal((await handle(f.deps, { action: 'tick' })).status, 200)
  const g = make({ lead: { lead_type: 'policy_help' } })
  assert.equal((await handle(g.deps, { action: 'plan', lead_id: LEAD })).status, 422)
  assert.equal(g.rows.length, 0)
})
