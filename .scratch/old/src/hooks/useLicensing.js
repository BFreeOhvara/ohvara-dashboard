import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 392 — Licensing & Appointments (migration 091). Own-scope hooks for
// the logged-in agent's compliance data: state licenses (one-to-many),
// carrier appointment status, and the NPN/E&O fields living directly on
// profiles. Admin-wide views (Team page) can reuse the same `profileId`-scoped
// hooks by passing another agent's id — RLS lets admin through either way.

export function useAgentLicenses(profileId) {
  return useQuery({
    queryKey: ['agent-licenses', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_licenses')
        .select('*')
        .eq('profile_id', profileId)
        .order('state')
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
  })
}

export function useSaveAgentLicense(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('agent_licenses').update(fields).eq('id', id)
        : supabase.from('agent_licenses').insert({ ...fields, profile_id: profileId })
      const { data, error } = await q.select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-licenses', profileId] }),
  })
}

export function useDeleteAgentLicense(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('agent_licenses').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-licenses', profileId] }),
  })
}

// ── Carrier appointment status ──────────────────────────────────────────────
export function useAgentAppointments(profileId) {
  return useQuery({
    queryKey: ['agent-appointments', profileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_carrier_appointments')
        .select('*')
        .eq('profile_id', profileId)
      if (error) throw error
      return data || []
    },
    enabled: !!profileId,
  })
}

// Upsert on (profile_id, carrier_id) — one status row per agent per carrier,
// created lazily the first time a status is set rather than pre-seeded for
// every carrier.
export function useSetAgentAppointment(profileId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ carrierId, status, appointedOn }) => {
      const { data, error } = await supabase
        .from('agent_carrier_appointments')
        .upsert(
          { profile_id: profileId, carrier_id: carrierId, status, appointed_on: appointedOn ?? null },
          { onConflict: 'profile_id,carrier_id' }
        )
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-appointments', profileId] }),
  })
}
