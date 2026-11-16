import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useOptionalAuth } from './authContext'
import { resolveMode, canPreviewReal, readView, subscribeView } from '../lib/dataMode'
import { useNotificationFeed, useMarkRead, useNotificationList, useSetNotificationMute } from './useNotifications'
import { sampleRows, sampleSettings, toItem } from '../lib/notifications'

// P1023 — the bell for every role and every frame: real rows from the notifications table (written only by notify())
// or, for sample accounts, one of each type on the role's list. Badge and panel share this, so opening one clears both.
// Returns { items, unread, markRead(ids|null), loading }.

// Sample accounts: which sample rows have been opened, kept for the tab's life (shared by badge and panel).
let sampleRead = new Set()
const listeners = new Set()
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
const snapshot = () => sampleRead
function readSample(ids) {
  sampleRead = new Set(sampleRead)
  ids.forEach(id => sampleRead.add(id))
  listeners.forEach(fn => fn())
}

// Real or sample, like useDataMode, but safe outside the app's AuthProvider (the /template preview has none: sample).
function useRealMode() {
  const auth = useOptionalAuth()
  const view = useSyncExternalStore(subscribeView, readView, () => null)
  const profile = auth?.profile
  const real = !!auth && resolveMode({ profile, view: canPreviewReal(profile) ? view : null }) === 'real'
  return { profile, real }
}

export function useBell(role) {
  const { profile, real } = useRealMode()
  const feed = useNotificationFeed(real ? profile?.id : null)
  const mark = useMarkRead(profile?.id)
  const readIds = useSyncExternalStore(subscribe, snapshot, snapshot)

  const rows = useMemo(() => {
    if (real) return feed.data || []
    return sampleRows(role).map(r => (readIds.has(r.id) ? { ...r, read: true } : r))
  }, [real, feed.data, role, readIds])

  const items = useMemo(() => {
    const now = new Date()
    return rows.map(n => toItem(n, role, now))
  }, [rows, role])

  const unread = items.filter(i => i.unread).length

  const markRead = useCallback((ids = null) => {
    if (real) { mark.mutate(ids); return }
    readSample(ids || items.map(i => i.id))
  }, [real, mark, items])

  return { items, unread, markRead, loading: real && feed.isLoading }
}

// P1023 — the Notifications settings list for the role: real (my_notification_list / set_notification_mute) or, for
// sample accounts, the same list kept on this tab. Returns { rows, setMuted(type, muted), loading }.
let sampleMuted = new Set()
const muteListeners = new Set()
const muteSub = fn => { muteListeners.add(fn); return () => muteListeners.delete(fn) }
const muteSnap = () => sampleMuted
export function useNotifPrefs(role) {
  const { profile, real } = useRealMode()
  const list = useNotificationList(real ? profile?.id : null)
  const set = useSetNotificationMute(profile?.id)
  const muted = useSyncExternalStore(muteSub, muteSnap, muteSnap)
  const rows = useMemo(() => (real ? list.data || [] : sampleSettings(role).map(r => ({ ...r, muted: muted.has(r.type) }))), [real, list.data, role, muted])
  const setMuted = useCallback((type, on) => {
    if (real) { set.mutate({ type, muted: on }); return }
    sampleMuted = new Set(sampleMuted)
    if (on) sampleMuted.add(type); else sampleMuted.delete(type)
    muteListeners.forEach(fn => fn())
  }, [real, set])
  return { rows, setMuted, loading: real && list.isLoading }
}
