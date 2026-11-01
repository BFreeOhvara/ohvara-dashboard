// Pure rules for Settings → Client contact: working hours, live-transfer phone and on-duty default
// (src/components/settings/AgentAvailabilityCards.jsx, src/hooks/useAgentSettings.js). No React.
//
// Shapes follow migration 197_agent_settings.sql. my_agent_settings() returns jsonb
// { timezone, working_hours: [{ weekday, start 'HH:MM', end 'HH:MM' }], live_transfer_phone (E.164 or
// null), on_duty_default, notifications }. save_my_agent_settings(p) changes only the keys present and
// returns the same shape. Weekdays are ISO: 1 = Monday … 7 = Sunday (not JS getDay). A missing row is a
// closed day. An end of '24:00' is valid on the server but a time input can't show it, so times are kept
// as strings and rendered as 'Midnight'. Nothing here sends anything, and nothing here touches the live on-duty switch.

import { isNotReadyError } from './clientPageLog.js'

export const settingsKey = id => ['agent-settings', id]

// The functions aren't in the database yet (PGRST202 / 42883 / PGRST205 / 42P01): show Coming soon.
export const isSettingsNotReady = e => isNotReadyError(e)

// ── Week ─────────────────────────────────────────────────────────────────────
export const WEEKDAYS = [
  { weekday: 1, short: 'Mon', long: 'Monday' },
  { weekday: 2, short: 'Tue', long: 'Tuesday' },
  { weekday: 3, short: 'Wed', long: 'Wednesday' },
  { weekday: 4, short: 'Thu', long: 'Thursday' },
  { weekday: 5, short: 'Fri', long: 'Friday' },
  { weekday: 6, short: 'Sat', long: 'Saturday' },
  { weekday: 7, short: 'Sun', long: 'Sunday' },
]

// What a day shows the first time it is switched on.
export const DEFAULT_START = '09:00'
export const DEFAULT_END = '17:00'

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const END_TIME = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/

export const isStart = s => typeof s === 'string' && TIME.test(s)
export const isEnd = s => typeof s === 'string' && END_TIME.test(s)

export function toMinutes(s) {
  const [h, m] = String(s).split(':').map(Number)
  return h * 60 + m
}

// The server's rows -> seven days, Monday first. A day with no row is closed (open: false) and keeps the
// default times, ready for when it is switched on.
export function weekFromRows(rows) {
  const byDay = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const weekday = Number(r?.weekday)
    if (Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 && isStart(r?.start) && isEnd(r?.end)) {
      byDay.set(weekday, { start: r.start, end: r.end })
    }
  }
  return WEEKDAYS.map(({ weekday }) => {
    const row = byDay.get(weekday)
    return row ? { weekday, open: true, ...row } : { weekday, open: false, start: DEFAULT_START, end: DEFAULT_END }
  })
}

// Seven days -> the server's rows: open days only, so a closed day is a missing row.
export function rowsFromWeek(week) {
  return week.filter(d => d.open).map(d => ({ weekday: d.weekday, start: d.start, end: d.end }))
}

// Change one day; every other day (and a stored '24:00' on it) is left exactly as it was.
export function setDay(week, weekday, patch) {
  return week.map(d => (d.weekday === weekday ? { ...d, ...patch } : d))
}

// '' when every open day is fine, else a sentence for the card's error line.
export function validateWeek(week) {
  for (const d of week) {
    if (!d.open) continue
    const name = WEEKDAYS.find(w => w.weekday === d.weekday)?.long || 'That day'
    if (!isStart(d.start) || !isEnd(d.end)) return `${name} needs a start and an end time.`
    if (toMinutes(d.end) <= toMinutes(d.start)) return `${name} must end after it starts. Overnight hours aren't allowed.`
  }
  return ''
}

export const weekChanged = (a, b) => JSON.stringify(rowsFromWeek(a)) !== JSON.stringify(rowsFromWeek(b))

