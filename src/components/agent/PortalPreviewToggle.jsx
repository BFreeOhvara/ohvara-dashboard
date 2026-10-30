import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAppSettings } from '../../hooks/useAppSettings'
import { portalFlagOn, previewLink, writePreviewChoice } from '../../lib/portalPreview'

// Portal preview list: a small text link under an agent page, for preview-list users only, while the
// v2 flag is off. "Preview v2" on the old pages, "Back to old pages" on v2. Plain inline link (no overlay).
export function PortalPreviewToggle({ onV2 = false }) {
  const { session, profile } = useAuth()
  const { data } = useAppSettings()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const link = previewLink({ flagOn: portalFlagOn(data), user: session?.user, role: profile?.role, pathname, onV2 })
  if (!link) return null
  return (
    <p className="ov-preview">
      <button type="button" className="ov-preview-link" onClick={() => { writePreviewChoice(link.choice); navigate(link.to) }}>
        {link.label}
      </button>
    </p>
  )
}
