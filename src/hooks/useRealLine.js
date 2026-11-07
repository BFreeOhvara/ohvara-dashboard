import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invokeCallerId } from '../lib/callerId'
import { connectVoice } from '../lib/voiceDevice'
import { realLineApi, skewOf, offerRing } from '../lib/realLine'

// P882 — the VA phone on the real engine. null while calling is off (recovery_config.voice_live), so the P876 phone
// keeps its sample calls exactly as they are. On: a heartbeat every 10 s (va_beat: silent for 30 s takes the VA out
// of routing), the ring the server put on this VA (realtime on call_queue, the beat as the fallback), and the actions
// the phone's buttons send (realLineApi).
const BEAT_MS = 10000

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

// Who is signed in and whether calling is on, read straight from supabase: the VA shell also renders as a template
// preview with no AuthProvider or QueryClient, and there this stays null.
function useCallingOn() {
  const [me, setMe] = useState(null)
  useEffect(() => {
    let gone = false
    ;(async () => {
      const { data: { session } = {} } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) return
      const { data: prof } = await supabase.from('profiles').select('id, role').eq('id', uid).maybeSingle()
      if (!prof || !['fulfillment', 'admin'].includes(prof.role)) return
      const { data: cfg } = await supabase.from('recovery_config').select('voice_live').limit(1).maybeSingle()
      if (!gone && cfg?.voice_live) setMe(prof)
    })().catch(() => {})
    return () => { gone = true }
  }, [])
  return me
}

export function useRealLine() {
  const profile = useCallingOn()
  const live = !!profile
  const api = useMemo(() => realLineApi({ rpc, invoke: invokeCallerId, connect: connectVoice }), [])
  const [beat, setBeat] = useState(null)
  const want = useRef({ status: null, paused: null })

  useEffect(() => {
    if (!live) return undefined
    let gone = false
    const tick = () => {
      const { status, paused } = want.current
      want.current = { status: null, paused: null }
      api.beat(status, paused).then(r => { if (!gone) setBeat(r ? { ...r, skew: skewOf(r.server_now) } : null) }).catch(() => {})
    }
    tick()
    const t = setInterval(tick, BEAT_MS)
    const ch = supabase.channel(`va-offers-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_queue', filter: `offered_to=eq.${profile.id}` }, tick)
      .subscribe()
    return () => { gone = true; clearInterval(t); supabase.removeChannel(ch) }
  }, [live, api, profile?.id])

  if (!live) return null
  const skew = beat?.skew || 0
  return {
    ...api,
    presence: beat?.presence || null,
    offer: offerRing(beat?.offer, skew),
    skew,
    // Available / Away, and the task a ring paused: sent with the next beat (and at once).
    setStatus(status) { want.current.status = status; api.beat(status, null).then(r => r && setBeat({ ...r, skew: skewOf(r.server_now) })).catch(() => {}) },
    pauseTask(task) { want.current.paused = task },
  }
}
