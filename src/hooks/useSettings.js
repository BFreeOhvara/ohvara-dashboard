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

// ── Profile photo upload (Prompt 407) ────────────────────────────────────────
// `avatars` bucket (migration 096) is public + folder-scoped write RLS, same
// pattern as bug-screenshots (migration 089). Upsert to a fixed path per user
// so re-uploading replaces the old file instead of accumulating orphans; the
// public URL is cache-busted with a timestamp query param so the new photo
// shows immediately instead of the browser serving the old cached image at
// the same URL.
export function useUploadAvatar() {
  return useMutation({
    mutationFn: async ({ profileId, file }) => {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${profileId}/avatar.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      const avatar_url = `${publicUrl}?t=${Date.now()}`

      const { error: updateError } = await supabase.from('profiles').update({ avatar_url }).eq('id', profileId)
      if (updateError) throw updateError
      return avatar_url
    },
  })
}
