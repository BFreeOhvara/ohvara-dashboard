import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Activity tab (Prompts 690, 694): one day's status changes + call-time moves
// from policy_events, written by a trigger on policies (migration 118).
// RLS = whoever can read the policy. `day` is a local-midnight Date.
// `agentId` narrows to one agent; null = everything RLS allows (admin).

const EVENT_SELECT = `
  id, policy_id, agent_id, kind, from_status, actor_name, actor_role, detail, at,
  policy:policies ( client_first_name, client_last_name, state, client_city, client_timezone ),
  agent:profiles!policy_events_agent_id_fkey ( full_name )
`

export function usePolicyEvents(day, agentId = null) {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const startISO = start.toISOString()
  const endISO = end.toISOString()
  return useQuery({
    queryKey: ['policy-events', startISO, agentId ?? 'visible'],
    queryFn: async () => {
      let q = supabase
        .from('policy_events')
        .select(EVENT_SELECT)
        .gte('at', startISO)
        .lt('at', endISO)
        .order('at', { ascending: false })
        .limit(1000)
      if (agentId) q = q.eq('agent_id', agentId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}

// The Activity page's feed: every kind of event on one day, from
// agent_activity_feed() (migration 185). Rows are { id, kind, at, lead_id, agent_id,
// title, meta }, newest first. Before that migration is applied the function does not
// exist (PostgREST PGRST202, SQL 42883), so the page falls back to policy_events mapped
// to the same shape and never breaks. Admin rows also get `agent_name` (the rpc returns
// only agent_id); a failed name lookup just leaves the name off.
const isMissingFn = error => error?.code === 'PGRST202' || error?.code === '42883'

// A policy_events row as the rpc would return it. A corrected result is an outcome.
export function policyEventRow(e) {
  const d = e.detail || {}
  const correction = !!d.correction
  const meta = {
    policy_id: e.policy_id,
    client_first_name: e.policy?.client_first_name,
    client_last_name: e.policy?.client_last_name,
    state: e.policy?.state,
    client_timezone: e.policy?.client_timezone,
    actor_name: e.actor_name,
    actor_role: e.actor_role,
    attempt: d.attempt,
    reason: d.reason,
    from: e.kind === 'moved' ? d.from : undefined,
    to: e.kind === 'moved' ? d.to : e.kind === 'booked' ? d.scheduled_call_at : undefined,
    rebook: e.kind === 'booked' && !!e.from_status,
  }
  if (correction) { meta.result_from = d.from; meta.result_to = e.kind }
  if (e.kind === 'edited') meta.changed_fields = (Array.isArray(d.changes) ? d.changes : []).map(c => c.field)
  if (e.kind === 'reassigned') { meta.from_name = d.from_name; meta.to_name = d.to_name }
  Object.keys(meta).forEach(k => meta[k] == null && delete meta[k])
  return { id: `policy_event:${e.id}`, kind: correction ? 'outcome' : e.kind, at: e.at, lead_id: null, agent_id: e.agent_id, title: '', meta, agent_name: e.agent?.full_name }
}

export function useActivityFeed(day, agentId = null) {
  const start = new Date(day)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const startISO = start.toISOString()
  const endISO = end.toISOString()
  return useQuery({
    queryKey: ['activity-feed', startISO, agentId ?? 'visible'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('agent_activity_feed', { p_from: startISO, p_to: endISO, p_agent: agentId })
      if (error) {
        if (!isMissingFn(error)) throw error
        let q = supabase.from('policy_events').select(EVENT_SELECT).gte('at', startISO).lt('at', endISO).order('at', { ascending: false }).limit(1000)
        if (agentId) q = q.eq('agent_id', agentId)
        const fallback = await q
        if (fallback.error) throw fallback.error
        return { rows: (fallback.data || []).map(policyEventRow), fromFunction: false }
      }
      const rows = data || []
      const ids = agentId ? [] : [...new Set(rows.map(r => r.agent_id).filter(Boolean))]
      if (ids.length) {
        const { data: names } = await supabase.from('profiles').select('id, full_name').in('id', ids)
        const byId = new Map((names || []).map(p => [p.id, p.full_name]))
        rows.forEach(r => { r.agent_name = byId.get(r.agent_id) })
      }
      return { rows, fromFunction: true }
    },
    refetchInterval: 30e3,
  })
}

// Prompt 718 — one client's whole event history, oldest first, for the
// Activity page's client story. Same select and RLS as above.
export function usePolicyStory(policyId) {
  return useQuery({
    queryKey: ['policy-story', policyId],
    enabled: !!policyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_events')
        .select(EVENT_SELECT)
        .eq('policy_id', policyId)
        .order('at', { ascending: true })
        .limit(200)
      if (error) throw error
      return data || []
    },
    refetchInterval: 30e3,
  })
}
