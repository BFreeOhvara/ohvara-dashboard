import { useCallback, useSyncExternalStore } from 'react'
import { useAuth } from './useAuth'
import { supabase } from '../lib/supabase'
import { resolveMode, canPreviewReal, readView, writeView, subscribeView } from '../lib/dataMode'
import { isTestProfile } from '../lib/testAccounts'

// P848 → P1017 — which data this viewer sees: 'sample' (test accounts; an admin who picked it) or 'real' (everyone
// else, from the first frame). The rule lives on the server (migration 279) and in lib/dataMode.js.
// Returns { mode, real, view, setView, canPreview, isTest }.
export function useDataMode() {
  const { profile, refreshProfile } = useAuth()
  const view = useSyncExternalStore(subscribeView, readView, () => null)
  const canPreview = canPreviewReal(profile)
  const isTest = isTestProfile(profile)
  const mode = resolveMode({ profile, view: canPreview ? view : null })
  const setView = useCallback(v => {
    if (!canPreview) return
    writeView(v)
    supabase.rpc('set_my_data_view', { p_view: v })
      .then(({ error }) => { if (error) console.error('[useDataMode] set_my_data_view:', error.message); return refreshProfile?.() })
      .finally(() => writeView(null))
  }, [canPreview, refreshProfile])
  return { mode, real: mode === 'real', view, setView, canPreview, isTest }
}

// P929: test accounts never see the "Sample info" line or any other sample label.
export { useIsTestAccount } from './useIsTestAccount'
