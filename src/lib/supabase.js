import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: window.localStorage,
  },
})

// Prompt 320 — ask the browser to exempt this origin's storage from
// eviction under storage pressure. Mainly targets iOS Safari, which is
// documented to clear localStorage/IndexedDB for installed home-screen PWAs
// under low-disk-space or long-inactivity conditions even though the site
// itself never expires the session token — this doesn't guarantee
// persistence (Safari's own heuristics still decide), but it's the
// standards-based signal a browser uses to prioritize what NOT to clear.
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}
