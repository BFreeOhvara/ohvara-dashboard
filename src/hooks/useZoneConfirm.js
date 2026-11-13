import { useCallback } from 'react'
import { useOptionalAuth } from './authContext'
import { supabase } from '../lib/supabase'

// P989 — marks the signed-in user's time zone as picked (profiles.timezone + timezone_confirmed_at), then reloads the
// profile so every screen reads the new zone. Used by the phone apps' time zone prompt (src/template/m/zone.jsx),
// which can't talk to the backend itself. Real data only; the caller decides when.
export function useZoneConfirm() {
  const { profile, refreshProfile } = useOptionalAuth() || {} // the sample template runs with no sign-in
  const id = profile?.id
  return {
    confirmed: !!profile?.timezone_confirmed_at,
    signedIn: !!id,
    confirm: useCallback(async zone => {
      if (!id) return
      const { error } = await supabase.from('profiles').update({ timezone: zone, timezone_confirmed_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      refreshProfile?.()
    }, [id, refreshProfile]),
  }
}
