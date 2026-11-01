// Settings → Client contact: working hours, live-transfer phone, on-duty default.
//   node --test src/lib/agentSettings.test.js
// Pure rules and a mocked supabase client only: no network, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isSettingsNotReady, WEEKDAYS, weekFromRows, rowsFromWeek, setDay, validateWeek, weekChanged,
  timeLabel, timeOptions, normalizePhone, hoursPayload, phonePayload, defaultPayload, assertOneKey,
  normalizeSettings, readMyAgentSettings, saveMyAgentSettings, saveErrorText, zoneLabel,
} from './agentSettings.js'

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

function mockDb({ data = {}, error = null } = {}) {
  const calls = []
  return { calls, rpc: async (fn, args) => { calls.push({ fn, args }); return { data, error } } }
}

test('weekdays are ISO: Monday is 1 and Sunday is 7, never 0', () => {
  assert.deepEqual(WEEKDAYS.map(d => d.weekday), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(WEEKDAYS[0].short, 'Mon')
  assert.equal(WEEKDAYS[6].short, 'Sun')
})

test('a new agent has no rows, so all seven days are closed and nothing is sent', () => {
  const week = weekFromRows([])
  assert.equal(week.length, 7)
  assert.ok(week.every(d => d.open === false))
  assert.deepEqual(hoursPayload(week), { working_hours: [] })
  assert.equal(weekFromRows(undefined).length, 7)
  assert.equal(weekFromRows(null).every(d => !d.open), true)
})

test('Sunday saves as weekday 7', () => {
  let week = weekFromRows([])
  week = setDay(week, 7, { open: true })
  assert.deepEqual(hoursPayload(week), { working_hours: [{ weekday: 7, start: '09:00', end: '17:00' }] })
})

test('rows round-trip: open days come back as rows, a missing row stays closed', () => {
  const rows = [{ weekday: 1, start: '09:00', end: '17:00' }, { weekday: 5, start: '08:30', end: '12:00' }]
  const week = weekFromRows(rows)
  assert.deepEqual(week.filter(d => d.open).map(d => d.weekday), [1, 5])
  assert.equal(week[1].open, false)
  assert.deepEqual(rowsFromWeek(week), rows)
})

test('rows with a bad weekday or time are dropped, not guessed at', () => {
  const week = weekFromRows([{ weekday: 0, start: '09:00', end: '17:00' }, { weekday: 8, start: '09:00', end: '17:00' },
    { weekday: 2, start: '9am', end: '17:00' }, { weekday: 3, start: '24:00', end: '24:00' }])
  assert.ok(week.every(d => !d.open))
})

test('a stored end of 24:00 survives a re-save, and editing another day leaves it alone', () => {
  const week = weekFromRows([{ weekday: 6, start: '18:00', end: '24:00' }])
  assert.equal(week[5].end, '24:00')
  assert.deepEqual(hoursPayload(week).working_hours, [{ weekday: 6, start: '18:00', end: '24:00' }])
  const edited = setDay(week, 1, { open: true, start: '10:00' })
  assert.deepEqual(hoursPayload(edited).working_hours, [
    { weekday: 1, start: '10:00', end: '17:00' },
    { weekday: 6, start: '18:00', end: '24:00' },
  ])
  assert.equal(validateWeek(week), '')
  assert.equal(timeLabel('24:00'), 'Midnight')
  assert.ok(timeOptions('end', '24:00').some(o => o.value === '24:00' && o.label === 'Midnight'))
  assert.ok(!timeOptions('start', '09:00').some(o => o.value === '24:00'), 'a start can not be 24:00')
})

test('a stored time off the half-hour grid stays in the list', () => {
  const opts = timeOptions('start', '09:15')
  assert.ok(opts.some(o => o.value === '09:15' && o.label === '9:15 AM'))
  const values = opts.map(o => o.value)
  assert.deepEqual(values, [...values].sort())
})

test('an end at or before the start is refused; overnight is not allowed', () => {
  const open = (start, end) => setDay(weekFromRows([]), 2, { open: true, start, end })
  assert.match(validateWeek(open('17:00', '09:00')), /Tuesday must end after it starts/)
  assert.match(validateWeek(open('09:00', '09:00')), /must end after/)
  assert.match(validateWeek(open('22:00', '02:00')), /Overnight/)
  assert.equal(validateWeek(open('09:00', '09:30')), '')
  assert.equal(validateWeek(open('00:00', '24:00')), '')
  assert.match(validateWeek(open('', '17:00')), /needs a start and an end/)
  assert.equal(validateWeek(setDay(weekFromRows([]), 2, { open: false, start: '17:00', end: '09:00' })), '', 'a closed day is not checked')
})

test('weekChanged ignores closed days and sees real edits', () => {
  const a = weekFromRows([{ weekday: 1, start: '09:00', end: '17:00' }])
  assert.equal(weekChanged(a, setDay(a, 3, { start: '10:00' })), false)
  assert.equal(weekChanged(a, setDay(a, 1, { end: '18:00' })), true)
  assert.equal(weekChanged(a, setDay(a, 3, { open: true })), true)
})

test('times read like 9:00 AM', () => {
  assert.equal(timeLabel('00:00'), '12:00 AM')
  assert.equal(timeLabel('09:00'), '9:00 AM')
  assert.equal(timeLabel('12:30'), '12:30 PM')
  assert.equal(timeLabel('17:00'), '5:00 PM')
  assert.equal(timeLabel('23:30'), '11:30 PM')
})

test('phone: US numbers become +1XXXXXXXXXX, junk is rejected, empty clears', () => {
  assert.deepEqual(normalizePhone('(555) 010-0142'), { value: '+15550100142', error: '' })
  assert.deepEqual(normalizePhone('(512) 555-0142'), { value: '+15125550142', error: '' })
  assert.deepEqual(normalizePhone('512-555-0142'), { value: '+15125550142', error: '' })
  assert.deepEqual(normalizePhone('1 512 555 0142'), { value: '+15125550142', error: '' })
  assert.deepEqual(normalizePhone('+15125550142'), { value: '+15125550142', error: '' })
  assert.deepEqual(normalizePhone('+44 20 7946 0958'), { value: '+442079460958', error: '' })
  assert.deepEqual(normalizePhone('   '), { value: null, error: '' })
  assert.deepEqual(normalizePhone(null), { value: null, error: '' })
  for (const bad of ['12345', '512555014', '5125550142999', 'call me', '+0123456789', '+123', '(112) 555-0142']) {
    const r = normalizePhone(bad)
    assert.equal(r.value, null, bad)
    assert.ok(r.error, bad)
  }
})

test('each save payload has exactly one key', () => {
  const week = weekFromRows([{ weekday: 1, start: '09:00', end: '17:00' }])
  assert.deepEqual(Object.keys(hoursPayload(week)), ['working_hours'])
  assert.deepEqual(Object.keys(phonePayload('+15125550142')), ['live_transfer_phone'])
  assert.deepEqual(Object.keys(defaultPayload(true)), ['on_duty_default'])
  assert.deepEqual(phonePayload(null), { live_transfer_phone: null }, 'null clears')
  assert.deepEqual(phonePayload(undefined), { live_transfer_phone: null })
  assert.deepEqual(defaultPayload(false), { on_duty_default: false })
  assert.deepEqual(hoursPayload(weekFromRows([])), { working_hours: [] }, 'an empty week still sends the key, which closes every day')
  for (const p of [hoursPayload(week), phonePayload(null), defaultPayload(true)]) assert.doesNotThrow(() => assertOneKey(p))
  for (const p of [{}, null, { working_hours: [], on_duty_default: true }, { timezone: 'America/Chicago' }, { notifications: [] }]) {
    assert.throws(() => assertOneKey(p), /exactly one/)
  }
})

test('saving calls save_my_agent_settings with one key and returns the shaped answer', async () => {
  const db = mockDb({ data: { timezone: 'America/Chicago', working_hours: [{ weekday: 7, start: '10:00', end: '24:00' }], live_transfer_phone: '+15125550142', on_duty_default: true, notifications: [] } })
  const out = await saveMyAgentSettings(db, hoursPayload(setDay(weekFromRows([]), 7, { open: true, start: '10:00', end: '24:00' })))
  assert.deepEqual(db.calls, [{ fn: 'save_my_agent_settings', args: { p: { working_hours: [{ weekday: 7, start: '10:00', end: '24:00' }] } } }])
  assert.equal(out.week[6].open, true)
  assert.equal(out.week[6].end, '24:00')
  assert.equal(out.phone, '+15125550142')
  assert.equal(out.dutyDefault, true)
  await assert.rejects(() => saveMyAgentSettings(db, { working_hours: [], live_transfer_phone: null }), /exactly one/)
  assert.equal(db.calls.length, 1, 'a two-key save never reaches the server')
})

test('reading calls my_agent_settings and throws what the server says', async () => {
  const db = mockDb({ data: { timezone: 'America/Denver', working_hours: [], live_transfer_phone: null, on_duty_default: false } })
  const s = await readMyAgentSettings(db)
  assert.deepEqual(db.calls, [{ fn: 'my_agent_settings', args: undefined }])
  assert.equal(s.timezone, 'America/Denver')
  assert.equal(s.phone, null)
  assert.equal(s.dutyDefault, false)
  assert.ok(s.week.every(d => !d.open))
  const err = { code: '42501', message: 'Only an active agent has these settings' }
  await assert.rejects(() => readMyAgentSettings(mockDb({ error: err })), e => e === err)
})

test('normalizeSettings copes with an empty or odd answer', () => {
  const s = normalizeSettings(null)
  assert.equal(s.phone, null)
  assert.equal(s.dutyDefault, false)
  assert.equal(s.week.length, 7)
  assert.equal(normalizeSettings({ live_transfer_phone: '' }).phone, null)
  assert.equal(normalizeSettings({ on_duty_default: 'yes' }).dutyDefault, false)
})

test('not-ready codes: PGRST202, 42883, PGRST205 and 42P01 mean Coming soon', () => {
  for (const code of ['PGRST202', '42883', 'PGRST205', '42P01']) assert.equal(isSettingsNotReady({ code }), true, code)
  assert.equal(isSettingsNotReady({ code: '42501' }), false, 'a refusal is an error, not Coming soon')
  assert.equal(isSettingsNotReady({ code: '22023' }), false)
  assert.equal(isSettingsNotReady(null), false)
  assert.equal(isSettingsNotReady({ message: 'Could not find the function public.my_agent_settings in the schema cache' }), true)
})

test("a refused save shows the server's own words", () => {
  assert.equal(saveErrorText({ code: '42501', message: 'Choose a plan to unlock your portal.' }), 'Choose a plan to unlock your portal.')
  assert.equal(saveErrorText({ code: '22023', message: 'Phone must look like +15125551234' }), 'Phone must look like +15125551234')
  assert.equal(saveErrorText({ code: '08006', message: 'connection reset by peer' }), "Couldn't save that. Try again.")
  assert.equal(saveErrorText(new Error('x')), "Couldn't save that. Try again.")
})

test('zone labels', () => {
  assert.equal(zoneLabel('America/Chicago'), 'Central time')
  assert.equal(zoneLabel('Europe/Berlin'), 'Europe/Berlin')
  assert.equal(zoneLabel('America/Port_of_Spain'), 'America/Port of Spain')
  assert.equal(zoneLabel(''), 'your time zone')
})

test('the files never write agent_duty and use no hex colours', () => {
  for (const f of ['./agentSettings.js', '../hooks/useAgentSettings.js', '../components/settings/AgentAvailabilityCards.jsx']) {
    let text
    try { text = src(f) } catch { continue }
    assert.doesNotMatch(text, /agent_duty/, `${f} touches agent_duty`)
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, `${f} has a hex colour`)
  }
})
