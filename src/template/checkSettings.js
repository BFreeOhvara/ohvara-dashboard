import { useCallback, useSyncExternalStore } from 'react'
import { CHECK_DEFAULTS, clientStatusOf } from '../lib/clientCheck.js'
import { useDataSource } from './data'
import { SAMPLE_NOW } from './leadLifecycle.js'

// P899 — the monthly "Still on the books?" check settings (admin Clients → Servicing). Sample: one tiny store the
// admin card writes and the agent's Clients page reads. Server: book_settings.check_delay_days, check_monthly_for,
// check_then_every (p899_clients_simple.sql).
let state = { ...CHECK_DEFAULTS }
const subs = new Set()
export const setCheckSettings = patch => { state = { ...state, ...patch }; subs.forEach(f => f()) }
export const useCheckSettings = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => state)

// "Today" for the check: the sample clock on sample data, the real date (the agent's zone) on real data.
export const todayFor = (source, tz = 'America/Chicago') => (source === 'sample' ? SAMPLE_NOW.slice(0, 10) : new Date().toLocaleDateString('en-CA', { timeZone: tz }))

// The agent's status for a client (Working / Needs attention / Protected / Closed), for any agent screen.
export function useClientStatusOf() {
  const source = useDataSource()
  const s = useCheckSettings()
  const today = todayFor(source)
  return useCallback(c => clientStatusOf(c, today, s), [today, s])
}
