// VA shifts (Prompt 851): the lib the useVaShifts hooks run.
//   node --test src/lib/vaShifts.test.js
// Mocked supabase only: no network, no React.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isShiftsMissing, SHIFTS_NOT_READY, companyDay, addDays, weekStart, dayName, shiftText,
  readShiftsToday, readShiftWeek, requestDayOff, cancelDayOff, decideDayOff, saveShift, removeShift,
  readDayOffRequests, toShiftView, monthDay, dateLabel, rangeText, toAdminRota, toDayOffRows,
} from './vaShifts.js'

const MISSING = { code: 'PGRST202', message: 'Could not find the function public.va_shift_week' }
const src = p => readFileSync(new URL(p, import.meta.url), 'utf8')

function mockDb({ data = [], error = null } = {}) {
  const calls = []
  const chain = table => {
    const q = {
      upsert(row, opts) { calls.push(['upsert', table, row, opts]); return q },
      delete() { calls.push(['delete', table]); return q },
      select(cols) { calls.push(['select', table, cols]); return q },
      eq(c, v) { calls.push(['eq', c, v]); return q },
      gte(c, v) { calls.push(['gte', c, v]); return q },
      order(c, o) { calls.push(['order', c, o]); return q },
      single() { return Promise.resolve({ data, error }) },
      then(res, rej) { return Promise.resolve({ data, error }).then(res, rej) },
    }
    return q
  }
  return {
    calls,
    rpc(fn, args) { calls.push(['rpc', fn, args]); return Promise.resolve({ data, error }) },
    from(t) { calls.push(['from', t]); return chain(t) },
  }
}

test('dates: company day, weeks start Monday, day names', () => {
  // 2026-11-06 03:00 UTC is still Nov 5 in Central.
  assert.equal(companyDay(new Date('2026-11-06T03:00:00Z')), '2026-11-05')
  assert.equal(weekStart('2026-11-05'), '2026-11-02')
  assert.equal(weekStart('2026-11-02'), '2026-11-02')
  assert.equal(weekStart('2026-11-08'), '2026-11-02')
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(dayName('2026-11-05'), 'Thu')
})

test('shift hours read in the shift zone', () => {
  assert.equal(shiftText('2026-11-05T14:00:00Z', '2026-11-06T00:00:00Z'), '8:00 AM to 6:00 PM')
})

test('reads go to the 231 functions and fall back to null while it is missing', async () => {
  const db = mockDb({ data: [{ va_id: 'x' }] })
  assert.deepEqual(await readShiftsToday(db), [{ va_id: 'x' }])
  assert.deepEqual(db.calls[0], ['rpc', 'va_shifts_today', {}])
  await readShiftWeek(db, { from: '2026-11-02', days: 14, va: 'v1' })
  assert.deepEqual(db.calls[1], ['rpc', 'va_shift_week', { p_days: 14, p_from: '2026-11-02', p_va: 'v1' }])
  assert.equal(await readShiftsToday(mockDb({ error: MISSING })), null)
  assert.equal(await readShiftWeek(mockDb({ error: MISSING })), null)
  assert.equal(await readDayOffRequests(mockDb({ error: { code: 'PGRST205' } }), '2026-11-05'), null)
  assert.ok(isShiftsMissing({ code: '42883' }))
  assert.ok(!isShiftsMissing({ code: '42501' }))
  await assert.rejects(readShiftWeek(mockDb({ error: { code: '42501', message: 'no' } })), { code: '42501' })
})

test('writes send the right arguments and say "not switched on" while 231 is missing', async () => {
  const db = mockDb({ data: 'id-1' })
  await requestDayOff(db, '2026-11-10', '  Dentist  ')
  await requestDayOff(db, '2026-11-11', '   ')
  await cancelDayOff(db, '2026-11-10')
  await decideDayOff(db, 'r1', 1)
  assert.deepEqual(db.calls.map(c => c.slice(1)), [
    ['va_request_day_off', { p_day: '2026-11-10', p_reason: 'Dentist' }],
    ['va_request_day_off', { p_day: '2026-11-11', p_reason: null }],
    ['va_cancel_day_off', { p_day: '2026-11-10' }],
    ['va_decide_day_off', { p_request: 'r1', p_approve: true }],
  ])
  await assert.rejects(requestDayOff(mockDb({ error: MISSING }), '2026-11-10'), new RegExp(SHIFTS_NOT_READY))
  await assert.rejects(saveShift(mockDb({ error: { code: '42P01' } }), { vaId: 'v', day: '2026-11-10' }), new RegExp(SHIFTS_NOT_READY))
})

