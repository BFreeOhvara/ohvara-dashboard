import { useMemo } from 'react'
import { useAllProfiles, usePendingInvites } from './useProfiles'
import { useAgentBookings } from './useAgentBookings'
import { useCallOutcomes } from './useRepCallEvents'
import { buildCalls, thisWeek } from '../lib/fulfillmentDay'
import { isLive } from '../lib/agentBookings'
import { addDaysStr } from '../lib/scheduling'
import { zonedDateStr } from '../lib/timezones'

// Admin Users' numbers (Prompt 762), shared with the admin phone's People
// (Prompt 774): every agent and Fulfillment person with this week's calls
// day by day (`a`), cancelled (`b`), totals (`main`, `cx`), clients (agents)
// and whether they're on a call. See pages/admin/Users.jsx for the rules.

const DAYS = 7

export function usePeopleWeek(now, tz) {
  const profilesQ = useAllProfiles()
  const { data: profiles = [], isLoading: peopleLoading } = profilesQ
  const invitesQ = usePendingInvites()
  const { data: invites = [] } = invitesQ
  const rowsQ = useAgentBookings(null)
  const { data: rows = [], isLoading: rowsLoading } = rowsQ
  const week = useMemo(() => thisWeek(now, tz), [now, tz])
  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDaysStr(week.from, i)), [week.from])
  const todayStr = zonedDateStr(now, tz)
  const eventsQ = useCallOutcomes(
    new Date(week.startMs).toISOString(), new Date(week.endMs).toISOString(), { live: rows.some(isLive) },
  )
  const { data: events = [], isLoading: eventsLoading } = eventsQ
  // P780 — failed loads, so the page says so instead of "No agents yet" / zeros.
  const broken = q => q.isError && !q.data
  const peopleFailed = broken(profilesQ) || broken(invitesQ)
  const numbersFailed = broken(rowsQ) || broken(eventsQ)
  const retry = () => [profilesQ, invitesQ, rowsQ, eventsQ].forEach(q => broken(q) && q.refetch())

  const people = useMemo(() => profiles.filter(u => u.role === 'agent' || u.role === 'fulfillment'), [profiles])
  const byId = useMemo(() => new Map(people.map(u => [u.id, u])), [people])

  // ── this week, per person ──
  const stats = useMemo(() => {
    const out = new Map()
    const blank = () => ({ a: new Array(7).fill(0), b: new Array(7).fill(0), clients: 0, live: false })
    for (const u of people) out.set(u.id, blank())
    for (const p of rows) {
      const s = out.get(p.agent_id)
      if (s && byId.get(p.agent_id)?.role === 'agent') s.clients++
      const f = out.get(p.assigned_fulfillment_id)
      if (f && isLive(p)) f.live = true
    }
    // One list of this week's calls: an agent's are their clients' calls, a
    // Fulfillment person's are the ones on their row.
    const calls = buildCalls(rows, now, tz, { from: week.from, to: week.to, events })
    const add = (id, role, c) => {
      const s = out.get(id)
      if (!s || byId.get(id)?.role !== role) return
      const i = dates.indexOf(c.date)
      if (i < 0) return
      s.a[i]++
      if (c.done && c.tone === 'cancelled') s.b[i]++
    }
    for (const c of calls) {
      add(c.p.agent_id, 'agent', c)
      add(c.done && c.tone !== 'live' && byId.has(c.by) ? c.by : c.p.assigned_fulfillment_id, 'fulfillment', c)
    }
    for (const s of out.values()) {
      s.main = s.a.reduce((t, n) => t + n, 0)
      s.cx = s.b.reduce((t, n) => t + n, 0)
    }
    return out
  }, [people, byId, rows, events, dates, tz, now, week.from, week.to])

  return { profiles, invites, rows, events, week, dates, todayStr, people, byId, stats, peopleLoading, rowsLoading, eventsLoading, peopleFailed, numbersFailed, retry }
}
