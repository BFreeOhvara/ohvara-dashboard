// P952 — Reactivate old leads, the admin side. Sample store + the real calls (migration 267: admin_reactivation_view,
// admin_reactivation_settings_save, admin_reactivation_pause). Not applied yet → the page says so, never an error.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { listQuality, REACT_DEFAULTS } from '../lib/reactivation.js'

const p = o => ({ total: 0, worked: 0, reached: 0, booked: 0, transferred: 0, stop: 0, not_interested: 0, wrong: 0, remaining: 0, removed: 0, ...o })
const SEED = {
  settings: { price_cents: 200, min_leads: 100, max_attempts: 5, pause_stop_rate: 0.05, pause_min_reached: 20, scrub_provider: 'none', live: false, numbers: 1 },
  lists: [
    { id: 'rl-1', name: '2024 mortgage leads', status: 'working', agent: 'Marcus Webb', created_at: '2026-10-28T15:00:00Z', uploaded: 512, callable: 480, amount_cents: 96000, refunded_cents: 0, cost_cents: 7420,
      progress: p({ total: 480, worked: 312, reached: 96, booked: 14, transferred: 6, stop: 3, not_interested: 21, wrong: 7, remaining: 168 }) },
    { id: 'rl-3', name: 'Facebook leads 2023', status: 'paused', agent: 'Tasha Greene', created_at: '2026-11-01T15:00:00Z', uploaded: 230, callable: 204, amount_cents: 40800, refunded_cents: 600, cost_cents: 1860,
      paused_at: '2026-11-02T18:20:00Z', pause_reason: '3 of 22 people reached asked us to stop calling (14%, the limit is 5%)',
      progress: p({ total: 201, worked: 88, reached: 22, booked: 2, transferred: 0, stop: 3, not_interested: 6, wrong: 9, remaining: 113 }) },
    { id: 'rl-2', name: 'Spring aged leads', status: 'done', agent: 'Marcus Webb', created_at: '2026-09-14T15:00:00Z', uploaded: 140, callable: 126, amount_cents: 25200, refunded_cents: 400, cost_cents: 2980,
      progress: p({ total: 124, worked: 124, reached: 41, booked: 5, transferred: 2, stop: 1, not_interested: 9, wrong: 4, remaining: 0 }) },
  ],
}
let sample = structuredClone(SEED)
const subs = new Set()
const put = next => { sample = next; subs.forEach(f => f()) }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }
const snap = () => sample

// Settings in the shape lib/reactivation.js reads.
export const rulesOf = s => ({ ...REACT_DEFAULTS, priceCents: s?.price_cents, minLeads: s?.min_leads, maxAttempts: s?.max_attempts, pauseStopRate: Number(s?.pause_stop_rate), pauseMinReached: s?.pause_min_reached })
export const qualityOf = (l, s) => listQuality(l.progress || p(), rulesOf(s))

export function useAdmReactivation(src) {
  const local = useSyncExternalStore(subscribe, snap)
  const [real, setReal] = useState({ loading: true })
  const refresh = useCallback(async () => {
    if (src !== 'real') return
    const { data, error } = await supabase.rpc('admin_reactivation_view')
    setReal(error ? { missing: true, settings: null, lists: [] } : { ...data, loading: false })
  }, [src])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh() }, [refresh])
  const view = src === 'real' ? real : local
  const save = async next => {
    if (src !== 'real') { put({ ...sample, settings: { ...sample.settings, ...next } }); return }
    const { error } = await supabase.rpc('admin_reactivation_settings_save', { p_price_cents: next.price_cents, p_min_leads: next.min_leads,
      p_max_attempts: next.max_attempts, p_pause_stop_rate: next.pause_stop_rate, p_pause_min_reached: next.pause_min_reached })
    if (error) throw new Error(error.message || 'Couldn’t save.')
    await refresh()
  }
  const pause = async (id, on) => {
    if (src !== 'real') {
      put({ ...sample, lists: sample.lists.map(l => (l.id === id ? { ...l, status: on ? 'paused' : 'working', pause_reason: on ? 'Paused by an admin' : null, paused_at: on ? new Date().toISOString() : null } : l)) })
      return
    }
    const { error } = await supabase.rpc('admin_reactivation_pause', { p_list: id, p_pause: on })
    if (error) throw new Error(error.message || 'Couldn’t change the list.')
    await refresh()
  }
  return { ...view, refresh, save, pause }
}

// Admin to-dos: a list that paused itself (too many "stop calling").
export const pausedLists = view => (view?.lists || []).filter(l => l.status === 'paused')
export const resetAdmReactivation = () => put(structuredClone(SEED))
