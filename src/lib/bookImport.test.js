import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRows, checkRows, checkRow, spreadWelcomes, isoDate, normPolicy, TEMPLATE_CSV, fieldOfHeader, NEEDED } from './bookImport.js'

const book = [{ policy_number: 'AM-2209184', client_phone: '(305) 555-0156' }]

test('the template reads back as one good row', () => {
  const { rows, ignored, error } = parseRows(TEMPLATE_CSV)
  assert.equal(error, null)
  assert.deepEqual(ignored, [])
  assert.equal(rows.length, 1)
  const { checked } = checkRows(rows, book)
  assert.equal(checked[0].status, 'ok')
  assert.equal(checked[0].row.phone, '+15125550199')
  assert.equal(checked[0].row.face_amount, 250000)
  assert.equal(checked[0].row.draft_day, 3)
  assert.equal(checked[0].row.effective_date, '2025-06-01')
})

test('good, missing and duplicate rows are each flagged', () => {
  const csv = [
    'Name,Phone,State,Carrier,Policy #,Premium,Effective',
    'Ana Ruiz,512-555-0101,tx,Americo,AM-1,$61.50,6/1/2025',
    'Bo Lee,,TX,Americo,AM-2,40,',
    'Cy Day,512 555 0103,TX,Americo,am 2209184,40,',
    'Di Fox,(305) 555-0156,FL,Foresters,FF-9,40,',
    'Ed Moe,512-555-0105,TX,Americo,AM-1,40,',
    'Flo Ng,512-555-0101,TX,Americo,AM-6,40,',
    'Gus Oh,512-555-0107,ZZ,Americo,AM-7,abc,13/40/2025',
  ].join('\n')
  const { rows } = parseRows(csv)
  const r = checkRows(rows, book)
  const st = r.checked.map(c => c.status)
  assert.deepEqual(st, ['ok', 'missing', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'missing'])
  assert.equal(r.checked[0].row.first_name, 'Ana')
  assert.equal(r.checked[0].row.state, 'TX')
  assert.equal(r.checked[0].row.monthly_premium, 61.5)
  assert.equal(r.checked[0].row.time_zone, null) // TX is split: the VA confirms the zone on the welcome call
  assert.equal(checkRow({ state: 'GA' }).row.time_zone, 'America/New_York')
  assert.deepEqual(r.checked[1].missing, ['Phone'])
  assert.match(r.checked[2].dup, /policy number is already on your book/)
  assert.match(r.checked[3].dup, /phone as a client on your book/)
  assert.match(r.checked[4].dup, /policy number as a row above/)
  assert.match(r.checked[5].dup, /phone as a row above/)
  assert.ok(r.checked[6].odd.length >= 3)
  assert.equal(r.ok, 1)
  assert.equal(r.missing, 2)
  assert.equal(r.duplicate, 4)
})

test('a paste from a sheet (tabs) and quoted cells read', () => {
  const { rows } = parseRows('First\tLast\tPhone\tState\tCarrier\tPolicy number\nJo\tKim\t5125550111\tTX\tAmerico\tAM-11')
  assert.equal(checkRows(rows).checked[0].status, 'ok')
  const q = parseRows('First name,Last name,Notes\n"Al","Bo","Likes calls, after 6"')
  assert.equal(q.rows[0].notes, 'Likes calls, after 6')
})

test('headers that mean nothing are refused, unknown ones listed', () => {
  assert.ok(parseRows('a,b\n1,2').error)
  assert.deepEqual(parseRows('First,Favourite colour\nA,red').ignored, ['Favourite colour'])
  assert.equal(fieldOfHeader('Policy No.'), 'policy_number')
})

test('policy numbers and dates normalise like the server', () => {
  assert.equal(normPolicy(' am-22 09184 '), 'AM2209184')
  assert.equal(isoDate('2/30/2025'), null)
  assert.equal(isoDate('06-01-25'), '2025-06-01')
})

test('a one-client form row with everything needed is ok', () => {
  const c = checkRow({ first_name: 'Ivy', last_name: 'Tran', phone: '(214) 555-0123', state: 'TX', carrier: 'Americo', policy_number: 'AM-77' })
  assert.equal(c.status, 'ok')
  assert.deepEqual(NEEDED, ['first_name', 'last_name', 'phone', 'state', 'carrier', 'policy_number'])
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
