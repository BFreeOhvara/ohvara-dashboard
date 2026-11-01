import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { fetchContactLog, normalizeEvents } from '../lib/clientPageLog'

// The client page's contact log and activity (read only). Rules live in src/lib/clientPageLog.js.
//   useClientContactLog({ policyIds, leadId, clientKey })  rpc contact_log (migration 199), newest first.
//     Returns { rows, notReady, isLoading, isError, refetch }. notReady is true while the function (or
//     the view that gives the client key) isn't on the database yet: show a quiet note, not an error.
//     Pass leadId for a lead's page, policyIds (or clientKey) for a client; both for a sold lead.
//   useClientEvents(policyIds)  policy_events for those policies, newest first, 50 at most.

const keyOf = ids => [...new Set((ids || []).filter(Boolean))].sort().join(',')

const lookupKeys = ids => supabase.from('policy_servicing_status').select('policy_id, client_key').in('policy_id', ids)

export function useClientContactLog({ policyIds = [], leadId = null, clientKey = null } = {}) {
  const ids = keyOf(policyIds)
  const q = useQuery({
    queryKey: ['client-contact-log', ids, leadId || '', clientKey || ''],
    enabled: !!(ids || leadId || clientKey),
    refetchInterval: 60000,
    queryFn: () => fetchContactLog({
      rpc: args => supabase.rpc('contact_log', args), lookupKeys, policyIds: ids ? ids.split(',') : [], leadId, clientKey,
    }),
  })
  return {
    rows: q.data?.rows || [], notReady: !!q.data?.notReady,
    isLoading: q.isLoading, isError: q.isError, refetch: () => q.refetch(),
  }
}

export function useClientEvents(policyIds = []) {
  const ids = keyOf(policyIds)
  const q = useQuery({
    queryKey: ['client-events', ids],
    enabled: !!ids,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase.from('policy_events')
        .select('id, policy_id, agent_id, kind, actor_name, actor_role, detail, at')
        .in('policy_id', ids.split(',')).order('at', { ascending: false }).limit(50)
      if (error) throw error
      return normalizeEvents(data)
    },
  })
  return { events: q.data || [], isLoading: q.isLoading, isError: q.isError, refetch: () => q.refetch() }
}
