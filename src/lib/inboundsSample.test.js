// sampleLead: the detail page's dev-only lookup in the sample leads.
//   node --test src/lib/inboundsSample.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSample, sampleLead } from './inboundsSample.js'

const sample = buildSample(Date.UTC(2026, 10, 2, 12))

test('finds a sample lead and its events', () => {
  const { lead, events } = sampleLead(sample, 'sample-inb-01')
  assert.equal(lead.lead_id, 'sample-inb-01')
  assert.ok(Array.isArray(events))
})

test('returns the timeline rows of a lead that has them', () => {
  const { lead, events } = sampleLead(sample, 'sample-inb-02')
  assert.equal(lead.lead_id, 'sample-inb-02')
  assert.ok(events.length > 0)
})

test('gives no lead for an unknown id', () => {
  assert.deepEqual(sampleLead(sample, 'not-real'), { lead: null, events: [] })
  assert.equal(sampleLead(null, 'sample-inb-01').lead, null)
})
