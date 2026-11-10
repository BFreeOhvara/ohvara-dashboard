import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_SUBMIT, missingFields, buildSubmission } from './template/submitModel.js'
import { briefLines, makeBrief, nextDraftWords, isReplacing } from './template/brief.js'
import { sampleState, bookAfterSale } from './template/ful/data.js'
import { stagesOf } from './lib/clientStages.js'
import { expected, deliveredRange, deliveredOf, deliveredWords } from './template/spendPlan.js'
import { countByStatus } from './template/agentView.js'
import { SAMPLE_CLIENTS } from './template/data/index.js'
import { readFileSync } from 'node:fs'

// P923 — Submit for servicing tells the VA everything before the first call; "Delivered this week" counts live calls.
const base = { ...EMPTY_SUBMIT, name: 'Ruth Ellison', phone: '5125550188', city: 'Austin', state: 'TX', carrier: 'Americo', draftDay: '3' }
const states = c => stagesOf(c).steps.map(s => s.state)

test('Submit: "Replacing an old policy?" must be answered; Yes needs the old carrier and draft date', () => {
  assert.deepEqual(missingFields(base, { policy: true }), ['replacing'])
  assert.deepEqual(missingFields({ ...base, replacing: false }, { policy: true }), [])
  assert.deepEqual(missingFields({ ...base, replacing: true, oldCarrier: 'Globe Life' }, { policy: true }), ['oldDraftDay'])
  const s = buildSubmission({ ...base, replacing: true, oldCarrier: 'Globe Life', oldPremium: '$54.20', oldDraftDay: '3', notes: ' Hard of hearing, call her daughter Amy first. ' }, 'agent', { policy: true })
  assert.deepEqual({ carrier: s.replaces.carrier, premium: s.replaces.premium, draftDay: s.replaces.draftDay }, { carrier: 'Globe Life', premium: 54.2, draftDay: 3 })
  assert.equal(s.notes, 'Hard of hearing, call her daughter Amy first.')
  assert.equal(buildSubmission({ ...base, replacing: false }, 'agent', { policy: true }).replaces, null)
})

test('the box words: replacement first, then the agent\'s note', () => {
  assert.equal(nextDraftWords(3, '2026-11-05'), 'Dec 3')
  assert.equal(nextDraftWords(8, '2026-11-05'), 'Nov 8')
  assert.equal(nextDraftWords(31, '2026-11-05'), 'Nov 30') // short months draft on their last day
  const b = briefLines(makeBrief({ replaces: { carrier: 'Globe Life', premium: 54.2, draftDay: 3 }, note: 'Call her daughter Amy first.', cancelBy: 'Dec 3' }))
  assert.equal(b.replace, 'Replacement: cancel the old Globe Life policy before Dec 3')
  assert.equal(b.detail, '$54.20 a month, drafts the 3rd')
  assert.equal(b.note, 'Call her daughter Amy first.')
  assert.equal(briefLines(makeBrief({ note: '  ' })).any, false, 'nothing to say, no box')
  assert.equal(briefLines(null, { oldCarrier: 'Colonial Penn', cancelBy: 'Nov 15' }).replace, 'Replacement: cancel the old Colonial Penn policy before Nov 15')
})

test('submit with a replacement: the cancel call books itself before the old draft, and the client carries the brief', () => {
  const out = bookAfterSale({ who: 'Amy Replacer', state: 'TX', city: 'Austin', carrier: 'Americo', window: 'Afternoon', replaces: { carrier: 'Globe Life', premium: 54.2, draftDay: 20 }, note: 'Wants the draft moved to the 3rd.' })
  assert.ok(out.handoff && out.cancel, 'hand-off and cancel booked')
  assert.ok(out.cancel.beforeDraft && out.cancel.iso > out.handoff.iso)
  assert.equal(out.cancel.by, 'Nov 20')
  const c = sampleState().clients.find(x => `${x.client_first_name} ${x.client_last_name}` === 'Amy Replacer')
  assert.equal(c.brief.replaces.cancel_by, 'Nov 20')
  assert.equal(c.brief.note, 'Wants the draft moved to the 3rd.')
  assert.ok(isReplacing(c))
  assert.equal(states(c)[3], 'upcoming', '"Old policy cancelled" is a real step')
})

test('submit without a replacement: no cancel call, "Old policy cancelled" is n/a', () => {
  const out = bookAfterSale({ who: 'Ned Noreplace', state: 'TX', city: 'Austin', carrier: 'Americo', window: 'Morning', replaces: null, note: null })
  assert.ok(out.handoff)
  assert.equal(out.cancel, null)
  const c = sampleState().clients.find(x => `${x.client_first_name} ${x.client_last_name}` === 'Ned Noreplace')
  assert.equal(c.brief.replaces, null)
  assert.equal(states(c)[3], 'skipped')
})

test('the sample: a hand-off call with a replacement and a note; agent clients show the step only for a replacement', () => {
  const s = sampleState()
  const ho = s.tasks.find(t => t.id === 'ho-1')
  const paul = s.clients.find(c => c.id === ho.client_id)
  const b = briefLines(paul.brief)
  assert.equal(b.replace, 'Replacement: cancel the old Globe Life policy before Dec 3')
  assert.match(b.note, /daughter Amy/)
  const by = id => SAMPLE_CLIENTS.find(c => c.id === id)
  assert.equal(states(by('sample-client-3'))[3], 'skipped')
  assert.equal(states(by('sample-client-4'))[3], 'current')
})

test('Delivered this week = booked + live calls that reached the agent; the range adds the live calls', () => {
  const d = deliveredOf({ booked: 8, live: 4 })
  assert.equal(deliveredWords(d), '12 delivered · 8 booked · 4 live calls')
  const ex = expected({ daily: 100 }, 'both')
  const r = deliveredRange(ex)
  assert.equal(r.low, ex.appts.booked.low + ex.live.delivered.low)
  assert.equal(r.high, ex.appts.booked.high + ex.live.delivered.high)
  // appointments only: no live calls in the range
  const ap = expected({ daily: 100 }, 'appts')
  assert.equal(deliveredRange(ap).high, ap.appts.booked.high + ap.live.delivered.high)
  // Leads the team is still trying aren't on the agent's board (countByStatus keeps them apart as `team`).
  const by = countByStatus([{ stage: 'calling' }, { stage: 'booked' }])
  assert.equal(by.booked, 1)
  const src = readFileSync(new URL('./template/screens/Overview.jsx', import.meta.url), 'utf8')
  assert.match(src, /title="Delivered this week"/)
  assert.doesNotMatch(src, /title="Booked this week"/)
})