test('admin rota writes: upsert one shift per VA per day, delete by VA and day', async () => {
  const db = mockDb({ data: { id: 's1' } })
  await saveShift(db, { vaId: 'v1', day: '2026-11-10' })
  assert.deepEqual(db.calls[1], ['upsert', 'va_shifts',
    { va_id: 'v1', shift_date: '2026-11-10', starts: '08:00', ends: '18:00', tz: 'America/Chicago' },
    { onConflict: 'va_id,shift_date' }])
  const d = mockDb()
  await removeShift(d, { vaId: 'v1', day: '2026-11-10' })
  assert.deepEqual(d.calls.slice(1), [['delete', 'va_shifts'], ['eq', 'va_id', 'v1'], ['eq', 'shift_date', '2026-11-10']])
})

test('day-off requests: soonest first, pending before decided', async () => {
  const rows = [
    { id: 'b', off_date: '2026-11-12', status: 'approved' },
    { id: 'a', off_date: '2026-11-10', status: 'declined' },
    { id: 'c', off_date: '2026-11-12', status: 'pending' },
  ]
  const out = await readDayOffRequests(mockDb({ data: rows }), '2026-11-05')
  assert.deepEqual(out.map(r => r.id), ['a', 'c', 'b'])
})

// Two weeks from Mon Nov 2. Me (Maya) on Nov 4, 5, 10; Leo on Nov 5 (approved off) and 10; Sasha Nov 5.
const at = (d, h) => new Date(Date.UTC(2026, 10, d, h + 6)).toISOString() // Central = UTC-6 in November
const row = (d, id, name, me, extra = {}) => ({
  shift_date: `2026-11-${String(d).padStart(2, '0')}`, va_id: id, full_name: name, is_me: me,
  starts_at: at(d, 8), ends_at: at(d, 18), tz: 'America/Chicago', off_status: null, off_reason: null, request_id: null, ...extra,
})
const ROWS = [
  row(4, 'me', 'Maya Reed', true),
  row(5, 'me', 'Maya Reed', true), row(5, 'leo', 'Leo Grant', false, { off_status: 'approved' }), row(5, 'sasha', 'Sasha Ortiz', false),
  row(10, 'me', 'Maya Reed', true, { off_status: 'pending', off_reason: 'Dentist', request_id: 'r1' }), row(10, 'leo', 'Leo Grant', false),
]

test('toShiftView builds the VA shell shape', () => {
  const v = toShiftView(ROWS, { today: '2026-11-05' })
  assert.equal(v.days.length, 2)
  assert.deepEqual(v.days[0].map(d => d.day), [2, 3, 4, 5, 6])
  assert.equal(v.shift.text, '8:00 AM to 6:00 PM')
  assert.equal(v.onToday, true)
  assert.deepEqual(v.mates.map(m => m.name), ['Sasha Ortiz'])       // Leo is off today
  assert.deepEqual(v.mine.map(d => d.day), [4, 5, 10])
  assert.deepEqual(v.askable.map(d => d.day), [])                    // Nov 10 already asked
  assert.deepEqual(v.dayOffs, [{ id: 'r1', date: '2026-11-10', day: 10, status: 'pending', why: 'Dentist' }])
  assert.equal(v.thisWeek, 2)
  assert.equal(v.me.name, 'Maya Reed')
  assert.equal(v.days[0][2].past, true)
})

test('toShiftView: off today, nothing on the rota', () => {
  const v = toShiftView(ROWS.filter(r => r.shift_date !== '2026-11-05'), { today: '2026-11-05' })
  assert.equal(v.onToday, false)
  assert.equal(v.shift.text, '8:00 AM to 6:00 PM')
  const empty = toShiftView([], { today: '2026-11-05' })
  assert.equal(empty.me, null)
  assert.deepEqual(empty.mine, [])
  assert.equal(empty.shift.text, '8:00 AM to 6:00 PM')
})

