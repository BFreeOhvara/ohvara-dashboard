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

// ── Remove avatar (Prompt 422) ───────────────────────────────────────────────
// Deletes the stored file(s) too, not just the column — otherwise every
// removal leaves an orphaned object in the bucket. Lists the user's own
// folder rather than assuming a fixed extension, since a re-upload can swap
// file type between sessions (upload's upsert-by-fixed-path only avoids
// orphans when the extension stays the same).
export function useRemoveAvatar() {
  return useMutation({
    mutationFn: async ({ profileId }) => {
      const { data: files, error: listError } = await supabase.storage
        .from('avatars')
        .list(profileId)
      if (listError) throw listError

      if (files?.length) {
        const paths = files.map(f => `${profileId}/${f.name}`)
        const { error: removeError } = await supabase.storage.from('avatars').remove(paths)
        if (removeError) throw removeError
      }

      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', profileId)
      if (updateError) throw updateError
    },
  })
}
