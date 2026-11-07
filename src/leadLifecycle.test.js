import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  STAGES, STAGE_KEYS, LEAD_LANES, TRIGGERS, SAMPLE_NOW, addMin, seedEvents, applyMove, addReply, needsYouNow, forYourInfo,
  needsOutcome, matchPeople, fillFromMatch, stageChipOf, atLabel,
} from './template/leadLifecycle.js'
import { LEAD_TEXTS } from './template/leadTexts.js'

// P873 — the lead path: stage moves, Needs-you-now order, Submit's lead match, the text drafts, and the agent words.
const mk = (id, first, stage, o = {}) => {
  const l = { id, first_name: first, last_name: 'Test', phone: '(919) 555-0164', city: 'Raleigh', state: 'NC', kind: 'appointment', status: 'assigned', outcome: null, stage, came: '2026-10-30T10:00', apptAt: null, reply: null, ...o }
  return { ...l, events: seedEvents(l) }
}

test('every stage sits in exactly one lane and maps to a real inbound_stage', () => {
  const db = ['new', 'contacting', 'booked', 'met', 'sold', 'follow_up', 'lost'] // migration 180 check
  for (const k of STAGE_KEYS) {
    assert.equal(LEAD_LANES.filter(l => l.stages.includes(k)).length, 1, k)
    assert.ok(db.includes(STAGES[k].db), k)
  }
  assert.deepEqual(LEAD_LANES.map(l => l.label), ['Calling', 'Live transfer', 'Booked', 'No-show', 'Follow up', 'Sold', 'Closed'])
})

test('stage moves set the stage, the db fields and add a timeline row by the agent', () => {
  const l = mk('a', 'Ellen', 'booked', { apptAt: '2026-11-02T13:00' })
  const sold = applyMove(l, 'sold')
  assert.equal(sold.stage, 'sold')
  assert.equal(sold.dbStage, 'sold')
  assert.equal(sold.outcome, 'sold')
  assert.equal(sold.status, 'closed')
  assert.deepEqual(sold.events.at(-1), { ...sold.events.at(-1), kind: 'outcome', label: 'Sold', by: 'You', at: SAMPLE_NOW })
  const follow = applyMove(l, 'follow_up', { follow: 'Thu, Nov 5' })
  assert.equal(follow.events.at(-1).label, 'Follow up Thu, Nov 5')
  assert.equal(follow.follow, 'Thu, Nov 5')
  const gone = applyMove(l, 'not_interested', { reason: 'Already covered' })
  assert.equal(gone.dbStage, 'lost')
  assert.equal(gone.outcome, 'not_interested')
  // A no-show goes back to the team: the rebook text and the rebook call are next.
  const ns = applyMove(l, 'no_show')
  assert.equal(ns.dbStage, 'booked')
  assert.deepEqual(ns.events.slice(-3).map(e => [e.kind, e.state]), [['no_show', 'done'], ['text_sent', 'scheduled'], ['va_call', 'scheduled']])
  assert.equal(ns.events.at(-2).text, LEAD_TEXTS.no_show_rebook.replace('[Lead first name]', 'Ellen'))
  // Agents can't put a lead into the team's own steps.
  assert.throws(() => applyMove(l, 'calling'))
  assert.throws(() => applyMove(l, 'opted_out'))
})

test('the seeded timeline is in time order, done before now and scheduled after', () => {
  const l = mk('b', 'Dana', 'booked', { apptAt: '2026-11-05T15:00', came: '2026-11-02T10:52' })
  const at = l.events.map(e => e.at)
  assert.deepEqual(at, [...at].sort())
  for (const e of l.events) assert.equal(e.state, e.at > SAMPLE_NOW ? 'scheduled' : 'done', e.label)
  assert.deepEqual(l.events.map(e => e.kind), ['came_in', 'text_sent', 'va_call', 'text_sent', 'text_received', 'va_call', 'booked', 'text_sent', 'text_sent', 'text_sent'])
  // Unreachable: three tries, the day 7 text, check-ins at day 30, 60 and 90, then closed.
  const u = mk('c', 'Victor', 'unreachable', { came: '2026-07-28T19:05' })
  assert.deepEqual(u.events.filter(e => e.label.startsWith('Check-in')).map(e => e.label), ['Check-in, day 30', 'Check-in, day 60', 'Check-in, day 90'])
  assert.equal(u.events.filter(e => e.kind === 'va_call').length, 3)
  const o = mk('d', 'Joan', 'opted_out')
  assert.equal(o.events.filter(e => e.kind === 'text_sent').at(-1).step, 'stop_confirm')
})

test('a reply from the agent is saved on the timeline and clears the Reply trigger', () => {
  const l = mk('e', 'Tanya', 'calling', { tries: 2, reply: { text: 'After 6?', at: '2026-11-02T13:52', seen: false } })
  assert.equal(needsYouNow({ leads: [l] })[0].trigger, 'reply')
  const r = addReply(l, 'I will call you at 6:15.')
  assert.equal(r.events.at(-1).by, 'You')
  assert.equal(needsYouNow({ leads: [r] }).length, 0)
})

