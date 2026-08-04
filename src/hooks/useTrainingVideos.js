import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Training Center Videos tab (Prompt 417, migration 101). Flat admin-managed
// directory, same access shape as useCarriers.js -- everyone reads, only
// public.is_admin() writes.

export function useTrainingVideos() {
  return useQuery({
    queryKey: ['training-videos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_videos')
        .select('*')
        .order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}

export function useAddTrainingVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fields) => {
      const { data, error } = await supabase.from('training_videos').insert(fields).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-videos'] }),
  })
}

export function useDeleteTrainingVideo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('training_videos').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-videos'] }),
  })
}

// Swaps sort_order between two adjacent rows -- the whole reorder surface is
// a handful of rows with up/down arrows, so a two-row swap is simpler than a
// full re-sequence RPC.
export function useSwapTrainingVideoOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ a, b }) => {
      const { error: e1 } = await supabase.from('training_videos').update({ sort_order: b.sort_order }).eq('id', a.id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('training_videos').update({ sort_order: a.sort_order }).eq('id', b.id)
      if (e2) throw e2
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['training-videos'] }),
  })
}
