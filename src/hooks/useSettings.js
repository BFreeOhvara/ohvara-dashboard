import { useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Own-profile self-service updates (Prompt 226 Settings page) ─────────────
// profiles_update_self RLS (migration 009) already lets a user write any
// column on their own row — no new policy needed, no edge function needed.
export function useUpdateOwnProfile() {
  return useMutation({
    mutationFn: async ({ profileId, updates }) => {
      const { error } = await supabase.from('profiles').update(updates).eq('id', profileId)
      if (error) throw error
    },
  })
}
