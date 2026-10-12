import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useRecoveryConfig } from '../hooks/useRecoveryConfig'
import { useStartCall } from '../hooks/usePolicies'
import { useCarriers } from '../hooks/useCarriers'
import { invokeCallerId } from '../lib/callerId'
import { connectVoice, micState, askForMic } from '../lib/voiceDevice'
import { bookingCarrier } from '../lib/carriers'
import { fullName } from '../lib/policyFormat'
import { everyoneGone } from '../lib/portalPhone'
import { PortalPhone } from '../components/fulfillment/PortalPhone'
import { PhoneContext } from './portalPhone'

// Prompt 751 — the pop-up phone. One call at a time, owned here (above the
// routes, so it stays up while the rep moves between pages). "Call client"
// opens it: the rep's browser joins the policy's Twilio conference, then the
// client is rung. While recovery_config.voice_live is off it opens as a
// preview and Call client keeps its old path.
//
// mode: preview | mic (asking for the microphone) | connecting | call | result

export function PortalPhoneProvider({ children, voice = connectVoice }) {
  const { profile } = useAuth()
  const can = profile?.role === 'fulfillment' || profile?.role === 'admin'
  const { data: cfg } = useRecoveryConfig({ enabled: can })
  const voiceLive = !!cfg?.voice_live
  const { data: carriers } = useCarriers()
  const startCall = useStartCall()
  const qc = useQueryClient()

  const [s, setS] = useState(null)          // { p, mode, collapsed, joinedAt, endedAt }
  const [muted, setMuted] = useState(false)
  const [answered, setAnswered] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [devices, setDevices] = useState(null)
  const [ignore, setIgnore] = useState(() => new Set())   // legs from earlier calls on this policy
  const line = useRef(null)
  const ended = useRef(false)

  const p = s?.p || null
  const carrier = bookingCarrier(carriers, p)
  const names = useMemo(() => ({ client: p ? fullName(p) : '', carrier: carrier?.name || p?.current_carrier || p?.carrier_name || 'Carrier' }), [p, carrier])

  const legsQ = useQuery({
    queryKey: ['voice-legs', p?.id],
    enabled: !!p && (s.mode === 'call' || s.mode === 'connecting'),
    refetchInterval: 1500,
    queryFn: async () => {
      const { data, error: e } = await supabase.from('fulfillment_voice_legs')
        .select('call_sid, party, status, on_hold, hold_since, started_at, answered_at, ended_at')
        .eq('policy_id', p.id).order('started_at')
      if (e) throw e
      return data
    },
  })
  const legs = useMemo(() => (legsQ.data || []).filter(l => !ignore.has(l.call_sid)), [legsQ.data, ignore])

  const finish = useCallback(() => {
    if (ended.current) return
    ended.current = true
    line.current?.hangUp()
    line.current?.destroy()
    line.current = null
    setMuted(false)
    setDevices(null)
    setS(x => (x ? { ...x, mode: 'result', collapsed: false, endedAt: Date.now() } : x))
    qc.invalidateQueries({ queryKey: ['policies'] })
  }, [qc])

  const send = useCallback(async (action, extra) => {
    if (!p) return
    setBusy(action)
    setError(null)
    try {
      await invokeCallerId('fulfillment-call', { policy_id: p.id, action, ...extra })
      await legsQ.refetch()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }, [p, legsQ])

  const start = useCallback(async pol => {
    ended.current = false
    setS(x => ({ ...x, mode: 'connecting' }))
    try {
      const { data: prior } = await supabase.from('fulfillment_voice_legs').select('call_sid').eq('policy_id', pol.id)
      setIgnore(new Set((prior || []).map(r => r.call_sid)))
      await startCall.mutateAsync(pol.id)        // the call goes live (timeline, counts, "On a call")
      line.current = await voice({
        policyId: pol.id,
        onAccept: () => {
          setS(x => (x ? { ...x, mode: 'call', joinedAt: Date.now() } : x))
          setDevices(line.current?.devices() || null)
          invokeCallerId('fulfillment-call', { policy_id: pol.id, action: 'ring_client' })
            .catch(e => setError(e.message))
            .finally(() => qc.invalidateQueries({ queryKey: ['voice-legs', pol.id] }))
        },
        onEnd: () => finish(),
        onError: e => setError(e?.message || 'The call had a problem.'),
      })
    } catch (e) {
      setError(e.message || 'Couldn\'t start the call.')
      setS(x => (x ? { ...x, mode: 'result', endedAt: Date.now() } : x))
    }
  }, [startCall, voice, finish, qc])

  // Everyone hung up: end the conference and ask how it went.
  useEffect(() => {
    if (s?.mode === 'call' && everyoneGone(legs)) {
      invokeCallerId('fulfillment-call', { policy_id: s.p.id, action: 'end_all' }).catch(() => {})
      finish()
    }
  }, [s, legs, finish])

  const open = useCallback(async pol => {
    if (!can || !pol) return false
    // A call is already up (this one or another): just bring the phone back.
    if (s && s.mode !== 'preview') { setS(x => ({ ...x, collapsed: false })); return s.p.id === pol.id }
    setError(null)
    setAnswered(false)
    if (!voiceLive) { setS({ p: pol, mode: 'preview', collapsed: false }); return true }
    setS({ p: pol, mode: 'connecting', collapsed: false })
    if ((await micState()) !== 'granted') { setS({ p: pol, mode: 'mic', collapsed: false }); return true }
    start(pol)
    return true
  }, [can, s, voiceLive, start])

  const allowMic = useCallback(async () => {
    try { await askForMic(); start(s.p) } catch { setError('Your browser blocked the microphone. Allow it from the address bar, then try again.') }
  }, [s, start])

  const press = useCallback(async (act, extra) => {
    if (!act) return
    if (act === 'mute') { const on = !muted; line.current?.mute(on); setMuted(on); return }
    if (act === 'swap' || act === 'merge') setAnswered(true)
    if (act === 'ring_client' && legs.some(l => l.party === 'carrier' && l.status === 'live')) setAnswered(true)
    if (act === 'end_all') { await send('end_all'); finish(); return }
    await send(act, extra)
  }, [muted, legs, send, finish])

  const pickDevice = useCallback(async (kind, id) => {
    try { await (kind === 'input' ? line.current?.setInput(id) : line.current?.setOutput(id)) } catch { setError("Couldn't switch to that device.") }
    setDevices(line.current?.devices() || null)
  }, [])

  const close = useCallback(() => { setS(null); setError(null); setAnswered(false) }, [])
  const collapse = useCallback(on => setS(x => (x ? { ...x, collapsed: on } : x)), [])

  // Leaving the portal (sign out) drops the line.
  useEffect(() => { if (!can && line.current) finish() }, [can, finish])
  useEffect(() => () => { line.current?.destroy() }, [])

  const ctx = useMemo(() => ({ voiceLive, open, activeId: s && s.mode !== 'preview' ? s.p.id : null }), [voiceLive, open, s])

  return (
    <PhoneContext.Provider value={ctx}>
      {children}
      {can && s && (
        <PortalPhone
          s={s} names={names} legs={legs} answered={answered} muted={muted} busy={busy} error={error}
          canRingCarrier={!!carrier?.service_phone} devices={devices} onDevice={pickDevice}
          onPress={press} onAllowMic={allowMic} onCollapse={collapse} onClose={close}
        />
      )}
    </PhoneContext.Provider>
  )
}
