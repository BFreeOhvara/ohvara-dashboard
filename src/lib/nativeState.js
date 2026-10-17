// Prompt 775 — small shared state for the phone app (online / offline).
// Starts from the browser's own flag; nativeBoot.js keeps it current from
// the phone's network status.
import { useSyncExternalStore } from 'react'

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
const listeners = new Set()

export function setOnline(value) {
  if (online === !!value) return
  online = !!value
  listeners.forEach(fn => fn())
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true))
  window.addEventListener('offline', () => setOnline(false))
}

export function useOnline() {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => online,
  )
}
