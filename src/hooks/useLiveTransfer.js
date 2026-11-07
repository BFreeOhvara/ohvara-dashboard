import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { callTransfer, skewOf } from '../lib/liveTransfer'

// P880 — one transfer_checks row, live: realtime first, a 3 s refresh only while realtime isn't connected and the
// check is still moving. Returns [row, skewMs, setFromResponse].
export function useCheckRow(id, { asAgent = false } = {}) {
  const [row, setRow] = useState(null)
  const [skew, setSkew] = useState(0)
  const take = useCallback(res => {
    if (res?.check) { setRow(res.check); setSkew(skewOf(res.check.server_now)) }
    return res
  }, [])
  useEffect(() => {
    if (!id) return undefined
    let live = false
    let gone = false
    const refresh = () => callTransfer(supabase, 'status', { check_id: id }).then(r => !gone && take(r)).catch(() => {})
    refresh()
    const ch = supabase.channel(`transfer-check-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transfer_checks', filter: `id=eq.${id}` }, p => {
        if (!gone && p.new) setRow(r => ({ ...r, ...p.new, server_now: undefined }))
      })
      .subscribe(s => { live = s === 'SUBSCRIBED' })
    const t = setInterval(() => {
      if (!live && document.visibilityState === 'visible') refresh()
    }, 3000)
    return () => { gone = true; clearInterval(t); supabase.removeChannel(ch) }
  }, [id, asAgent, take])
  // A row from an earlier check never shows for a new one.
  return [id && row?.id === id ? row : null, skew, take]
}

// The VA phone on a REAL call (one help-voice put through: call.callSid). Sample calls get null and keep P876's
// sample timers. P882 sets call.callSid / call.who.leadId when it wires real calls into the phone.
export function useRealXfer(call) {
  const callSid = call?.callSid || call?.who?.callSid || null
  const [checkId, setCheckId] = useState(null)
  const [refused, setRefused] = useState(null)
  const [row, skew, take] = useCheckRow(callSid ? checkId : null)
  const ended = !!call?.end
  const rowRef = useRef(row)
  useEffect(() => { rowRef.current = row }, [row])

  // The VA's leg ended while the check was still out: cancel it, so the push is replaced and a callback is made.
  useEffect(() => {
    const r = rowRef.current
    if (ended && r && ['sent', 'seen', 'yes', 'late_yes'].includes(r.status)) {
      callTransfer(supabase, 'cancel', { check_id: r.id, why: 'va_left' }).catch(() => {})
    }
  }, [ended])

  if (!callSid) return null
  return {
    row, skew, refused,
    async check() {
      setRefused(null)
      const res = await callTransfer(supabase, 'check', { call_sid: callSid, lead_id: call?.who?.leadId || undefined })
      if (res?.check) { setCheckId(res.check.id); take(res) } else setRefused(res?.code || 'fail')
      return res
    },
    transfer: () => callTransfer(supabase, 'transfer', { check_id: checkId }).then(take),
    book: bookedFor => callTransfer(supabase, 'book', { check_id: checkId || undefined, call_sid: callSid, booked_for: bookedFor || undefined }).then(take),
    clear: () => { setCheckId(null); setRefused(null) },
  }
}

// Is this agent reachable for live calls? (VA's agent list, the agent's own card.)
export async function readReach(agentId) {
  const { data, error } = await supabase.rpc('transfer_reach', { p_agent: agentId })
  if (error) return null
  return Array.isArray(data) ? data[0] : data
}
