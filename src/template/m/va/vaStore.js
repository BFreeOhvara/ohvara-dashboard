import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { useFulThreads, useFulSource, useFulShift } from '../../ful/data'
import { isSupport, emptySupport } from '../../support911'
import { firstName } from './vaModel'

// P975 — the VA app's shared state (kept out of the component files so fast refresh keeps working):
// the call context (VCall provides it), which notifications have been seen, and the Messages threads.
export const CallCtx = createContext(null)
export const useVaCall = () => useContext(CallCtx)

const KEY = 'ohvara-va-feed-seen'
const subs = new Set()
let seen = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } })()
export const FEED_SEEN = {
  sub: f => { subs.add(f); return () => subs.delete(f) },
  get: () => seen,
  add: ids => { seen = [...new Set([...seen, ...ids])].slice(-300); try { localStorage.setItem(KEY, JSON.stringify(seen)) } catch { /* private window */ } subs.forEach(f => f()) },
}

const TEAM_ID = 'va-team-today'
export const teamStore = (() => {
  const subs = new Set()
  let msgs = [
    { id: 'tm1', from: 'Leo Grant', text: 'Morning! I’ve got the 10:30 Foresters cancel if you’re still on the 10.', at: 'Today, 9:02 AM' },
    { id: 'tm2', from: 'me', text: 'Thanks Leo, I’m on it.', at: 'Today, 9:04 AM' },
    { id: 'tm3', from: 'Devon Price', text: 'I can take the 4:15 if you run long.', at: 'Today, 11:40 AM' },
  ]
  let unread = 1
  return {
    sub: f => { subs.add(f); return () => subs.delete(f) },
    get: () => msgs,
    unread: () => unread,
    read: () => { unread = 0; subs.forEach(f => f()) },
    send: (text, at) => { msgs = [...msgs, { id: `tm${msgs.length + 1}`, from: 'me', text, at }]; subs.forEach(f => f()) },
  }
})()

export function useVaThreads() {
  const { data: rows } = useFulThreads()
  const sample = useFulSource() === 'sample'
  const { data: shift } = useFulShift()
  const team = useSyncExternalStore(teamStore.sub, teamStore.get)
  const teamUnread = useSyncExternalStore(teamStore.sub, teamStore.unread)
  return useMemo(() => {
    const sup = rows.find(isSupport) || { ...emptySupport(), empty: true }
    const mates = (shift.mates || []).map(m => firstName(m.name))
    const teamT = sample ? [{ id: TEAM_ID, team: true, name: mates.length ? mates.join(' and ') : 'Your team', unread: teamUnread, messages: team }] : []
    const agents = rows.filter(t => !isSupport(t))
    const at = t => String(t.messages?.at(-1)?.at || '')
    const byNew = (a, b) => (/^Today/.test(at(b)) - /^Today/.test(at(a))) || 0
    return [...agents.sort(byNew), ...teamT, sup]
  }, [rows, sample, shift.mates, team, teamUnread])
}

