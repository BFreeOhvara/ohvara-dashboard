import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useAgentBookings } from './useAgentBookings'
import { useServicingTasks, TASK_LABEL } from './useServicingTasks'
import { useWeeklyUsage } from './useBillingTiers'
import { useInbounds } from './useInbounds'
import { stageOf, useNow } from '../lib/agentBookings'
import { DEFAULT_TIMEZONE } from '../lib/timezones'
import {
  BOOK_COLS, bookFromRows, bookUnavailable, isMissingRelation, submissionsFromUsage,
  dueSoonSteps, doneByDay, weekBounds, hasLeadsOf, hasServicingOf,
} from '../lib/overviewBook'

// The Overview's data layer (Agent Portal Servicing Spec, Overview). Read only: this file makes
// selects and the existing agent_weekly_usage / agent_inbounds reads, never a write. The rules are
// in src/lib/overviewBook.js (tested by overviewBook.test.js); this file only loads and wires.
//
// RETURN SHAPE (stable; the Overview UI depends on it)
//   useOverviewBook() -> {
//     book: {                      one row per client in agent_clients, counted by its `stage` key
//       status,                    'loading' | 'ready' | 'error'
//       available,                 false until migration 193 is applied (the view is missing):
//                                  then every number is null and the UI shows dashes and a plain
//                                  note, never zeros. true on a loaded view.
//       protected,                 clients in stage protected OR ongoing (ongoing = past the 12
//                                  month chargeback watch and still looked after; ended counts nowhere)
//       settingUp,                 stage setting_up
//       needsAttention,            stage needs_attention
//       requestsOpen,              clients with an open request (open_requests > 0)
//     },                           every number is null when status is not 'ready' or available is false
//     submissions: {               this week's usage, from agent_weekly_usage (the Submit sidebar's source)
//       status, used, cap,         cap is null for an uncapped agent; used/cap null with no usage row
//       resetsAt,                  ISO timestamp the week rolls over (usage.week_end), or null
//     },
//     steps: {
//       dueSoon, dueSoonStatus,    open STEPS (not requests) with a due_at, soonest first, max 10:
//                                  [{ id, kind, label, dueAt, overdue, status, clientName, policyId, leadId }]
//                                  chargeback_watch and tasks without due_at never appear
//       doneByDay, doneStatus,     ALWAYS 7 entries, last Monday to Sunday in the agent's zone:
//                                  [{ date: 'YYYY-MM-DD', packet_check, review_call, cancellation,
//                                     save, total }]. A count is null while its source is loading
//                                  or failed (and total with it), never a zero.
//       savesKnown,                false when servicing_tasks.outcome can't be read yet (column
//                                  missing before 193, error 42703): `save` is then 0 on every day
//                                  and the other counts still work
//     },
//     hasLeads, leadsStatus,       leads_weekly_cents > 0 OR any inbound; leadsStatus 'ready' once that
//                                  is known ('loading' | 'ready' | 'error')
//     hasServicing,                profile.has_servicing !== false
//     tz,                          the agent's zone (profile.timezone, default America/Chicago)
//     isLoading, isError, refetch  any part loading / any part failed / reload every part
//   }
// Every part has its own status, so one failing source never blanks the others.

const PAGE = 1000
const MAX_PAGES = 20
const statusOf = q => (q.isError ? 'error' : q.isLoading ? 'loading' : 'ready')

// agent_clients for this agent: the stage is read as a key, never worked out here. A missing view
// (migration 193 not applied) is a normal answer, not an error: { available: false }.
function useBookClients(agentId) {
  return useQuery({
    queryKey: ['overview-book', 'clients', agentId],
    enabled: !!agentId,
    refetchInterval: 60e3,
    queryFn: async () => {
      const rows = []
      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error, status } = await supabase.from('agent_clients').select(BOOK_COLS)
          .eq('agent_id', agentId).order('client_key').range(page * PAGE, page * PAGE + PAGE - 1)
        if (error) {
          if (isMissingRelation(error, status)) return bookUnavailable()
          throw error
        }
        rows.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      return bookFromRows(rows)
    },
  })
}

