import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMyLeads() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['leads', 'my', profile?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('assigned_rep_id', profile.id)
        .eq('batch_date', today)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
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
