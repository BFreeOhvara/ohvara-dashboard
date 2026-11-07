import { useSyncExternalStore } from 'react'
import { useAuth } from './useAuth'
import { useAppSettings } from './useAppSettings'
import { resolveMode, canPreviewReal, readView, writeView, subscribeView, switchReady } from '../lib/dataMode'

// P848 — which data this viewer sees: 'sample' (default, and while anything is loading) or 'real'.
// Returns { mode, real, view, setView, canPreview, show, ready, loading }.
export function useDataMode() {
  const { profile } = useAuth()
  const { data: settings, isLoading } = useAppSettings()
  const view = useSyncExternalStore(subscribeView, readView, () => null)
  const canPreview = canPreviewReal(profile)
  const show = settings?.show_sample_data
  const mode = isLoading ? 'sample' : resolveMode({ show, view, canPreview })
  return { mode, real: mode === 'real', view, setView: writeView, canPreview, show: show !== false, ready: switchReady(settings), loading: isLoading }
}
