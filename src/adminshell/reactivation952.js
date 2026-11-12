// P952 — Reactivate old leads, the admin side. Sample store + the real calls (migration 267: admin_reactivation_view,
// admin_reactivation_settings_save, admin_reactivation_pause; P957 269 adds accounts, the per-delivery price and the
// new-account limits). Not applied yet → the page says so, never an error.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import { listQuality, REACT_DEFAULTS } from '../lib/reactivation.js'

const p = o => ({ total: 0, worked: 0, reached: 0, booked: 0, transferred: 0, stop: 0, not_interested: 0, wrong: 0, remaining: 0, removed: 0, ...o })
const SEED = {
  settings: { delivered_cents: 2000, transfer_min_secs: 30, new_until_paid: 3, new_max_callable: 300, new_daily_calls: 100, max_callable: 5000,
    daily_calls: 1000, watch_calls: 60, max_attempts: 5, pause_stop_rate: 0.05, pause_min_reached: 20, scrub_provider: 'none', live: false, numbers: 1 },
  accounts: [
    { agent_id: 'ag-1', agent: 'Marcus Webb', calls: 436, cost_cents: 10400, paid: 27, paid_cents: 54000, owed: 0, free_rebooks: 2, dupes: 0,
      card: { status: 'ok', brand: 'visa', last4: '4242', funding: 'credit' }, shared_card: false, limits: { is_new: false }, watch: false },
    { agent_id: 'ag-2', agent: 'Tasha Greene', calls: 88, cost_cents: 1860, paid: 0, paid_cents: 0, owed: 1, free_rebooks: 0, dupes: 14,
      card: { status: 'ok', brand: 'mastercard', last4: '5100', funding: 'debit' }, shared_card: false, limits: { is_new: true }, watch: true },
  ],
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
export const rulesOf = s => ({ ...REACT_DEFAULTS, deliveredCents: s?.delivered_cents, maxAttempts: s?.max_attempts, pauseStopRate: Number(s?.pause_stop_rate), pauseMinReached: s?.pause_min_reached })
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
    const { error } = await supabase.rpc('admin_reactivation_settings_save', { p_delivered_cents: next.delivered_cents, p_max_attempts: next.max_attempts,
      p_pause_stop_rate: next.pause_stop_rate, p_pause_min_reached: next.pause_min_reached, p_transfer_min_secs: next.transfer_min_secs,
      p_new_until_paid: next.new_until_paid, p_new_max_callable: next.new_max_callable, p_new_daily_calls: next.new_daily_calls,
      p_max_callable: next.max_callable, p_daily_calls: next.daily_calls, p_watch_calls: next.watch_calls })
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

// Admin to-dos: a list that paused itself (too many "stop calling", or a declined $20), and (P957) an account with lots
// of AI calls and no paid appointment yet (watch).
export const pausedLists = view => [
  ...(view?.lists || []).filter(l => l.status === 'paused'),
  ...(view?.accounts || []).filter(a => a.watch).map(a => ({ id: `watch-${a.agent_id}`, watch: true, agent: a.agent, calls: a.calls, cost_cents: a.cost_cents })),
]
export const resetAdmReactivation = () => put(structuredClone(SEED))
