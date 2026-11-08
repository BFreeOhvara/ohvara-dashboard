import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRows, checkRows, checkRow, spreadWelcomes, isoDate, normPolicy, TEMPLATE_CSV, fieldOfHeader, NEEDED } from './bookImport.js'

const book = [{ client_phone: '(305) 555-0156' }]

// P899: the fields are name, phone, city, state, carrier and draft day (premium and notes optional). Policy number,
// email, face amount, product and dates aren't read; duplicates are the same phone.
test('the template reads back as one good row', () => {
  const { rows, ignored, error } = parseRows(TEMPLATE_CSV)
  assert.equal(error, null)
  assert.deepEqual(ignored, [])
  assert.equal(rows.length, 1)
  const { checked } = checkRows(rows, book)
  assert.equal(checked[0].status, 'ok')
  assert.equal(checked[0].row.phone, '+15125550199')
  assert.equal(checked[0].row.city, 'Austin')
  assert.equal(checked[0].row.draft_day, 3)
  assert.equal(checked[0].row.monthly_premium, 84.2)
  assert.equal('policy_number' in checked[0].row, false)
})

test('good, missing and duplicate rows are each flagged', () => {
  const csv = [
    'Name,Phone,City,State,Carrier,Draft day,Premium,Policy #',
    'Ana Ruiz,512-555-0101,Austin,tx,Americo,3,$61.50,AM-1',
    'Bo Lee,,Austin,TX,Americo,3,40,',
    'Di Fox,(305) 555-0156,Miami,FL,Foresters,9,40,',
    'Flo Ng,512-555-0101,Austin,TX,Americo,3,40,',
    'Gus Oh,512-555-0107,Austin,ZZ,Americo,45,abc,',
    'Hal Ito,512-555-0108,,TX,Americo,,,',
  ].join('\n')
  const { rows, ignored } = parseRows(csv)
  assert.deepEqual(ignored, ['Policy #'])
  const r = checkRows(rows, book)
  assert.deepEqual(r.checked.map(c => c.status), ['ok', 'missing', 'duplicate', 'duplicate', 'missing', 'missing'])
  assert.equal(r.checked[0].row.first_name, 'Ana')
  assert.equal(r.checked[0].row.state, 'TX')
  assert.equal(r.checked[0].row.monthly_premium, 61.5)
  assert.equal(r.checked[0].row.time_zone, null) // TX is split: the VA confirms the zone on the welcome call
  assert.equal(checkRow({ state: 'GA' }).row.time_zone, 'America/New_York')
  assert.deepEqual(r.checked[1].missing, ['Phone'])
  assert.match(r.checked[2].dup, /phone as a client on your book/)
  assert.match(r.checked[3].dup, /phone as a row above/)
  assert.ok(r.checked[4].odd.length >= 3)
  assert.deepEqual(r.checked[5].missing, ['City', 'Draft day'])
  assert.equal(r.ok, 1)
  assert.equal(r.missing, 3)
  assert.equal(r.duplicate, 2)
})

test('a paste from a sheet (tabs) and quoted cells read', () => {
  const { rows } = parseRows('First\tLast\tPhone\tCity\tState\tCarrier\tDraft day\nJo\tKim\t5125550111\tAustin\tTX\tAmerico\t12')
  assert.equal(checkRows(rows).checked[0].status, 'ok')
  const q = parseRows('First name,Last name,Notes\n"Al","Bo","Likes calls, after 6"')
  assert.equal(q.rows[0].notes, 'Likes calls, after 6')
})

test('headers that mean nothing are refused, unknown ones listed', () => {
  assert.ok(parseRows('a,b\n1,2').error)
  assert.deepEqual(parseRows('First,Favourite colour\nA,red').ignored, ['Favourite colour'])
  assert.equal(fieldOfHeader('Policy No.'), null) // P899: no longer read
  assert.equal(fieldOfHeader('Draft date'), 'draft_day')
})

test('policy numbers and dates normalise like the server', () => {
  assert.equal(normPolicy(' am-22 09184 '), 'AM2209184')
  assert.equal(isoDate('2/30/2025'), null)
  assert.equal(isoDate('06-01-25'), '2025-06-01')
})

test('a one-client form row with everything needed is ok', () => {
  const c = checkRow({ first_name: 'Ivy', last_name: 'Tran', phone: '(214) 555-0123', city: 'Dallas', state: 'TX', carrier: 'Americo', draft_day: '3' })
  assert.equal(c.status, 'ok')
  assert.deepEqual(NEEDED, ['first_name', 'last_name', 'phone', 'city', 'state', 'carrier', 'draft_day'])
})

test('welcome calls spread over days, counting the ones waiting', () => {
  assert.deepEqual(spreadWelcomes(5, 2), [0, 0, 1, 1, 2])
  assert.deepEqual(spreadWelcomes(3, 2, [2, 1]), [1, 2, 2])
  assert.deepEqual(spreadWelcomes(2, 0), [0, 1])
})

test('draft days read as ordinals', async () => {
  const { ordinal } = await import('./bookImport.js')
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st'])
})
