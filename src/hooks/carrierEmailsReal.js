// P1027 — Connect carrier emails, the real side (same shape as template/carrierEmails.js SAMPLE_CARRIER_EMAILS).
// Functions from migration 284: my_carrier_emails, set_my_notice_carriers, start_my_carrier_email_test,
// rotate_my_payment_intake_address. Before 284 is applied the card reads as "opens soon", never an error.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

const err = (e, fallback) => new Error(e?.message || fallback)

export const REAL_CARRIER_EMAILS = {
  source: 'real',
  useCarrierEmails() {
    const [s, setS] = useState({ data: null, loading: true, unavailable: false })
    const on = useRef(true)
    const refresh = useCallback(async () => {
      const { data, error } = await supabase.rpc('my_carrier_emails')
      if (!on.current) return
      setS(error ? { data: null, loading: false, unavailable: true } : { data, loading: false, unavailable: false })
    }, [])
    useEffect(() => { on.current = true; refresh(); return () => { on.current = false } }, [refresh])

    // While a test is waiting (or Gmail's code is due), look again every 5 s for up to 3 minutes.
    const waiting = !!s.data?.test_started_at && !s.data?.test_ok
    useEffect(() => {
      if (!waiting) return undefined
      const started = Date.now()
      const t = setInterval(() => { if (Date.now() - started > 180000) clearInterval(t); else refresh() }, 5000)
      return () => clearInterval(t)
    }, [waiting, refresh])

    const saveCarriers = useCallback(async list => {
      const { data, error } = await supabase.rpc('set_my_notice_carriers', { p: list })
      if (error) throw err(error, 'Could not save your carriers')
      await refresh()
      return data
    }, [refresh])
    const startTest = useCallback(async () => {
      const { error } = await supabase.rpc('start_my_carrier_email_test')
      if (error) throw err(error, 'Could not start the test')
      await refresh()
    }, [refresh])
    const rotate = useCallback(async () => {
      const { data, error } = await supabase.rpc('rotate_my_payment_intake_address')
      if (error) throw err(error, 'Could not make a new address')
      await refresh()
      return data
    }, [refresh])
    return { ...s, refresh, saveCarriers, startTest, rotate }
  },
}
