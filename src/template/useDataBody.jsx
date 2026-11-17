import { useEffect, useRef } from 'react'
import { Loader, PageWait } from '../components/shared/Loader'
import { isBooted, markBooted } from '../lib/loader'
import { DataError } from './DataState'

// P1026 — the hooks behind DataState's loader (see DataLoading there).
// The portal has opened once its data has been in; every frame reports that here.
export function useBoot(loading) {
  useEffect(() => { if (!loading) markBooted() }, [loading])
}

// The page body of a desktop frame: the page, or its error, or the loader (see DataLoading). While a later load is
// slow, the page that was on screen stays (last), not the half-loaded new one.
export function useDataBody(status, el) {
  useBoot(status.loading)
  const last = useRef(null)
  useEffect(() => { if (!status.loading && !status.error) last.current = el })
  if (status.error) return <DataError onRetry={status.retry} />
  if (!status.loading) return el
  if (!isBooted()) return <Loader hold />
  // eslint-disable-next-line react-hooks/refs
  return <>{last.current}<PageWait /></>
}

// The phone frames swap the whole page layer for `body` (null = show the page). First load: the full-screen loader.
// A later slow load keeps the page and adds `wait` (the line along the top).
export function usePhoneBody({ loading, error, retry }) {
  useBoot(loading)
  if (error) return { body: <DataError onRetry={retry} />, wait: null }
  if (!loading) return { body: null, wait: null }
  return isBooted() ? { body: null, wait: <PageWait /> } : { body: <Loader hold />, wait: null }
}
