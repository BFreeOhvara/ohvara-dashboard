import { useSyncExternalStore } from 'react'

// P908: true below 768 px, where the agent side is the phone build.
const Q = '(max-width: 767.98px)'
const mq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(Q) : null)
const subscribe = cb => { const m = mq(); m?.addEventListener('change', cb); return () => m?.removeEventListener('change', cb) }
export const usePhone = () => useSyncExternalStore(subscribe, () => !!mq()?.matches, () => false)
