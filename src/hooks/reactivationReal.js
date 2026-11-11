// P952/P957 — Reactivate old leads, the real side (same shape as template/reactivation.js SAMPLE_REACTIVATION).
// Functions from migrations 267 + 269. Lists are free; lead-spend reactivation_start checks the card and starts one.
// Each delivered appointment or live call is charged by the database itself (269 reactivation_bill).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { REACT_ATTEST_VERSION } from '../lib/reactivation.js'

// Any change (a list made, paid or removed) refreshes every open list view.
const subs = new Set()
const bump = () => subs.forEach(f => f())

const err = (e, fallback) => {
  const x = new Error(e?.message || fallback)
  x.code = e?.hint || e?.code
  return x
}

export const REAL_REACTIVATION = {
  source: 'real',
  useTerms() {
    const [t, setT] = useState({ loading: true })
    useEffect(() => {
      let on = true
      supabase.rpc('reactivation_terms').then(({ data, error }) => {
        if (!on) return
        // Not applied yet (migration 267) reads as "opens soon", never an error on the page.
        setT(error ? { loading: false, unavailable: true, licensed: [] } : { ...data, loading: false, unavailable: false })
      })
      return () => { on = false }
    }, [])
    return t
  },
  useLists() {
    const [s, setS] = useState({ lists: [], loading: true })
    const refresh = useCallback(async () => {
      const { data, error } = await supabase.rpc('my_reactivation_lists')
      setS({ lists: error ? [] : data || [], loading: false })
    }, [])
    useEffect(() => {
      refresh()
      subs.add(refresh)
      const t = setInterval(refresh, 60_000)
      return () => { clearInterval(t); subs.delete(refresh) }
    }, [refresh])
    return { ...s, refresh }
  },
  async create(name, rows, attest) {
    const { data, error } = await supabase.rpc('reactivation_create', { p_name: name, p_rows: rows, p_attest: !!attest, p_attest_version: REACT_ATTEST_VERSION })
    if (error) throw err(error, 'Couldn’t check the list. Try again.')
    bump()
    return data
  },
  // P957: lists are free. Start = the card check ($1 hold, released; 3-D Secure when the bank asks), then calling.
  // Returns { status: 'waiting_scrub', card } or throws { code: prepaid | shared_card | declined | no_card | card_owed … }.
  async start(listId) {
    const call = async pi => {
      const { data, error } = await supabase.functions.invoke('lead-spend', { body: { action: 'reactivation_start', list_id: listId, ...(pi ? { pi } : {}) } })
      if (error) {
        let detail = null
        try { detail = await error.context?.json?.() } catch { /* no body */ }
        const x = new Error(detail?.error || 'Couldn’t check the card. Try again.')
        x.code = detail?.code
        throw x
      }
      return data
    }
    try {
      let r = await call(null)
      if (r?.code === 'needs_action' && r.client_secret) {
        const { invokeBilling, getStripe } = await import('../lib/billing')
        const st = await invokeBilling('status')
        const stripe = await getStripe(st?.publishable_key)
        const { error } = await stripe.handleNextAction({ clientSecret: r.client_secret })
        if (error) { const x = new Error(error.message || 'Your bank didn’t confirm the card.'); x.code = 'declined'; throw x }
        r = await call(r.pi)
      }
      if (r?.ok === false) { const x = new Error(r.error || 'Couldn’t check the card.'); x.code = r.code; throw x }
      return r
    } finally { bump() }
  },
  async discard(listId) {
    const { error } = await supabase.rpc('reactivation_discard', { p_list: listId })
    if (error) throw err(error, 'Couldn’t remove the list.')
    bump()
  },
}
