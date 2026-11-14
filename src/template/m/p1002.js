// P1002 — pure helpers for the agent phone's desktop-parity pieces (no React, so node --test can read them).
import { agentStatusOf, AGENT_STATUSES } from '../agentView.js'

// The desktop Leads board's five lanes (agentView AGENT_STATUSES), each in the phone's own colour.
export const LANES = AGENT_STATUSES
export const LANE_TONE = { booked: 'sky', no_show: 'stone', follow: 'butter', not_interested: 'apricot', sold: 'sage' }
// The lane a lead sits in, or null when it isn't on a lane (a live call is pinned above; the team's own leads and
// closed ones are never on the agent's side).
export const laneOfLead = l => { const k = agentStatusOf(l); return LANE_TONE[k] ? k : null }
// Old links (?stage=mark, ?lane=no_show…) land on the lane that holds them.
export const LANE_FROM = { mark: 'booked', booked: 'booked', follow: 'follow', no_show: 'no_show', not_interested: 'not_interested', sold: 'sold' }

// The lead search the desktop uses: name, city or phone.
export const leadMatches = (l, q) => {
  const n = String(q || '').trim().toLowerCase()
  return !n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n)
}

// A thread search (Messages): by the client's name.
export const threadMatches = (t, q) => {
  const n = String(q || '').trim().toLowerCase()
  return !n || String(t.name || '').toLowerCase().includes(n)
}

// "2026-11-09" + 7 days.
export const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
export const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// This week or next week, Mon to Fri: [{ day, date, mon, iso }] from the week hook's days ([weekday, day of month]).
export function weekOf(week, which = 'this') {
  return week.days.map(([day, n]) => {
    const iso = which === 'next' ? plusDays(week.isoOf(n), 7) : week.isoOf(n)
    return { day, date: Number(iso.slice(8, 10)), mon: MONS[Number(iso.slice(5, 7)) - 1], iso }
  })
}
