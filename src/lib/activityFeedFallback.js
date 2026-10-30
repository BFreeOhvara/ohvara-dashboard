// The Activity feed's loader, kept free of the Supabase client import so it can be tested with a
// stand-in client. agent_activity_feed() (migration 185) may not exist, may not be callable by
// this role, or may raise while a table it reads is not there yet. None of that may surface on
// the page as an error: any rpc failure falls back to policy_events mapped to the same row
// shape, and only a failure of that fallback too is reported.

export const EVENT_SELECT = `
  id, policy_id, agent_id, kind, from_status, actor_name, actor_role, detail, at,
  policy:policies ( client_first_name, client_last_name, state, client_city, client_timezone ),
  agent:profiles!policy_events_agent_id_fkey ( full_name )
`
// If the embedded select is refused, the bare columns still give the day's rows.
const PLAIN_SELECT = 'id, policy_id, agent_id, kind, from_status, actor_name, actor_role, detail, at'

// Every rpc error falls back (404 / PGRST202 / 42883 missing function, 403 / 42501 no permission,
// PGRST205 / 42P01 schema or table not there, a bare or HTML 404 body, a dropped connection).
// A call the caller cancelled is the one thing that is not a failure of the rpc.
export const shouldUseFallback = error => !!error && error.name !== 'AbortError'

// A policy_events row as the rpc would return it. A corrected result is an outcome.
// Returns null for a row too odd to map, so one bad row never breaks the day.
export function policyEventRow(e) {
  try {
    const d = e.detail && typeof e.detail === 'object' ? e.detail : {}
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
    if (e.kind === 'edited') meta.changed_fields = (Array.isArray(d.changes) ? d.changes : []).map(c => c?.field).filter(Boolean)
    if (e.kind === 'reassigned') { meta.from_name = d.from_name; meta.to_name = d.to_name }
    Object.keys(meta).forEach(k => meta[k] == null && delete meta[k])
    if (!e.id || !e.at) return null
    return { id: `policy_event:${e.id}`, kind: correction ? 'outcome' : e.kind, at: e.at, lead_id: null, agent_id: e.agent_id, title: '', meta, agent_name: e.agent?.full_name }
  } catch {
    return null
  }
}

async function policyEventsFallback(client, startISO, endISO, agentId) {
  const run = select => {
    let q = client.from('policy_events').select(select).gte('at', startISO).lt('at', endISO).order('at', { ascending: false }).limit(1000)
    if (agentId) q = q.eq('agent_id', agentId)
    return q
  }
  let res = await run(EVENT_SELECT)
  if (res.error) res = await run(PLAIN_SELECT)
  if (res.error) throw res.error
  return { rows: (Array.isArray(res.data) ? res.data : []).map(policyEventRow).filter(Boolean), fromFunction: false }
}

// -> { rows, fromFunction }. Admin rows (no agentId) also get agent_name, best effort.
export async function fetchActivityFeed(client, startISO, endISO, agentId = null) {
  let res
  try {
    res = await client.rpc('agent_activity_feed', { p_from: startISO, p_to: endISO, p_agent: agentId })
  } catch (error) {
    res = { data: null, error }
  }
  if (res?.error) {
    if (!shouldUseFallback(res.error)) throw res.error
    return policyEventsFallback(client, startISO, endISO, agentId)
  }
  // postgrest-js reads a 404 with an empty body as a success with no data: the function is not there.
  if (!Array.isArray(res?.data)) return policyEventsFallback(client, startISO, endISO, agentId)
  const rows = res.data
  const ids = agentId ? [] : [...new Set(rows.map(r => r.agent_id).filter(Boolean))]
  if (ids.length) {
    try {
      const { data: names } = await client.from('profiles').select('id, full_name').in('id', ids)
      const byId = new Map((names || []).map(p => [p.id, p.full_name]))
      rows.forEach(r => { r.agent_name = byId.get(r.agent_id) })
    } catch { /* names are a nicety */ }
  }
  return { rows, fromFunction: true }
}
