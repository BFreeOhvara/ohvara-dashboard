import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import {
  STAGES, STAGE_KEYS, LEAD_LANES, TRIGGERS, SAMPLE_NOW, addMin, seedEvents, applyMove, replyIntent, replyRows, agentCallTask, closeCallTask, needsYouNow, forYourInfo,
  needsOutcome, matchPeople, fillFromMatch, stageChipOf, atLabel,
} from './template/leadLifecycle.js'
import { LEAD_TEXTS, leadText } from './template/leadTexts.js'

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
  // P915: the VA side uses admin's and the agent's five statuses (P913).
  assert.deepEqual(LEAD_LANES.map(l => l.label), ['Delivered', 'No show', 'Follow up', 'Sold', 'Not interested'])
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
  assert.deepEqual(ns.events.slice(-3).map(e => [e.kind, e.state]), [['no_show', 'done'], ['text_sent', 'scheduled'], ['ai_call', 'scheduled']]) // P931: the AI caller rebooks a no-show, not a VA
  // P878: the one-tap rebook link waits out the Undo, then sends.
  assert.equal(ns.events.at(-2).step, 'no_show_link')
  assert.equal(ns.events.at(-2).text, leadText('no_show_link', { lead: 'Ellen' }))
  assert.match(ns.events.at(-2).text, /deedstone\.com\/r\//)
  // Agents can't put a lead into the team's own steps.
  assert.throws(() => applyMove(l, 'calling'))
  assert.throws(() => applyMove(l, 'opted_out'))
})

test('the seeded timeline is in time order, done before now and scheduled after', () => {
  const l = mk('b', 'Dana', 'booked', { apptAt: '2026-11-05T15:00', came: '2026-11-02T10:52' })
  const at = l.events.map(e => e.at)
  assert.deepEqual(at, [...at].sort())
  for (const e of l.events) assert.equal(e.state, e.at > SAMPLE_NOW ? 'scheduled' : 'done', e.label)
  // P902: no text before the first call. No answer → retry → the missed-call text; her reply stops that flow; booked →
  // the booking text, the evening before, the morning of and 1 hour before (Planned).
  assert.deepEqual(l.events.map(e => e.kind), ['came_in', 'va_call', 'va_call', 'outcome', 'text_sent', 'follow_up', 'text_received', 'va_call', 'booked', 'outcome', 'text_sent', 'text_sent', 'text_sent', 'text_sent'])
  assert.deepEqual(l.events.filter(e => e.state === 'scheduled').map(e => e.at), ['2026-11-04T18:30', '2026-11-05T08:30', '2026-11-05T14:00'])
  // Unreachable: the first call and the 2-minute retry (too late that evening for a same-day call), calls on day 1 and
  // day 3, the day 7 text, check-ins at day 30, 60 and 90, then closed.
  const u = mk('c', 'Victor', 'unreachable', { came: '2026-07-28T19:05' })
  assert.deepEqual(u.events.filter(e => e.label.startsWith('Check-in')).map(e => e.label), ['Check-in, day 30', 'Check-in, day 60', 'Check-in, day 90'])
  assert.equal(u.events.filter(e => e.kind === 'va_call').length, 4)
  assert.match(u.events.at(-1).label, /^Closed: couldn’t reach/)
  const o = mk('d', 'Joan', 'opted_out')
  assert.equal(o.events.filter(e => e.kind === 'text_sent').at(-1).step, 'stop_confirm')
})

test('P878: nobody replies by hand: replies are answered automatically, with a call task when a person is needed', () => {
  assert.equal(replyIntent('STOP'), 'stop')
  assert.equal(replyIntent('Yes see you then'), 'confirm')
  assert.equal(replyIntent('I cant make it, can we do another time'), 'reschedule')
  assert.equal(replyIntent('Does it cover my mortgage?'), 'call')
  assert.equal(replyIntent('hmm'), 'unclear')
  // Before booking: a holding reply and a call task for the team. Nothing needs the agent.
  const early = mk('e', 'Tanya', 'calling', { tries: 2 })
  const er = replyRows(early, 'After 6?', '2026-11-02T13:52')
  assert.deepEqual(er.map(r => r.kind), ['text_received', 'text_sent', 'call_task'])
  assert.equal(er[1].step, 'holding_reply')
  assert.equal(er[2].task, 'team')
  assert.equal(needsYouNow({ leads: [{ ...early, reply: { text: 'After 6?', at: '2026-11-02T13:52' } }] }).length, 0)
  // After hours the holding reply says when.
  assert.equal(replyRows(early, 'Call me', '2026-11-02T21:10')[1].step, 'holding_reply_after_hours')
  // Booked: a confirm is answered and marked; a question becomes a call task for the agent.
  const booked = mk('b', 'Ray', 'booked', { apptAt: '2026-11-04T15:00' })
  assert.deepEqual(replyRows(booked, 'Yes', '2026-11-02T13:00').map(r => r.kind), ['text_received', 'text_sent', 'confirmed'])
  const asked = { ...booked, reply: { text: 'Does it cover my mortgage?', at: '2026-11-02T13:40' } }
  assert.equal(replyRows(booked, asked.reply.text, asked.reply.at).at(-1).task, 'you')
  assert.equal(agentCallTask(asked), true)
  // P910: Your to-dos hold only calls to mark and the monthly check; the call task shows on the lead, not there.
  assert.equal(needsYouNow({ leads: [asked] }).length, 0)
  // Calling back closes the task.
  const called = closeCallTask(asked)
  assert.equal(agentCallTask(called), false)
  assert.equal(called.events.at(-1).by, 'You')
  // Stop opts them out.
  assert.equal(replyRows(booked, 'STOP', '2026-11-02T13:00').at(-1).label, 'Opted out. All calls and texts stopped')
})

