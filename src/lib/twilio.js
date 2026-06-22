// ============================================================
// Twilio — bridge call with recording
//
// Replaces the old browser-dialer stub. Reps still use their own
// phone; the bridge pattern has Twilio ring the rep first, then
// connects them to the lead while recording both channels.
//
// Requires: TWILIO_* secrets set in Supabase + profiles.phone set
// for the rep (migration 045). Falls back to tel: link if either
// is missing — see CallModal.jsx.
// ============================================================

import { supabase } from './supabase'

export async function bridgeCall(repPhone, leadPhone) {
  const { data, error } = await supabase.functions.invoke('twilio-call', {
    body: { repPhone, leadPhone },
  })
  if (error) throw error
  return data
}