// ── Times ────────────────────────────────────────────────────────────────────
// 'HH:MM' -> '9:00 AM'; '24:00' -> 'Midnight'.
export function timeLabel(s) {
  if (s === '24:00') return 'Midnight'
  if (!isStart(s)) return String(s ?? '')
  const [h, m] = s.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// Half-hour options for a select. An end list also offers 24:00. A stored value that isn't on the
// half-hour grid (say 09:15) is added so it is never lost on a re-save.
export function timeOptions(kind, current) {
  const values = []
  for (let m = 0; m < 24 * 60; m += 30) values.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  if (kind === 'end') values.push('24:00')
  if (current && !values.includes(current) && (kind === 'end' ? isEnd(current) : isStart(current))) {
    values.push(current)
    values.sort((a, b) => toMinutes(a) - toMinutes(b))
  }
  return values.map(value => ({ value, label: timeLabel(value) }))
}

// ── Phone ────────────────────────────────────────────────────────────────────
export const E164 = /^\+[1-9][0-9]{7,14}$/

// What the agent typed -> { value, error }. Empty clears (value null). A US number (10 digits, or 11
// starting with 1) becomes +1XXXXXXXXXX; a number typed with a leading + must already be valid E.164.
export function normalizePhone(input) {
  const text = String(input ?? '').trim()
  if (!text) return { value: null, error: '' }
  const digits = text.replace(/\D/g, '')
  if (text.startsWith('+')) {
    const e164 = `+${digits}`
    return E164.test(e164) ? { value: e164, error: '' } : { value: null, error: 'Enter a phone number like (555) 010-0142.' }
  }
  const us = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (us.length === 10 && /^[2-9]/.test(us)) return { value: `+1${us}`, error: '' }
  return { value: null, error: 'Enter a 10-digit US phone number, like (555) 010-0142.' }
}

// ── Payloads: each card sends only its own key ───────────────────────────────
export const hoursPayload = week => ({ working_hours: rowsFromWeek(week) })
export const phonePayload = value => ({ live_transfer_phone: value ?? null })
export const defaultPayload = on => ({ on_duty_default: !!on })

const SAVE_KEYS = ['working_hours', 'live_transfer_phone', 'on_duty_default']

// A save from these cards is exactly one of the three keys. Never notifications, timezone or anything else.
export function assertOneKey(payload) {
  const keys = Object.keys(payload || {})
  if (keys.length !== 1 || !SAVE_KEYS.includes(keys[0])) throw new Error('Settings save needs exactly one setting')
}

// ── Server answer ────────────────────────────────────────────────────────────
// Same shape from read and save; tolerate a short or odd answer.
export function normalizeSettings(data) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    timezone: typeof d.timezone === 'string' ? d.timezone : '',
    week: weekFromRows(d.working_hours),
    phone: typeof d.live_transfer_phone === 'string' && d.live_transfer_phone ? d.live_transfer_phone : null,
    dutyDefault: d.on_duty_default === true,
  }
}

export async function readMyAgentSettings(db) {
  const { data, error } = await db.rpc('my_agent_settings')
  if (error) throw error
  return normalizeSettings(data)
}

export async function saveMyAgentSettings(db, payload) {
  assertOneKey(payload)
  const { data, error } = await db.rpc('save_my_agent_settings', { p: payload })
  if (error) throw error
  return normalizeSettings(data)
}

// The line under a failed save. The server's own words for a refusal (a locked self-signup gets
// 'Choose a plan to unlock your portal.', a bad field gets its reason); anything else is generic.
export function saveErrorText(e) {
  if ((e?.code === '42501' || e?.code === '22023') && typeof e.message === 'string' && e.message.trim()) return e.message.trim()
  return "Couldn't save that. Try again."
}

// 'America/Chicago' -> 'Central time'; any other zone name as is.
const ZONE_WORD = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Mountain (AZ)',
  'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
  'America/Boise': 'Mountain', 'America/Detroit': 'Eastern', 'America/Indiana/Indianapolis': 'Eastern',
}
export function zoneLabel(tz) {
  if (!tz) return 'your time zone'
  return ZONE_WORD[tz] ? `${ZONE_WORD[tz]} time` : tz.replace(/_/g, ' ')
}
