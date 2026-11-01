// Client search by policy number (matchClients in agentBookings.js).
//   node --test src/lib/agentBookings.test.js
// Pure functions only (no network, no React).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { policyNumberMatches, matchClients } from './agentBookings.js'

const ROWS = [
  { id: 'p-1', client_first_name: 'Zed', client_last_name: 'Brown', current_carrier: 'Aetna', client_city: 'Tampa', client_phone: '(850) 555-0199', policy_number: 'ABC-123 45' },
  { id: 'p-2', client_first_name: 'Maria', client_last_name: 'Alvarez', current_carrier: 'Humana', client_city: 'Miami', client_phone: '+18505550123', policy_number: 'XYZ987' },
  { id: 'p-3', client_first_name: 'Carl', client_last_name: 'Young', current_carrier: 'Cigna', client_city: 'Ocala', client_phone: '+13525550111', policy_number: null },
]
const ids = rows => rows.map(p => p.id)

test('policyNumberMatches: ignores case, spaces and dashes', () => {
  assert.equal(policyNumberMatches('ABC-123 45', 'abc12345'), true)
  assert.equal(policyNumberMatches('ABC-123 45', '123-4'), true)
  assert.equal(policyNumberMatches('ABC-123 45', 'abc999'), false)
})

test('policyNumberMatches: a 1-2 character query matches nothing', () => {
  assert.equal(policyNumberMatches('ABC-123 45', 'a'), false)
  assert.equal(policyNumberMatches('ABC-123 45', 'ab'), false)
  assert.equal(policyNumberMatches('ABC-123 45', '- -'), false)
})

test('policyNumberMatches: an empty or null policy number never matches', () => {
  assert.equal(policyNumberMatches(null, 'abc'), false)
  assert.equal(policyNumberMatches(undefined, 'abc'), false)
  assert.equal(policyNumberMatches('', 'abc'), false)
  assert.equal(policyNumberMatches('---', '---'), false)
})

test('matchClients: finds a row by policy number', () => {
  assert.deepEqual(ids(matchClients(ROWS, 'abc12345')), ['p-1'])
  assert.deepEqual(ids(matchClients(ROWS, 'xyz-987')), ['p-2'])
  assert.deepEqual(matchClients(ROWS, 'zz'), [])
})

test('matchClients: still finds by name, carrier and 3+ phone digits', () => {
  assert.deepEqual(ids(matchClients(ROWS, 'alvarez')), ['p-2'])
  assert.deepEqual(ids(matchClients(ROWS, 'cigna')), ['p-3'])
  assert.deepEqual(ids(matchClients(ROWS, '(850) 555-01')), ['p-2', 'p-1'])
  assert.deepEqual(matchClients(ROWS, '99'), [])
  assert.deepEqual(matchClients(ROWS, ''), [])
})

test('matchClients: results stay sorted by name', () => {
  assert.deepEqual(ids(matchClients(ROWS, '555')), ['p-3', 'p-2', 'p-1'])
})

test('matchClients checks p.policy_number', () => {
  const src = readFileSync(new URL('./agentBookings.js', import.meta.url), 'utf8')
  assert.match(src, /p\.policy_number/)
})
