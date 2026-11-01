// formatDual: the agent's time with the client's beside it.
// Run: node --test src/lib/timezones.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDual } from './timezones.js'

const AT = '2026-11-05T20:00:00Z' // 2:00 PM in Chicago, 1:00 PM in Denver, 3:00 PM in New York

test('formatDual: the same zone shows one time', () => {
  assert.equal(formatDual(AT, 'America/Chicago', 'America/Chicago'), '2:00 PM your time')
})

test('formatDual: different zones show both', () => {
  assert.equal(formatDual(AT, 'America/Chicago', 'America/Denver'), '2:00 PM your time / 1:00 PM client')
  assert.equal(formatDual(AT, 'America/Chicago', 'America/New_York'), '2:00 PM your time / 3:00 PM client')
})

test('formatDual: an unknown client zone shows one time', () => {
  for (const z of [null, undefined, '']) assert.equal(formatDual(AT, 'America/Chicago', z), '2:00 PM your time')
})

test('formatDual: a zone that reads the same clock collapses; no date gives nothing', () => {
  assert.equal(formatDual(AT, 'America/Chicago', 'America/Indiana/Knox'), '2:00 PM your time')
  assert.equal(formatDual(null, 'America/Chicago', 'America/Denver'), '')
  assert.equal(formatDual('nope', 'America/Chicago', 'America/Denver'), '')
})
