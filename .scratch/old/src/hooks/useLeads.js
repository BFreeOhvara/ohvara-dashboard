import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMyLeads() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['leads', 'my', profile?.id],
    queryFn: async () => {
      // Show the rep's most recent batch instead of requiring an exact
      // match against an independently-computed "today". The old version
      // filtered on `batch_date = <UTC calendar date>`, which flips at UTC
      // midnight — but assign_daily_batches() (the cron that actually
      // advances batch_date) doesn't run until 06:05 UTC. That ~6h5m gap
      // made the dashboard render empty every night even though the
      // on-screen countdown still showed time remaining (see
      // brain/LIVE_STATE Prompt 195 in the vault for the full root cause).
      // Looking up the latest batch_date first means the rep always sees
      // their current batch until the cron genuinely supersedes it — this
      // also survives a delayed/failed cron run, not just the known window.
      const { data: latest, error: latestErr } = await supabase
        .from('leads')
        .select('batch_date')
        .eq('assigned_rep_id', profile.id)
        .not('batch_date', 'is', null)
        .order('batch_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latestErr) throw latestErr
      if (!latest) return []

      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('assigned_rep_id', profile.id)
        .eq('batch_date', latest.batch_date)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })
}

// Rep-facing "Request Leads" escape valve (Prompt 324) — mirrors the closer
// side's useRequestLeads (CloserLeads.jsx) but calls request_rep_leads
// (migration 071) and invalidates the same ['leads','my',repId] key useMyLeads
// reads, so a successful request shows up immediately without a manual refetch.
export function useRequestRepLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ repId, count }) => {
      const { data, error } = await supabase.rpc('request_rep_leads', {
        p_rep_id: repId,
        p_count: count,
      })
      if (error) throw error
      return data // number of leads assigned
    },
    onSuccess: (_, { repId }) => {
      qc.invalidateQueries({ queryKey: ['leads', 'my', repId] })
    },
  })
}

export function useAllLeads(filters = {}) {
  return useQuery({
    queryKey: ['leads', 'all', filters],
    queryFn: async () => {
      let query = supabase.from('leads').select(`
        *,
        assigned_rep:profiles!leads_assigned_rep_id_fkey(id, full_name),
        assigned_closer:profiles!leads_assigned_closer_id_fkey(id, full_name)
      `)

      if (filters.status) query = query.eq('status', filters.status)
      if (filters.rep_id) query = query.eq('assigned_rep_id', filters.rep_id)
      if (filters.source) query = query.eq('source', filters.source)
      if (filters.search) query = query.ilike('business_name', `%${filters.search}%`)

      query = query.order('created_at', { ascending: false }).limit(500)
      const { data, error } = await query
      if (error) throw error
      return data
    },
  })
}

export function useUpdateLeadStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadId, status, notes }) => {
      const { data, error } = await supabase
        .from('leads')
        .update({ status, notes })
        .eq('id', leadId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}

export function useLeadPipeline() {
  return useQuery({
    queryKey: ['leads', 'pipeline'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select(`
          id, business_name, contact_name, status, niche, city,
          assigned_rep:profiles!leads_assigned_rep_id_fkey(id, full_name),
          assigned_closer:profiles!leads_assigned_closer_id_fkey(id, full_name),
          updated_at
        `)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useBulkAssignLeads() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ leadIds, repId }) => {
      const { error } = await supabase
        .from('leads')
        .update({ assigned_rep_id: repId })
        .in('id', leadIds)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })
}
