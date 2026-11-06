// VA shifts, the rota and day-off requests (Prompt 851): the read/write logic the
// useVaShifts hooks run with the real supabase client, kept here so it can be
// tested without React or a network. Everything goes through migration 231:
//   va_shifts_today(p_day)               who is on shift that day
//   va_shift_week(p_from, p_days, p_va)  the rota for a run of days
//   va_request_day_off / va_cancel_day_off / va_decide_day_off
//   va_shifts (table)                    admins write the rota directly (RLS: admin only)
// Until 231 is applied the functions and table are missing: reads return null
// (the caller keeps its sample rota) and writes throw SHIFTS_NOT_READY.

export const COMPANY_TZ = 'America/Chicago'
export const SHIFTS_NOT_READY = 'Shifts are not switched on yet.'

export const isShiftsMissing = e =>
  !!e && ['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code)

export const shiftKeys = {
  all: ['va-shifts'],
  today: day => ['va-shifts', 'today', day || 'today'],
  week: (from, days, va) => ['va-shifts', 'week', from || 'this', days || 7, va || 'all'],
  requests: () => ['va-shifts', 'requests'],
}

// ── dates (all as YYYY-MM-DD in the company zone) ────────────────────────────

export function companyDay(at = new Date(), tz = COMPANY_TZ) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const g = t => p.find(x => x.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}`
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Monday of the week the day is in.
export function weekStart(day) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, -((dow + 6) % 7))
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayName = day => DOW[new Date(`${day}T12:00:00Z`).getUTCDay()]

// "8:00 AM" in the shift's own zone.
export function clockText(iso, tz = COMPANY_TZ) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export const shiftText = (startsAt, endsAt, tz = COMPANY_TZ) =>
  `${clockText(startsAt, tz)} to ${clockText(endsAt, tz)}`

// ── reads ───────────────────────────────────────────────────────────────────

// Rows from va_shifts_today, or null while 231 isn't applied.
export async function readShiftsToday(db, day = null) {
  const { data, error } = await db.rpc('va_shifts_today', day ? { p_day: day } : {})
  if (error) {
    if (isShiftsMissing(error)) return null
    throw error
  }
  return data || []
}

// Rows from va_shift_week, or null while 231 isn't applied.
export async function readShiftWeek(db, { from = null, days = 7, va = null } = {}) {
  const args = { p_days: days }
  if (from) args.p_from = from
  if (va) args.p_va = va
  const { data, error } = await db.rpc('va_shift_week', args)
  if (error) {
    if (isShiftsMissing(error)) return null
    throw error
  }
  return data || []
}

// ── writes ──────────────────────────────────────────────────────────────────

async function call(db, fn, args) {
  const { data, error } = await db.rpc(fn, args)
  if (error) {
    if (isShiftsMissing(error)) throw new Error(SHIFTS_NOT_READY)
    throw error
  }
  return data
}

export const requestDayOff = (db, day, reason = '') =>
  call(db, 'va_request_day_off', { p_day: day, p_reason: (reason || '').trim() || null })

export const cancelDayOff = (db, day) => call(db, 'va_cancel_day_off', { p_day: day })

export const decideDayOff = (db, requestId, approve) =>
  call(db, 'va_decide_day_off', { p_request: requestId, p_approve: !!approve })

// Admin rota builder: put a VA on (or move their hours for) a day.
export async function saveShift(db, { vaId, day, starts = '08:00', ends = '18:00', tz = COMPANY_TZ }) {
  const { data, error } = await db.from('va_shifts')
    .upsert({ va_id: vaId, shift_date: day, starts, ends, tz }, { onConflict: 'va_id,shift_date' })
    .select().single()
  if (error) {
    if (isShiftsMissing(error)) throw new Error(SHIFTS_NOT_READY)
    throw error
  }
  return data
}

// Admin rota builder: take a VA off the rota for a day.
export async function removeShift(db, { vaId, day }) {
  const { error } = await db.from('va_shifts').delete().eq('va_id', vaId).eq('shift_date', day)
  if (error) {
    if (isShiftsMissing(error)) throw new Error(SHIFTS_NOT_READY)
    throw error
  }
  return true
}

// Admin: every day-off request from today on, newest day first is not useful —
// soonest first, pending before decided.
export async function readDayOffRequests(db, fromDay) {
  const { data, error } = await db.from('va_day_off_requests')
    .select('id, va_id, off_date, reason, status, decided_by, decided_at, created_at, va:profiles!va_day_off_requests_va_id_fkey(full_name)')
    .gte('off_date', fromDay)
    .order('off_date', { ascending: true })
  if (error) {
    if (isShiftsMissing(error)) return null
    throw error
  }
  const rank = { pending: 0, approved: 1, declined: 2 }
  return (data || []).slice().sort((a, b) => a.off_date.localeCompare(b.off_date) || rank[a.status] - rank[b.status])
}

// ── the VA view ─────────────────────────────────────────────────────────────

// Builds the same shape the VA shell's sample useFulShift returns (P846), from
// va_shift_week rows covering whole weeks, so Phase 2 can swap the source:
//   { me, shift, days: [[day…] per week], mine, onToday, mates, askable, dayOffs, thisWeek }
// day = { date, day (day of month), name, today, past, vas: [{ id, name, me, off }] }
// The shift line shows today's hours (or the next shift's, or 8:00 AM to 6:00 PM).
export function toShiftView(rows, { today, from, weeks = 2, meId = null } = {}) {
  const start = from || weekStart(today)
  const byDay = new Map()
  for (const r of rows || []) {
    if (!byDay.has(r.shift_date)) byDay.set(r.shift_date, [])
    byDay.get(r.shift_date).push(r)
  }
  const isMe = r => r.is_me || (meId && r.va_id === meId)
  const days = []
  for (let w = 0; w < weeks; w++) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, w * 7 + i)
      const list = byDay.get(date) || []
      // Weekends only show when someone is on.
      if (i >= 5 && list.length === 0) continue
      week.push({
        date, day: Number(date.slice(8)), name: dayName(date), today: date === today, past: date < today,
        vas: list.map(r => ({
          id: r.va_id, name: r.full_name, me: !!isMe(r),
          off: r.off_status === 'approved' || (isMe(r) && r.off_status === 'pending'),
          offStatus: r.off_status || null,
          startsAt: r.starts_at, endsAt: r.ends_at, tz: r.tz || COMPANY_TZ,
        })),
      })
    }
    days.push(week)
  }
  const flat = days.flat()
  const mine = flat.filter(d => d.vas.some(v => v.me))
  const todayDay = flat.find(d => d.today)
  const meToday = todayDay?.vas.find(v => v.me)
  const ref = meToday || mine.find(d => !d.past)?.vas.find(v => v.me) || null
  const shift = ref
    ? { start: clockText(ref.startsAt, ref.tz), end: clockText(ref.endsAt, ref.tz), text: shiftText(ref.startsAt, ref.endsAt, ref.tz) }
    : { start: '8:00 AM', end: '6:00 PM', text: '8:00 AM to 6:00 PM' }
  const dayOffs = (rows || [])
    .filter(r => isMe(r) && r.off_status)
    .map(r => ({ id: r.request_id, date: r.shift_date, day: Number(r.shift_date.slice(8)), status: r.off_status, why: r.off_reason || '' }))
  const asked = new Set(dayOffs.map(o => o.date))
  const firstWeek = new Set((days[0] || []).map(d => d.date))
  const me = meToday || ref ? { id: (meToday || ref).id, name: (meToday || ref).name, me: true } : null
  return {
    me, shift, days, mine,
    onToday: !!meToday && !meToday.off,
    mates: (todayDay?.vas || []).filter(v => !v.me && !v.off),
    askable: mine.filter(d => d.date > today && !asked.has(d.date)),
    dayOffs,
    thisWeek: mine.filter(d => firstWeek.has(d.date) && !d.vas.find(v => v.me).off).length,
  }
}
