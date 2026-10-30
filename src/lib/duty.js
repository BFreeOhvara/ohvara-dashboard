// Active for live transfers (Goal 7, Agent Portal Rework step 4). An agent flips their own
// row in public.agent_duty from Today or Settings → Client contact; an admin sees who is
// active through public.on_duty_agents() (migration 174). No on/off flag in code: the switch is
// live when agent_duty answers and says "Coming soon" while the table is missing, so it turns
// on by itself once 174 is applied.

// True when the table or function isn't in the database yet (PostgREST
// PGRST205 / PGRST202, Postgres 42P01 / 42883), so the card and the list
// render nothing instead of an error.
export const isDutyMissing = e =>
  !!e && ['PGRST205', 'PGRST202', '42P01', '42883'].includes(e.code)

export const dutyKey = id => ['agent-duty', id]

// The signed-in agent's own row, or null (no row means not active).
export async function readMyDuty(db, id) {
  const { data, error } = await db.from('agent_duty').select('on_duty, since').eq('agent_id', id).maybeSingle()
  if (error) throw error
  return data
}

// What useAgentDuty hands to useMutation. Writes only the signed-in agent's own row:
// agent_id is always the auth user id, never one passed in. Optimistic (since reads
// "now" until the server's stamp comes back); a failed save rolls back.
export function dutyMutation({ db, qc, id, now = () => new Date().toISOString() }) {
  const key = dutyKey(id)
  return {
    mutationFn: async on => {
      if (!id) throw new Error('Not signed in')
      const { error } = await db.from('agent_duty').upsert({ agent_id: id, on_duty: on }, { onConflict: 'agent_id' })
      if (error) throw error
    },
    onMutate: async on => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, row => ({ ...row, on_duty: on, since: on ? (row?.on_duty ? row.since : now()) : null }))
      return { prev }
    },
    onError: (_e, _on, ctx) => qc.setQueryData(key, ctx?.prev ?? null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  }
}

// One shape for every screen: { on, since, soon, loading, failed }. soon = agent_duty isn't
// there yet; failed = it is, but this read went wrong.
export function dutyState(query, save) {
  const soon = isDutyMissing(query?.error) || isDutyMissing(save?.error)
  const failed = !soon && !!query?.error
  const on = !soon && !failed && query?.data?.on_duty === true
  return { on, since: on ? query.data.since ?? null : null, soon, loading: !!query?.isLoading, failed }
}

// "3:15 PM" today, "Oct 27, 3:15 PM" on an earlier day; Central unless the agent's zone is given.
export function dutySince(iso, now = new Date(), tz = 'America/Chicago') {
  if (!iso) return ''
  const d = new Date(iso)
  const day = x => x.toLocaleDateString('en-US', { timeZone: tz })
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return day(d) === day(now) ? time : `${d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })}, ${time}`
}
