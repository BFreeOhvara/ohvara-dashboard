import { useSyncExternalStore } from 'react'

// P986 — the admin app's small local state (kept out of the component files so fast refresh keeps working): which
// notifications have been seen, the "Later" taps on Home's Needs you cards (this visit only), and the two admin-only
// chats the desktop doesn't have yet (Jordan, the team group). Those two are sample only until their backend prompt:
// nothing leaves the phone.
function small(initial) {
  const subs = new Set()
  let v = initial
  return {
    sub: f => { subs.add(f); return () => subs.delete(f) },
    get: () => v,
    set: next => { const n = typeof next === 'function' ? next(v) : next; if (n === v) return; v = n; subs.forEach(f => f()) },
  }
}
const use = st => useSyncExternalStore(st.sub, st.get, st.get)

const KEY = 'ohvara-adm-feed-seen'
const seenStore = small((() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } })())
export const FEED_SEEN = {
  sub: seenStore.sub,
  get: seenStore.get,
  add: ids => seenStore.set(s => { if (ids.every(id => s.includes(id))) return s; const n = [...new Set([...s, ...ids])].slice(-300); try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* private window */ } return n }),
}
export const useFeedSeen = () => use(seenStore)

const laterStore = small([])
export const LATER = { add: key => laterStore.set(s => [...new Set([...s, key])]) }
export const useLater = () => use(laterStore)

// Admin-only chats (sample): Jordan (the other admin) and the whole team. Ids start with "adm-" so the frame knows
// they live here, not in the desktop's threads.
export const JORDAN_THREAD = 'adm-jordan'
export const TEAM_THREAD = 'adm-team'
const now = () => `Today, ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
const chatStore = small({
  [JORDAN_THREAD]: { id: JORDAN_THREAD, name: 'Jordan', about: 'Admin · just the two of you', tone: 'sage', unread: 1, messages: [
    { id: 'j1', from: 'them', who: 'Jordan', text: 'Ben says his new card comes Friday. I said we’d hold the lock a day.', at: 'Today, 9:14 AM' },
  ] },
  [TEAM_THREAD]: { id: TEAM_THREAD, name: 'Ohvara team', about: 'Group · admins and every VA', tone: 'sky', group: true, unread: 0, messages: [
    { id: 't1', from: 'Maya Brooks', who: 'Maya', text: 'Morning all, I’m on till 6.', at: 'Today, 8:02 AM' },
    { id: 't2', from: 'me', who: 'You', text: 'Thanks Maya. Keisha has the 12:15 Carla Jones call.', at: 'Today, 8:10 AM' },
  ] },
})
export const useAdmChats = () => Object.values(use(chatStore))
export const admChats = {
  send: (id, text) => chatStore.set(s => ({ ...s, [id]: { ...s[id], messages: [...s[id].messages, { id: `m${Date.now()}`, from: 'me', who: 'You', text, at: now() }] } })),
  read: id => chatStore.set(s => (s[id]?.unread ? { ...s, [id]: { ...s[id], unread: 0 } } : s)),
  // A first message to someone with no line yet (sample): the chat starts here, empty.
  start: (id, name, about) => chatStore.set(s => (s[id] ? s : { ...s, [id]: { id, name, about, tone: 'stone', unread: 0, messages: [], fresh: true } })),
}
export const isLocalChat = id => String(id || '').startsWith('adm-')

// P995: recent searches on the admin Search screen (this phone only), newest first, at most 6.
const RKEY = 'ohvara-adm-recent-search'
const recentStore = small((() => { try { const v = JSON.parse(localStorage.getItem(RKEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } })())
const saveRecent = n => { try { localStorage.setItem(RKEY, JSON.stringify(n)) } catch { /* private window */ } return n }
export const RECENT = {
  add: q => { const t = String(q || '').trim(); if (t.length < 2) return; recentStore.set(s => saveRecent([t, ...s.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, 6))) },
  clear: () => recentStore.set(() => saveRecent([])),
}
export const useRecent = () => use(recentStore)
