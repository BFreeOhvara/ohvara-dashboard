import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

// Prompt 781 — "Keep me signed in" on the sign-in card. Ticked (the default,
// and always in the phone app): the session lives in localStorage like
// before. Unticked: it lives in sessionStorage, so closing the browser signs
// you out. Reads check both, so a session from before this change still works.
const KEEP_KEY = 'ohvara-keep-signed-in'

export function setKeepSignedIn(keep) {
  try { localStorage.setItem(KEEP_KEY, keep ? '1' : '0') } catch { /* private mode */ }
}
export function keepSignedIn() {
  if (Capacitor.isNativePlatform()) return true
  try { return localStorage.getItem(KEEP_KEY) !== '0' } catch { return true }
}

const authStorage = {
  getItem(k) {
    try { return sessionStorage.getItem(k) ?? localStorage.getItem(k) } catch { return null }
  },
  setItem(k, v) {
    try {
      if (keepSignedIn()) { localStorage.setItem(k, v); sessionStorage.removeItem(k) }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k) }
    } catch { /* storage blocked */ }
  },
  removeItem(k) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
    try { sessionStorage.removeItem(k) } catch { /* ignore */ }
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { storage: authStorage } })
