import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Meta mortgage-protection leads delivered to this agent (migration 161). RLS
// already limits mp_leads to assigned_agent_id = auth.uid() (admin sees all),
// so the explicit filter is for admins who open the page: they see their own.
const LEAD_COLS = 'id, created_at, first_name, last_name, phone, email, state, age_band, mortgage_balance_band, homeowner, smoker, best_time, status, assigned_at'

export function useMpLeads() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['mp_leads', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mp_leads')
        .select(LEAD_COLS)
        .eq('assigned_agent_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })
}

// Agents may change status only (column grant), to assigned/contacted/closed/bad.
export function useUpdateMpLeadStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('mp_leads').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mp_leads'] }),
  })
}

export function useLeadSettings() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['agent_lead_settings', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_lead_settings')
        .select('active, states, daily_cap')
        .eq('agent_id', profile.id)
        .maybeSingle()
      if (error) throw error
      return data || null // null = no row yet (first save inserts)
    },
    enabled: !!profile?.id,
  })
}

// Insert the agent's first row, update after that. Not an upsert: agent_id is
// not in the update column grant, and an upsert would try to set it.
export function useSaveLeadSettings() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ patch, exists }) => {
      const q = supabase.from('agent_lead_settings')
      const { error } = exists
        ? await q.update({ ...patch, updated_at: new Date().toISOString() }).eq('agent_id', profile.id)
        : await q.insert({ agent_id: profile.id, ...patch })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent_lead_settings'] }),
  })
}