test('Needs you now: the six triggers, most urgent first, each with its action', () => {
  const leads = [
    mk('f', 'Follow', 'follow_up', { follow: 'Mon, Nov 2' }),
    mk('r', 'Reply', 'calling', { reply: { text: 'Call me', at: '2026-11-02T13:50', seen: false } }),
    mk('o', 'Ended', 'booked', { apptAt: '2026-11-02T13:00' }),
    mk('s', 'Starting', 'booked', { apptAt: '2026-11-02T14:00' }),
    mk('l', 'Live', 'ringing', { kind: 'live_call' }),
    mk('m', 'Missed', 'missed', { kind: 'live_call' }),
    mk('n', 'NoShow', 'no_show', { apptAt: '2026-11-02T11:00' }),
    mk('x', 'Later', 'booked', { apptAt: '2026-11-05T15:00', fresh: true }),
  ]
  const clients = [{ id: 'c1', client_first_name: 'Gloria', client_last_name: 'Santos', client_phone: '(305) 555-0156', stage: 'needs_attention', attention: 'Confirm the number' }]
  const now = needsYouNow({ leads, clients })
  assert.deepEqual(now.map(n => n.trigger), ['live', 'starting', 'outcome', 'reply', 'follow', 'servicing'])
  assert.deepEqual(now.map(n => n.action), TRIGGERS.map(t => t.action))
  assert.deepEqual(TRIGGERS.map(t => t.action), ['Answer', 'Join call', 'Mark outcome', 'Reply', 'Call back', 'Open'])
  // FYI: the team is on it.
  assert.deepEqual(forYourInfo({ leads }).map(f => f.title), ['Missed transfer', 'No-show', 'New booking'])
})

test('an appointment needs you 15 minutes before; once 30 minutes have passed it needs an outcome', () => {
  const at = t => needsYouNow({ leads: [mk('a', 'A', 'booked', { apptAt: t })] }).map(n => n.trigger)
  assert.deepEqual(at(addMin(SAMPLE_NOW, 15)), ['starting'])
  assert.deepEqual(at(addMin(SAMPLE_NOW, 16)), [])
  assert.deepEqual(at(addMin(SAMPLE_NOW, -29)), ['starting'])
  assert.deepEqual(at(addMin(SAMPLE_NOW, -30)), ['outcome'])
  assert.equal(needsOutcome(mk('b', 'B', 'showed')), true)
  assert.equal(atLabel('2026-11-02T13:00'), 'Today, 1:00 PM')
  assert.equal(atLabel('2026-11-01T09:05'), 'Yesterday, 9:05 AM')
})

test('Submit matches the agent\'s leads and clients by name or phone and fills the form', () => {
  const leads = [mk('l1', 'Ellen', 'booked', { last_name: 'Park', apptAt: '2026-11-02T13:00' }), mk('l2', 'Paul', 'new', { last_name: 'Kim', phone: '(206) 555-0182', state: 'WA', city: 'Seattle' })]
  const clients = [{ id: 'c1', client_first_name: 'Gloria', client_last_name: 'Santos', client_phone: '(305) 555-0156', city: 'Miami', state: 'FL' }]
  assert.deepEqual(matchPeople('e', leads, clients), [])
  assert.deepEqual(matchPeople('ell', leads, clients).map(m => m.name), ['Ellen Park'])
  assert.deepEqual(matchPeople('kim', leads, clients).map(m => m.name), ['Paul Kim'])
  assert.deepEqual(matchPeople('206', leads, clients).map(m => m.name), ['Paul Kim'])
  assert.deepEqual(matchPeople('(305) 55', leads, clients).map(m => [m.name, m.kind, m.stage]), [['Gloria Santos', 'client', 'Client']])
  assert.deepEqual(matchPeople('zzz', leads, clients), [])
  const [m] = matchPeople('Paul', leads, clients)
  assert.deepEqual({ ...m, score: undefined }, { kind: 'lead', id: 'l2', name: 'Paul Kim', phone: '(206) 555-0182', city: 'Seattle', state: 'WA', stage: 'New lead', sold: false, score: undefined })
  assert.deepEqual(fillFromMatch(m), { name: 'Paul Kim', phone: '2065550182', city: 'Seattle', state: 'WA', linked: { kind: 'lead', id: 'l2', stage: 'New lead' } })
  assert.equal(stageChipOf({ stage: 'calling', tries: 2 }), 'Calling, try 2 of 3')
})

test('lead texts are the workflow drafts word for word, with Deedstone as the sender', () => {
  const ts = readFileSync('supabase/functions/lead-workflow-sms/templates.ts', 'utf8')
  const drafts = Object.fromEntries([...ts.matchAll(/export const DRAFT_(\w+) =\s*\n\s*[`'"](.*?)[`'"]\r?\n/g)].map(([, k, v]) => [k.toLowerCase(), v]))
  assert.equal(Object.keys(drafts).length, 10)
  for (const [k, v] of Object.entries(drafts)) {
    const want = v.replace(' ${OPT_OUT_PLACEHOLDER}', '').replace('This is Ohvara', 'This is Deedstone').replace('from Ohvara', 'from Deedstone')
    assert.equal(LEAD_TEXTS[k], want, k)
  }
})

test('the lead path never says GoHighLevel, Meta, Google or ads to an agent', () => {
  const files = ['leadLifecycle.js', 'leadTexts.js', 'LeadOutcome.jsx', 'NeedsNow.jsx', 'needAction.js', 'screens/Leads.jsx', 'screens/Overview.jsx', 'screens/Submit.jsx', 'screens/Calendar.jsx', 'data/index.js']
  const bad = /GoHighLevel|\bGHL\b|\bMeta\b|Google|Facebook|\bads?\b/i
  for (const f of files) {
    const src = readFileSync(`src/template/${f}`, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n')
    const strings = src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}\n]+</g) || []
    for (const s of strings) assert.doesNotMatch(s, bad, `${f}: ${s}`)
  }
})
