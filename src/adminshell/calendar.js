// P867 — admin Fulfillment as a calendar: every VA's calls and shifts on one week, the P854 look (VA Schedule, agent
// Calendar). Plain functions, no React (tested in calendar867.test.js). Sample: today's calls are the desk's; the
// other days are filled from the rota so the week reads like a real one. Times are on the company clock (Central);
// a client in another zone gets their own time beside it.

// One colour per VA, in team order, from the shell palette (src/index.css --sh-f-<hue> fill, --sh-fi-<hue> ink).
export const VA_HUES = ['sky', 'apricot', 'sage', 'butter', 'lilac']
export const vaHue = (team, id) => VA_HUES[Math.max(0, team.findIndex(v => v.id === id)) % VA_HUES.length]

export const GRID_START = 8 // 8 AM
export const GRID_END = 20 // 8 PM: the latest shift ends then
export const GRID_ROWS = GRID_END - GRID_START

export function minutesOf(t) {
  const m = /(\d+):(\d+)\s*(AM|PM)/.exec(String(t || ''))
  if (!m) return null
  return ((+m[1] % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2]
}
export const clockOf = mins => { const h = Math.floor(mins / 60); const m = mins % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }

// A shift's hours ("9:00 AM to 5:00 PM") as minutes from midnight.
export function shiftSpan(hours) {
  const [a, b] = String(hours || '').split(' to ')
  const s = minutesOf(a)
  const e = minutesOf(b)
  return s == null || e == null ? null : [s, e]
}

// Where the client is, against Central (November: standard time). 0 = same clock, no second label.
const ZONE = { TX: [0, 'CT'], IL: [0, 'CT'], MO: [0, 'CT'], FL: [1, 'ET'], GA: [1, 'ET'], NY: [1, 'ET'], OH: [1, 'ET'], NC: [1, 'ET'], AZ: [-1, 'MT'], CO: [-1, 'MT'], CA: [-2, 'PT'], WA: [-2, 'PT'] }
export function theirTime(time, state) {
  const z = ZONE[state]
  const m = minutesOf(time)
  if (!z || !z[0] || m == null) return ''
  return `${clockOf(m + z[0] * 60)} ${z[1]}`
}

const CLIENTS = [
  ['Beatrice Hall', 'FL'], ['Frank Moreno', 'TX'], ['Joan Palmer', 'AZ'], ['Victor Lane', 'GA'], ['Ellen Ross', 'CA'], ['Marvin Cole', 'OH'],
  ['Opal Reed', 'TX'], ['Curtis Bell', 'NY'], ['Wanda Fox', 'CO'], ['Leon Price', 'NC'], ['Hazel Grant', 'TX'], ['Roy Dunn', 'WA'],
]
const DESK_STATES = ['TX', 'FL', 'TX', 'AZ', 'GA', 'NY', 'TX', 'CA', 'TX', 'OH', 'FL', 'TX']
const CARRIERS = ['Globe Life', 'Colonial Penn', 'Gerber Life', 'AARP / New York Life', 'Lincoln Heritage']

// The week's calls: today's from the desk (as they are, with the client's state), two on each other day for each VA
// on shift (inside their hours). Days before today are done (cancelled or no answer); days after are booked.
export function weekCalls({ desk, rota, vas, today, days }) {
  const out = desk.map((c, i) => ({ ...c, day: today, state: c.state || DESK_STATES[i % DESK_STATES.length] }))
  let n = 0
  for (const d of days) {
    if (d === today) continue
    for (const id of rota[d] || []) {
      const v = vas.find(x => x.id === id)
      const span = shiftSpan(v?.hours) || [9 * 60, 17 * 60]
      for (let k = 0; k < 2; k++) {
        const [client, state] = CLIENTS[n % CLIENTS.length]
        const at = span[0] + 60 + ((n * 75 + k * 150) % Math.max(60, span[1] - span[0] - 120))
        const time = clockOf(Math.round(at / 15) * 15)
        const status = d < today ? (n % 3 === 2 ? 'no_answer' : 'cancelled') : 'booked'
        out.push({ id: `wc-${d}-${id}-${k}`, va_id: id, va: v?.name || '', day: d, time, client, state, status, old_carrier: CARRIERS[n % CARRIERS.length], agent: '' })
        n++
      }
    }
  }
  return out.sort((a, b) => a.day - b.day || minutesOf(a.time) - minutesOf(b.time))
}

// Side-by-side lanes inside a day for calls whose 30-minute blocks overlap: id -> [lane, lanes].
export function lanes(list, slot = 30) {
  const out = new Map()
  let cluster = []
  let ends = []
  let clusterEnd = -1
  const flush = () => { const of = Math.max(1, ends.length); cluster.forEach(([e, k]) => out.set(e.id, [k, of])); cluster = []; ends = []; clusterEnd = -1 }
  for (const e of list) {
    const s = minutesOf(e.time)
    if (cluster.length && s >= clusterEnd) flush()
    let k = ends.findIndex(end => end <= s)
    if (k < 0) { k = ends.length; ends.push(0) }
    ends[k] = s + slot
    clusterEnd = Math.max(clusterEnd, s + slot)
    cluster.push([e, k])
  }
  flush()
  return out
}

// The rota grid's cell for one VA on one day: 'on' (with hours), 'requested' (a day off asked, not answered),
// 'off' (an approved day off) or '' (not on).
export function rotaCell({ rota, dayOff, va, day }) {
  const req = dayOff.find(x => x.va_id === va.id && x.date === day && x.status !== 'declined')
  if (req?.status === 'approved') return { kind: 'off' }
  const on = (rota[day] || []).includes(va.id)
  if (req) return { kind: 'requested', on, reason: req.reason }
  return on ? { kind: 'on', hours: va.hours } : { kind: '' }
}
