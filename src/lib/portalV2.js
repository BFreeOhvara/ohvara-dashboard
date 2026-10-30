import { useLocation } from 'react-router-dom'
import { useAppSettings } from '../hooks/useAppSettings'
import { useAuth } from '../hooks/useAuth'
import { isPreviewUser, portalFlagOn, readPreviewChoice, useV2 } from './portalPreview'

// Agent portal v2: the flag. The stage words, names and time words the pages share live in inbounds.js.

// ── The flag ────────────────────────────────────────────────────────────────
// On when the gate in portalPreview.js says so: the app_settings flag for everyone, or a preview-list
// user who hasn't chosen the old pages. ?portal=v1 forces the old portal for that visit (nothing is
// saved). Anything else (column missing, query failed, still loading) is off, so a real agent never
// lands on a half-working page.
export const portalForcedV1 = search => new URLSearchParams(search).get('portal') === 'v1'

export function usePortalV2() {
  const { search } = useLocation()
  const forced = portalForcedV1(search)
  const { data, isLoading } = useAppSettings()
  const { session } = useAuth()
  const user = session?.user
  // Only a preview user's browser storage is ever read.
  const choice = isPreviewUser(user) ? readPreviewChoice() : null
  const on = useV2({ flagOn: portalFlagOn(data), user, choice })
  if (forced) return { on: false, loading: false }
  return { on, loading: isLoading }
}
