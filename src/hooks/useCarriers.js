import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Carrier directory behind the Carrier Portals page (migration 072, real
// data seeded in 078 per Prompt 331). Admin can still add/remove carriers
// from the page itself for anything not in the seeded set.

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
