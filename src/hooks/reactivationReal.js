// P952 — Reactivate old leads, the real side (same shape as template/reactivation.js SAMPLE_REACTIVATION).
// Functions from migration 267; the charge goes through lead-spend (action reactivation_pay, statement OHVARA LEADS).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
    const { data, error } = await supabase.rpc('reactivation_create', { p_name: name, p_rows: rows, p_attest: !!attest, p_attest_version: 'p952-v1' })
    if (error) throw err(error, 'Couldn’t check the list. Try again.')
    bump()
    return data
  },
  async pay(listId) {
    const { data, error } = await supabase.functions.invoke('lead-spend', { body: { action: 'reactivation_pay', list_id: listId } })
    if (error) {
      let detail = null
      try { detail = await error.context?.json?.() } catch { /* no body */ }
      const x = new Error(detail?.error || 'Couldn’t charge the card. Try again.')
      x.code = detail?.code
      bump()
      throw x
    }
    bump()
    return data
  },
  async discard(listId) {
    const { error } = await supabase.rpc('reactivation_discard', { p_list: listId })
    if (error) throw err(error, 'Couldn’t remove the list.')
    bump()
  },
}