test('P878: changing an outcome already marked stays on the record', () => {
  const l = mk('a', 'Ann', 'booked', { apptAt: '2026-11-02T11:00' })
  const sold = applyMove(l, 'sold')
  assert.equal(sold.events.at(-1).audit, undefined)
  const back = applyMove(sold, 'follow_up', { follow: 'Mon, Nov 9' })
  assert.equal(back.events.at(-1).audit, true)
  assert.match(back.events.at(-1).label, /^Changed from Sold to Follow up Mon, Nov 9$/)
})

test('P910 Your to-dos: only calls to mark (a booked call that passed, a live call left unmarked) and the check', () => {
  const leads = [
    mk('f', 'Follow', 'follow_up', { follow: 'Mon, Nov 2' }),
    mk('r', 'Reply', 'booked', { apptAt: '2026-11-04T15:00', reply: { text: 'Call me', at: '2026-11-02T13:50' } }),
    mk('d', 'Done', 'sold', { submitted: false }),
    mk('o', 'Ended', 'booked', { apptAt: '2026-11-02T13:00' }),
    mk('s', 'Starting', 'booked', { apptAt: '2026-11-02T14:00' }),
    mk('l', 'Live', 'ringing', { kind: 'live_call' }),
    mk('t', 'Today', 'showed', { kind: 'live_call', came: '2026-11-02T10:00' }),
    mk('y', 'Yesterday', 'showed', { kind: 'live_call', came: '2026-11-01T16:00' }),
    mk('m', 'Missed', 'missed', { kind: 'live_call' }),
    mk('n', 'NoShow', 'no_show', { apptAt: '2026-11-02T11:00' }),
  ]
  const checks = [{ draft: '2026-11-01', clients: [{ client_first_name: 'Gloria', client_last_name: 'Santos' }] }]
  const now = needsYouNow({ leads, checks }, SAMPLE_NOW)
  // P917: every live call still waiting for its result, ringing first, then newest.
  assert.deepEqual(now.map(n => [n.trigger, n.ref]), [['outcome', 'o'], ['live', 'l'], ['live', 't'], ['live', 'y'], ['check', '2026-11-01']])
  assert.deepEqual(TRIGGERS.map(t => t.action), ['Mark result', 'Mark result', 'Finish', 'Answer']) // P918: Finish submitting
  assert.equal(now[4].title, 'Still on the books?')
  // Empty: nothing to mark, no check.
  assert.deepEqual(needsYouNow({ leads: [leads[0], leads[1], leads[2], leads[4]] }, SAMPLE_NOW), [])
  // FYI: the team is on it.
  assert.deepEqual(forYourInfo({ leads }).map(f => f.title), ['Missed transfer', 'No show'])
  assert.deepEqual(forYourInfo({ leads: [mk('q', 'Q', 'rebooking')] }).map(f => f.title), ['Rebooking'])
})

test('a booked call becomes a to-do once 30 minutes have passed (P910: no "starting" item)', () => {
  const at = t => needsYouNow({ leads: [mk('a', 'A', 'booked', { apptAt: t })] }, SAMPLE_NOW).map(n => n.trigger)
  assert.deepEqual(at(addMin(SAMPLE_NOW, 15)), [])
  assert.deepEqual(at(addMin(SAMPLE_NOW, -29)), [])
  assert.deepEqual(at(addMin(SAMPLE_NOW, -30)), ['outcome'])
  assert.equal(needsOutcome(mk('b', 'B', 'showed'), SAMPLE_NOW), false)
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

test('the agent portal never says GoHighLevel, Meta, Google (bar Google Calendar), ads or budget to an agent', () => {
  // P878: every agent-side file (the VA screens in ful/ have their own rules).
  const files = readdirSync('src/template', { recursive: true }).map(f => f.replace(/\\/g, '/'))
    .filter(f => /\.jsx?$/.test(f) && !f.startsWith('ful/') && !f.endsWith('.test.js'))
  assert.ok(files.includes('client/Deedstone.jsx') && files.includes('Results.jsx') && files.includes('screens/Welcome.jsx'))
  // Brand names are matched with their capital (an HTML <meta> tag is not Meta); the rest in any case.
  const brands = /GoHighLevel|\bGHL\b|\bMeta\b|Google(?! Calendar)|Facebook/
  const words = /\bads?\b|\bbudget\b|within 5 minutes/i
  for (const f of files) {
    const src = readFileSync(`src/template/${f}`, 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n')
    const strings = src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}\n]+</g) || []
    for (const s of strings) { assert.doesNotMatch(s, brands, `${f}: ${s}`); assert.doesNotMatch(s, words, `${f}: ${s}`) }
  }
})
