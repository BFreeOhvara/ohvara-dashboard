import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Carrier directory behind the Carrier Portals page (migration 072).
//
// Ships EMPTY on purpose. Which carriers Nate/Jordan/Rego are actually
// appointed with — and their real portal URLs and new-business / agent-service
// numbers — is an open question flagged back to Brayden (Prompt 326). Admin
// enters the real rows from the page itself rather than the app shipping
// invented carriers that look real.

export function useCarriers() {
  return useQuery({
    queryKey: ['carriers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .order('name')
      if (error) throw error
      return data || []
    },
  })
}

export function useSaveCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }) => {
      const q = id
        ? supabase.from('carriers').update(fields).eq('id', id)
        : supabase.from('carriers').insert(fields)
      const { data, error } = await q.select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carriers'] }),
  })
}

export function useDeleteCarrier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('carriers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['carriers'] }),
  })
}
