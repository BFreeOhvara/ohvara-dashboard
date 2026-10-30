import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { WifiOff } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePushSettings } from '../../hooks/useAccount'
import { useOnline } from '../../lib/nativeState'
import { isNativeApp } from '../../lib/native'
import { startPush } from '../../lib/push'

// Prompt 775 — the phone app's glue that needs React: starts phone alerts
// once someone is signed in with Phone alerts on, opens the page an alert
// points to when it's tapped, and covers the app with an offline screen
// (instead of a blank page or half-loaded data) while there's no connection.
// Renders nothing on the website.

export function OfflineScreen({ onRetry }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="offline-title" className="nv-offline">
      <WifiOff size={34} strokeWidth={1.8} aria-hidden="true" />
      <h2 id="offline-title">You’re offline</h2>
      <p>Ohvara needs a connection. Your work is saved; this screen goes away as soon as you’re back online.</p>
      <button type="button" className="ov-solid" onClick={onRetry}>Try again</button>
    </div>
  )
}

export function NativeBridge() {
  if (!isNativeApp()) return null
  return <NativeBridgeInner />
}

function NativeBridgeInner() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const online = useOnline()
  const { data: push } = usePushSettings(profile?.id)

  useEffect(() => {
    if (!profile?.id || !push?.push_on) return
    startPush({ onOpen: link => navigate(link) }).catch(e => console.warn('[push]', e?.message || e))
  }, [profile?.id, push?.push_on, navigate])

  if (online) return null
  return <OfflineScreen onRetry={() => window.location.reload()} />
}
