import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import { useFulThreads, useFulSource, VAS } from '../../ful/data'
import { useVaNow } from './useVaNow'
import { toVaStanding, dmThreadId } from './vaModel'
import { useOptionalAuth } from '../../../hooks/useAuth'
import { isSupport, emptySupport } from '../../support911'

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

// P977 — a direct message with every other VA (no group chat). Sample: one thread per teammate in VAS, a couple
// already talking. Real: the standing threads (direct_messages, migration 123 + the VA pair from P977): a VA pair is
// (lower id, higher id); every VA has one with every other VA from the moment both accounts exist, empty until
// someone writes. Ohvara support is the VA's own Admin line (agent_id = the VA, peer = admin).
const SEED_DMS = {
  'va-leo': [
    { id: 'd1', from: 'Leo Grant', text: 'Morning! I’ve got the 10:30 Foresters cancel if you’re still on the 10.', at: 'Today, 9:02 AM' },
    { id: 'd2', from: 'me', text: 'Thanks Leo, I’m on it.', at: 'Today, 9:04 AM' },
  ],
  'va-devon': [{ id: 'd3', from: 'Devon Hale', text: 'I can take the 4:15 if you run long.', at: 'Today, 11:40 AM' }],
}
export const dmStore = (() => {
  const subs = new Set()
  let dms = { ...SEED_DMS }
  let unread = { 'va-devon': 1 }
  let snap = { dms, unread }
  const bump = () => { snap = { dms, unread }; subs.forEach(f => f()) }
  return {
    sub: f => { subs.add(f); return () => subs.delete(f) },
    get: () => snap,
    read: id => { unread = { ...unread, [id]: 0 }; bump() },
    send: (id, text, at) => { const list = dms[id] || []; dms = { ...dms, [id]: [...list, { id: `${id}-${list.length + 1}`, from: 'me', text, at }] }; bump() },
  }
})()
// The real standing threads (VaStandingProvider in VMessages.jsx fills it on real data; null on sample).
export const VaStandingCtx = createContext(null)

export function useVaThreads() {
  const { data: rows } = useFulThreads()
  const sample = useFulSource() === 'sample'
  const profile = useOptionalAuth()?.profile
  const { nowMs, tz } = useVaNow()
  const standing = useContext(VaStandingCtx)
  const dm = useSyncExternalStore(dmStore.sub, dmStore.get)
  return useMemo(() => {
    const agents = rows.filter(t => !isSupport(t))
    const at = t => String(t.messages?.at(-1)?.at || '')
    const byNew = (a, b) => (/^Today/.test(at(b)) - /^Today/.test(at(a))) || 0
    if (sample) {
      const sup = rows.find(isSupport) || { ...emptySupport(), empty: true }
      const vas = VAS.filter(v => !v.me).map(v => ({ id: dmThreadId(v.id), va: true, key: v.id, name: v.name, unread: dm.unread[v.id] || 0, messages: dm.dms[v.id] || [] }))
      const talked = t => (t.messages.length ? 0 : 1)
      return [sup, ...vas.sort((a, b) => talked(a) - talked(b) || byNew(a, b) || a.name.localeCompare(b.name)), ...agents.sort(byNew)]
    }
    const { support, vas } = toVaStanding(standing, profile?.id, nowMs, tz)
    const sup = support || { ...emptySupport(), empty: true }
    const t0 = t => Date.parse(t.last_at || '') || 0
    return [sup, ...vas.sort((a, b) => t0(b) - t0(a) || a.name.localeCompare(b.name)), ...agents.sort(byNew)]
  }, [rows, sample, dm, standing, profile?.id, nowMs, tz])
}
