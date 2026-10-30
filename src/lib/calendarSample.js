import { zonedTimeToUtcIso, zonedDateStr, DEFAULT_TIMEZONE } from './timezones.js'

// SAMPLE-FIXTURE-CAL
// Made-up calendar for /agent/calendar?sample=1 (dev server only). The page imports this file
// dynamically from inside an import.meta.env.DEV branch, so a production build never contains it.
// It returns the same shapes the three hooks return (agent_inbounds rows, inbound_events by lead,
// policies rows), so the page maps them with the code real data goes through. Nothing here is
// written to the query cache, and no query key is touched.
// People and times follow the approved mockup (ohvara/mockups/update-the-existing-calendar-page-filled.html).
// Numbers are 555; no emails. Times are the agent's wall clock, laid on the current Monday-to-Sunday week.

export const SAMPLE_TAG = 'SAMPLE-FIXTURE-CAL'

const addDays = (d, n) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const mondayOf = d => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))

// [day 0 = Monday, hour, name, kind (i inbound, c booked call), outcome once the time has passed, phone tail, state]
const WEEK = [
  [0, 10, 'Dana Wells', 'c', 'done', '0131', 'TX'],
  [0, 13, 'Mina Patel', 'i', 'sold', '0136', 'IL'],
  [0, 15.5, 'Marcus Lee', 'c', 'noanswer', '0140', 'MO'],
  [1, 9.5, 'Owen Burke', 'i', 'follow_up', '0144', 'PA'],
  [1, 14, 'Priya Shah', 'c', 'done', '0147', 'NC'],
  [2, 11, 'Greg Olson', 'i', 'lost', '0151', 'MN'],
  [2, 15, 'Theo Grant', 'i', 'sold', '0153', 'AZ'],
  [3, 13, 'Nora Hale', 'c', 'done', '0158', 'LA'],
  [3, 13.5, 'Ben Carter', 'c', 'noanswer', '0160', 'VA'],
  [3, 16, 'Irene Cho', 'i', 'met', '0163', 'WA'],
  [4, 9, 'Paul Nguyen', 'i', 'booked', '0155', 'GA'],
  [4, 14.5, 'Elena Marsh', 'i', 'booked', '0148', 'OH'],
  [4, 16, 'Kevin Duarte', 'c', 'booked', '0129', 'OK'],
  [4, 18, 'Tasha Greene', 'i', 'booked', '0166', 'FL'],
  [5, 10, 'Jerome Walsh', 'i', 'booked', '0169', 'TN'],
  [5, 13.5, 'Alicia Moreno', 'c', 'booked', '0171', 'CA'],
]

const wall = (day, hour) => {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function sampleCalendar({ tz = DEFAULT_TIMEZONE, nowMs = Date.now() } = {}) {
  const today = zonedDateStr(nowMs, tz)
  const monday = mondayOf(today)
  const inbounds = []
  const events = new Map()
  const bookings = []

  const add = ([d, hour, name, kind, outcome, tail, state], n) => {
    const at = zonedTimeToUtcIso(wall(addDays(monday, d), hour), tz)
    const past = new Date(at).getTime() < nowMs
    const phone = `555010${tail}`
    if (kind === 'i') {
      const id = `sample-inbound-${n}`
      // An appointment in the future is simply booked; the outcome only exists once the time has passed.
      const stage = past ? outcome : 'booked'
      inbounds.push({
        lead_id: id, lead_type: 'booked_appointment', inbound_product: 'booked_appointment', inbound_stage: stage,
        outcome: stage === 'sold' ? 'sold' : stage === 'follow_up' ? 'follow_up' : stage === 'lost' ? 'not_interested' : null,
        contact_name: name, phone, city: null, state, delivered_at: at, created_at: at,
      })
      events.set(id, [{ id: `${id}-booked`, lead_id: id, kind: 'booked', state: 'done', at, detail: { appointment_at: at }, actor_role: 'va' }])
    } else {
      const [first, ...rest] = name.split(' ')
      bookings.push({
        id: `sample-booking-${n}`, client_first_name: first, client_last_name: rest.join(' '), client_phone: phone, state,
        client_city: null, client_timezone: null, scheduled_call_at: at,
        fulfillment_stage: past && outcome === 'done' ? 'Complete' : 'Pending',
        last_call_outcome: past && outcome === 'noanswer' ? 'no_answer' : null,
        call_live_since: null,
      })
    }
  }
  WEEK.forEach((row, n) => add(row, n))

  // One call that is happening now, on today, so the live badge shows whatever day this is opened on.
  const nowHour = Number(new Date(nowMs).toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }))
  const liveHour = Math.min(17, Math.max(9, nowHour))
  const liveAt = zonedTimeToUtcIso(wall(today, liveHour), tz)
  bookings.push({
    id: 'sample-booking-live', client_first_name: 'Helen', client_last_name: 'Park', client_phone: '5550100172', state: 'CO',
    client_city: null, client_timezone: null, scheduled_call_at: liveAt, fulfillment_stage: 'In Progress',
    last_call_outcome: null, call_live_since: liveAt,
  })

  return { inbounds, events, bookings }
}
