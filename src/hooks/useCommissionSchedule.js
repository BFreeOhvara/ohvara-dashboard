import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Real Compensation Grid data (migration 086, Prompt 370) — Brayden's own
// Eterna (IMO platform) contract data, normalized to one row per
// carrier+product+tier. Table holds ~2,860 rows across 12 carriers, well
// past PostgREST's default 1000-row cap, so this explicitly ranges past it.
export function useCommissionSchedule() {
  return useQuery({
    queryKey: ['commission-schedule'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_schedule')
        .select('*')
        .order('carrier')
        .order('product')
        .order('tier')
        .range(0, 4999)
      if (error) throw error
      return data || []
    },
  })
}
