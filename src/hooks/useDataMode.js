import { useSyncExternalStore } from 'react'
import { useAuth } from './useAuth'
import { useAppSettings } from './useAppSettings'
import { resolveMode, canPreviewReal, readView, writeView, subscribeView, switchReady } from '../lib/dataMode'
import { isTestProfile } from '../lib/testAccounts'

// P848 — which data this viewer sees: 'sample' (default, and while anything is loading) or 'real'.
// Returns { mode, real, view, setView, canPreview, show, ready, loading }.
export function useDataMode() {
  const { profile } = useAuth()
  const { data: settings, isLoading } = useAppSettings()
  const view = useSyncExternalStore(subscribeView, readView, () => null)
  const canPreview = canPreviewReal(profile)
  const show = settings?.show_sample_data
  const isTest = isTestProfile(profile)
  const mode = isLoading ? 'sample' : resolveMode({ show, view, canPreview, isTest })
  return { mode, real: mode === 'real', view, setView: writeView, canPreview, isTest, show: show !== false, ready: switchReady(settings), loading: isLoading }
}

// P929: test accounts never see the "Sample info" line or any other sample label.
export { useIsTestAccount } from './useIsTestAccount'
