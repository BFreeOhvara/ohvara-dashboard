/**
 * Node unit test for the indeed-scraper pure parsing logic.
 * Run: node --test supabase/functions/indeed-scraper/parse.test.ts
 * (Node >=23.6 strips the TS types automatically.)
 *
 * Verifies the parse + lead-row shaping that feeds the Places join — the
 * half of the pipeline that can be exercised without INDEED_MCP_TOKEN.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMcpText } from './parse.ts'

// Realistic MCP search_jobs markdown: 2 valid Profile-A postings, 1 with a
// disallowed title (Welder), 1 in a non-Profile-A niche (law firm).
const FIXTURE = `
**Job Title:** Front Desk Receptionist
**Company:** Cool Breeze HVAC
**Location:** Dallas, TX
**Compensation:** $18 - $22 an hour
**View Job URL:** https://indeed.com/viewjob?jk=abc123
**Description:** Busy HVAC office seeking a front desk receptionist to
answer incoming calls, schedule service appointments, and greet customers.
Must be reliable and friendly.

**Job Title:** Dispatcher
**Company:** Rapid Tow & Recovery
**Location:** Houston, TX
**Compensation:** $45,000 a year
**View Job URL:** https://indeed.com/viewjob?jk=def456
**Description:** Receive and respond to incoming calls from drivers needing towing; dispatch trucks promptly.

**Job Title:** Welder
**Company:** Steel Works LLC
**Location:** Dallas, TX
**Compensation:** $25 an hour
**View Job URL:** https://indeed.com/viewjob?jk=ghi789
**Description:** MIG/TIG welding fabrication work.

**Job Title:** Receptionist
**Company:** Smith & Jones Law Firm
**Location:** Austin, TX
**Compensation:** $20 an hour
**View Job URL:** https://indeed.com/viewjob?jk=jkl000
**Description:** Greet clients at a busy law office.
`

test('keeps only allowed-title + Profile-A-niche postings', () => {
  const out = parseMcpText(FIXTURE, new Set(), new Set())
  // Welder (disallowed title) and law-firm Receptionist (non-Profile-A) drop.
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(j => j.niche), ['hvac', 'towing'])
})

test('captures posting_title, posting_snippet, source_url + lead-ready fields', () => {
  const [hvac] = parseMcpText(FIXTURE, new Set(), new Set())
  assert.equal(hvac.business_name, 'Cool Breeze HVAC')
  assert.equal(hvac.posting_title, 'Front Desk Receptionist')
  assert.match(hvac.job_title, /Receptionist/)
  assert.equal(hvac.source_url, 'https://indeed.com/viewjob?jk=abc123')
  // multi-line description collapsed to a single-line snippet
  assert.ok(hvac.posting_snippet?.startsWith('Busy HVAC office seeking'))
  assert.ok(!hvac.posting_snippet?.includes('\n'))
  // lead-ready scaffolding
  assert.equal(hvac.source, 'indeed')
  assert.equal(hvac.status, 'New')
  assert.equal(hvac.monthly_labor_cost, 3200) // avg($18,$22)=20 * 160h
  // phone/place_id are filled later by the server-side Places join
  assert.equal(hvac.phone, null)
  assert.equal(hvac.place_id, null)
})

test('annual salary converts to a monthly labor cost', () => {
  const tow = parseMcpText(FIXTURE, new Set(), new Set())[1]
  assert.equal(tow.business_name, 'Rapid Tow & Recovery')
  assert.ok(typeof tow.monthly_labor_cost === 'number' && tow.monthly_labor_cost > 0)
})

test('dedup flags businesses already in the leads table', () => {
  const existingKeys = new Set(['cool breeze hvac|dallas'])
  const out = parseMcpText(FIXTURE, existingKeys, new Set())
  assert.equal(out[0].already_in_db, true)  // Cool Breeze HVAC / Dallas
  assert.equal(out[1].already_in_db, false) // Rapid Tow / Houston
})
