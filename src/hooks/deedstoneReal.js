// P916 — Deedstone calling for the agent portal, the real side (same shape as template/deedstone.js SAMPLE_DEEDSTONE).
// fulfillment-call places the calls; the phone and the call rows come from migration 255's functions and RLS.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { callDeedstone, callBody, e164 } from '../lib/deedstoneCall'

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
const words = { bad_phone: 'Enter a 10-digit US phone number.' }

export const REAL_DEEDSTONE = {
  source: 'real',
  usePhone() {
    const [s, setS] = useState({ phone: null, pending: false, pendingPhone: null, loading: true })
    const refresh = useCallback(async () => {
      const { data, error } = await supabase.rpc('my_deedstone_phone')
      // Not applied yet (migration 255) reads as not connected, never an error on the page.
      if (error) { setS({ phone: null, pending: false, pendingPhone: null, loading: false }); return }
      setS({ phone: data?.phone ?? null, pending: !!data?.pending, pendingPhone: data?.pending_phone ?? null, loading: false })
    }, [])
    useEffect(() => { refresh() }, [refresh])
    return { ...s, refresh }
  },
  async sendCode(phone) {
    const e = e164(phone)
    if (!e) { const err = new Error(words.bad_phone); err.code = 'bad_phone'; throw err }
    return callDeedstone(supabase, 'verify_phone', { phone: e })
  },
  async confirm(code) {
    const { data, error } = await supabase.rpc('deedstone_code_confirm', { p_code: String(code) })
    if (error) throw new Error('Couldn’t check the code. Try again.')
    return data
  },
  async disconnect() {
    const { error } = await supabase.rpc('deedstone_phone_disconnect')
    if (error) throw new Error('Couldn’t disconnect. Try again.')
  },
  call: target => callDeedstone(supabase, 'agent_call', callBody(target)),
  hangup: id => callDeedstone(supabase, 'agent_hangup', { call_id: id }),
  useCall(id) {
    const [row, setRow] = useState(null)
    useEffect(() => {
      if (!id) { setRow(null); return undefined }
      let alive = true
      let t = null
      const read = async () => {
        const { data } = await supabase.from('deedstone_calls').select('status, end_reason').eq('id', id).maybeSingle()
        if (!alive) return
        if (data) setRow(data)
        if (data?.status !== 'ended') t = setTimeout(read, 1500)
      }
      read()
      return () => { alive = false; clearTimeout(t) }
    }, [id])
    return row
  },
}
