import { createClient } from '@supabase/supabase-js'

// Prompt 720 — checks a password without touching the live session. Signing
// in again on the app's own client would replace the session, and an aal2
// session (two-step passed) would drop to aal1 and send the user back to the
// code screen. This throwaway client keeps nothing: no storage, no refresh,
// and it signs its own session out locally (the live session is untouched).
export async function verifyPassword(email, password) {
  const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ohvara-verify' },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (!error) await client.auth.signOut({ scope: 'local' })
  return !error
}