// Saved lapse saves last week, in a query of its own. servicing_tasks.outcome is a migration 193
// column and must NOT go into useServicingTasks' TASK_COLS: that select runs on the Clients page
// against the live database, where a missing column would break it. Any failure here (42703 above
// all) just means saves are unknown: zero, and the rest of the chart is untouched.
function useLastWeekSaves(agentId, tz, weekKey) {
  return useQuery({
    queryKey: ['overview-book', 'saves', agentId, weekKey],
    enabled: !!agentId,
    refetchInterval: 5 * 60e3,
    retry: false,
    queryFn: async () => {
      const { lastWeekStartMs, thisWeekStartMs } = weekBounds(Date.parse(`${weekKey}T12:00:00Z`), tz)
      const { data, error } = await supabase.from('servicing_tasks').select('id, done_at')
        .eq('agent_id', agentId).eq('kind', 'lapse_save').eq('outcome', 'saved')
        .gte('done_at', new Date(lastWeekStartMs).toISOString()).lt('done_at', new Date(thisWeekStartMs).toISOString())
      if (error) return { known: false, rows: [] }
      return { known: true, rows: data || [] }
    },
  })
}

export function useOverviewBook() {
  const { profile } = useAuth()
  const agentId = profile?.id
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const now = useNow()

  const bookQ = useBookClients(agentId)
  const usageQ = useWeeklyUsage(agentId)
  const tasksQ = useServicingTasks()
  const bookingsQ = useAgentBookings(agentId)
  const inboundsQ = useInbounds()
  // The week's key is its Monday, so the saves query rolls over with the week.
  const weekKey = weekBounds(now, tz).thisMonday
  const savesQ = useLastWeekSaves(agentId, tz, weekKey)

  const bookStatus = statusOf(bookQ)
  const submissionsStatus = statusOf(usageQ)
  const tasksStatus = statusOf(tasksQ)
  const bookingsStatus = statusOf(bookingsQ)
  const inboundsStatus = statusOf(inboundsQ)

  const book = useMemo(() => {
    const none = { available: true, protected: null, settingUp: null, needsAttention: null, requestsOpen: null }
    return { status: bookStatus, ...(bookStatus === 'ready' && bookQ.data ? bookQ.data : none) }
  }, [bookStatus, bookQ.data])

  const submissions = useMemo(() => ({
    status: submissionsStatus,
    ...(submissionsStatus === 'ready' ? submissionsFromUsage(usageQ.data) : { used: null, cap: null, resetsAt: null }),
  }), [submissionsStatus, usageQ.data])

  const steps = useMemo(() => {
    const tasks = tasksStatus === 'ready' ? tasksQ.data || [] : null
    const policies = bookingsStatus === 'ready' ? bookingsQ.data || [] : null
    const policyMap = new Map((policies || []).map(p => [p.id, p]))
    const leadMap = new Map((inboundsQ.data || []).map(l => [l.lead_id, l]))
    const savesKnown = !!savesQ.data?.known
    return {
      dueSoon: tasks ? dueSoonSteps(tasks, { policies: policyMap, leads: leadMap, labels: TASK_LABEL, nowMs: now }) : [],
      dueSoonStatus: tasksStatus === 'ready' && (bookingsStatus === 'loading' || inboundsStatus === 'loading') ? 'loading' : tasksStatus,
      doneByDay: doneByDay({
        tasks, policies, saves: savesKnown ? savesQ.data.rows : null, nowMs: now, tz,
        isCancelled: p => stageOf(p) === 'cancelled',
      }),
      doneStatus: tasksStatus === 'error' || bookingsStatus === 'error' ? 'error'
        : tasksStatus === 'loading' || bookingsStatus === 'loading' ? 'loading' : 'ready',
      savesKnown,
    }
  }, [tasksStatus, tasksQ.data, bookingsStatus, bookingsQ.data, inboundsStatus, inboundsQ.data, savesQ.data, now, tz])

  // A Leads buyer is known from the profile alone; everyone else waits on the inbound list.
  const buysLeads = Number(profile?.leads_weekly_cents) > 0
  const hasLeads = hasLeadsOf(profile, inboundsQ.data)
  const leadsStatus = buysLeads || hasLeads ? 'ready' : inboundsStatus

  const statuses = [bookStatus, submissionsStatus, steps.dueSoonStatus, steps.doneStatus, leadsStatus]
  const queries = [bookQ, usageQ, tasksQ, bookingsQ, inboundsQ, savesQ]
  return {
    book,
    submissions,
    steps,
    hasLeads,
    leadsStatus,
    hasServicing: hasServicingOf(profile),
    tz,
    isLoading: statuses.includes('loading'),
    isError: statuses.includes('error'),
    refetch: () => Promise.all(queries.map(q => q.refetch())),
  }
}
