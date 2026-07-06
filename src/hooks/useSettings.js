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

// Supabase Auth password change — separate from rep_credentials (041,
// admin-only plaintext lookup table). Changing here does NOT update that
// table; a rep's admin-visible "View Login" password can go stale after a
// self-service change. Known tradeoff, not fixed by this prompt.
export function useChangeOwnPassword() {
  return useMutation({
    mutationFn: async (newPassword) => {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
    },
  })
}