test('hooks only call the lib (no direct table writes or sends)', () => {
  const hooks = src('../hooks/useVaShifts.js')
  assert.ok(!/\.from\(/.test(hooks), 'hooks go through the lib')
  assert.ok(!/sms|twilio|send-|functions\.invoke/i.test(hooks + src('./vaShifts.js')))
})

test('migration 231: flag defaults off, notifications are bell-only', () => {
  const sql = src('../../supabase/migrations/231_va_shifts.sql')
  assert.match(sql, /va_shift_assign_live boolean not null default false/)
  assert.match(sql, /'va_day_off_requested', '\{admin\}',[^\n]*false, null, true, false/)
  assert.match(sql, /'va_day_off_decided',\s+'\{fulfillment\}',[^\n]*false, null, true, false/)
})

// ── Phase 2: labels and the admin rota ─────────────────────────────────────

test('date labels name the real month, not always Nov', () => {
  assert.equal(monthDay('2026-11-05'), 'Nov 5')
  assert.equal(dateLabel('2026-12-01'), 'Tue, Dec 1')
  assert.equal(rangeText('2026-11-02', '2026-11-08'), 'Nov 2 to 8')
  assert.equal(rangeText('2026-11-30', '2026-12-06'), 'Nov 30 to Dec 6')
})

test('toAdminRota keys days by date, two whole weeks, approved days off left out', () => {
  const at = (d, h) => `${d}T${h}:00:00-06:00`
  const rows = [
    { shift_date: '2026-11-02', va_id: 'a', full_name: 'Ann', starts_at: at('2026-11-02', '08'), ends_at: at('2026-11-02', '18'), off_status: null },
    { shift_date: '2026-11-02', va_id: 'b', full_name: 'Bo', starts_at: at('2026-11-02', '08'), ends_at: at('2026-11-02', '18'), off_status: 'pending' },
    { shift_date: '2026-11-03', va_id: 'a', full_name: 'Ann', starts_at: at('2026-11-03', '08'), ends_at: at('2026-11-03', '18'), off_status: 'approved' },
  ]
  const r = toAdminRota(rows, { today: '2026-11-05' })
  assert.equal(r.weeks.length, 2)
  assert.deepEqual(r.weeks[0], ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
  assert.equal(r.weeks[1][6], '2026-11-15')
  assert.deepEqual(r.rota['2026-11-02'], ['a', 'b'])
  assert.equal(r.rota['2026-11-03'], undefined)
})

test('toDayOffRows gives the Day off tab its shape', () => {
  const [r] = toDayOffRows([{ id: 'x', va_id: 'a', off_date: '2026-11-12', reason: null, status: 'pending', created_at: '2026-11-05T15:00:00Z', va: { full_name: 'Ann Lee' } }])
  assert.deepEqual(r, { id: 'x', va_id: 'a', date: '2026-11-12', reason: 'No reason given', status: 'pending', va: 'Ann Lee', asked: 'Thu, Nov 5' })
  assert.deepEqual(toDayOffRows(null), [])
})

test('toShiftView carries each shift own hours', () => {
  const v = toShiftView([{ shift_date: '2026-11-05', va_id: 'me', full_name: 'Me', is_me: true, starts_at: '2026-11-05T15:00:00Z', ends_at: '2026-11-05T22:00:00Z', tz: 'America/Chicago' }], { today: '2026-11-05' })
  assert.equal(v.mine[0].vas[0].text, '9:00 AM to 4:00 PM')
  assert.equal(v.shift.text, '9:00 AM to 4:00 PM')
})

test('the VA and admin pages read through the Phase 2 adapters', () => {
  const shell = src('../hooks/useVaShiftsShell.js')
  assert.match(shell, /plugRealShift\(/)
  assert.match(src('../template/ful/Shift.jsx'), /useVaShiftsShell/)
  assert.match(src('../template/ful/screens/Schedule.jsx'), /useDayOffActions/)
  assert.match(src('../adminshell/screens/Team.jsx'), /useAdmShifts\(\)/)
  // The sample data file stays free of the network so node tests can import it.
  assert.doesNotMatch(src('../template/ful/data.js'), /from ['"][^'"]*(hooks|supabase)/)
})
