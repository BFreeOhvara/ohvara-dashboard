import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Real Compensation Grid data (migration 086, Prompt 370) — Brayden's own
// Eterna (IMO platform) contract data, normalized to one row per
// carrier+product+tier. Table holds ~2,860 rows across 12 carriers.
//
// Prompt 377: a single `.range(0, 4999)` request does NOT get past
// PostgREST's default 1000-row cap — that cap is a server-side
// `db.max_rows` project setting that silently clamps every response
// regardless of the requested range, so the grid was quietly missing its
// last ~1,860 rows (Foresters, Mutual of Omaha, National Life Group,
// Transamerica — everything ordered after Fidelity Life). What looked like
// "MOO"/"NLG" abbreviations were actually those carriers being cut off
// entirely, not mislabeled — the `commission_schedule` and `carriers`
// tables both already use full names. Paginating in PAGE_SIZE-sized
// requests until a short page comes back is the client-side fix, since the
// row cap isn't something this app's own tools can change.
const PAGE_SIZE = 1000

export function useCommissionSchedule() {
  return useQuery({
    queryKey: ['commission-schedule'],
    queryFn: async () => {
      const rows = []
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('commission_schedule')
          .select('*')
          .order('carrier')
          .order('product')
          .order('tier')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        rows.push(...data)
        if (data.length < PAGE_SIZE) break
      }
      return rows
    },
  })
}
