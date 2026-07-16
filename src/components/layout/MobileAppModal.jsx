import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { X, Smartphone, Share, Plus } from 'lucide-react'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { triggerInstall } from '../../lib/installPrompt'
import { isMobileDevice, isIOS } from '../../lib/platform'

function Step({ n, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left' }}>
      <span style={{
        width: 18, height: 18, borderRadius: '50%', background: 'var(--accent-dim)',
        color: 'var(--accent)', fontSize: 10.5, fontWeight: 600,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
      }}>
        {n}
      </span>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{children}</p>
    </div>
  )
}

// Shared step copy — used by the mobile-only iOS/Android branches below AND
// the desktop QR view's combined instructions (Prompt 291), so there's one
// source of these words instead of two copies that can drift apart.
function IOSSteps() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Step n={1}>
        Tap the{' '}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
          <Share size={12} style={{ verticalAlign: -1 }} /> Share icon
        </span>{' '}
        in Safari's toolbar
      </Step>
      <Step n={2}>Scroll down and tap <strong style={{ color: 'var(--text-primary)' }}>Add to Home Screen</strong></Step>
      <Step n={3}>Tap <strong style={{ color: 'var(--text-primary)' }}>Add</strong> to confirm</Step>
    </div>
  )
}

function AndroidSteps() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Step n={1}>Open your browser's menu (usually <Plus size={12} style={{ verticalAlign: -1, margin: '0 2px' }} /> or ⋮)</Step>
      <Step n={2}>Tap <strong style={{ color: 'var(--text-primary)' }}>Add to Home screen</strong> or <strong style={{ color: 'var(--text-primary)' }}>Install app</strong></Step>
    </div>
  )
}

export function MobileAppModal({ onClose }) {
  const deferredPrompt = useInstallPrompt()
  const [qrDataUrl, setQrDataUrl] = useState(null)
  const [installing, setInstalling] = useState(false)
  const mobile = isMobileDevice()
  const ios = isIOS()

  useEffect(() => {
    if (mobile) return
    QRCode.toDataURL(window.location.origin, {
      width: 220, margin: 1,
      color: { dark: '#080810', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => {})
  }, [mobile])

  async function handleInstall() {
    setInstalling(true)
    const choice = await triggerInstall()
    setInstalling(false)
    if (choice?.outcome === 'accepted') onClose()
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      {/* Solid background (Prompt 291) — .glass-accent's own fill is only
          6% alpha, nearly see-through against the dimmed backdrop; overriding
          just the background keeps the accent border/glow it already had,
          matching the same opaque surface CallPrepModal/CallModal use. */}
      <div className="glass-accent" style={{ position: 'relative', width: '100%', maxWidth: 360, padding: 24, borderRadius: 14, textAlign: 'center', background: '#0E0E1A' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
        >
          <X size={16} />
        </button>

        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
          <Smartphone size={16} color="var(--accent)" />
        </div>

        {!mobile && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>Scan to install</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
              Open your phone's camera and point it at this code — it opens Ohvara so you can add it to your home screen.
            </p>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code to open Ohvara on mobile" width={200} height={200} style={{ borderRadius: 10, margin: '0 auto', display: 'block' }} />
            ) : (
              <div style={{ width: 200, height: 200, margin: '0 auto', borderRadius: 10, background: 'var(--bg-elevated)' }} />
            )}

            {/* Desktop can't know which OS the scanning phone runs, so both
                platforms' install steps show here instead of only after
                scanning (Prompt 291). */}
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 10px' }}>
                  iPhone
                </p>
                <IOSSteps />
              </div>
              <div>
                <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 10px' }}>
                  Android
                </p>
                <AndroidSteps />
              </div>
            </div>
          </>
        )}

        {mobile && deferredPrompt && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>Install Ohvara</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
              Add Ohvara to your home screen for one-tap access, just like a native app.
            </p>
            <button
              onClick={handleInstall}
              disabled={installing}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', height: 42, background: 'var(--accent)', border: 'none',
                borderRadius: 10, fontSize: 13.5, fontWeight: 600, color: 'white',
                cursor: installing ? 'not-allowed' : 'pointer', opacity: installing ? 0.7 : 1,
              }}
            >
              {installing ? 'Installing…' : 'Install App'}
            </button>
          </>
        )}

        {mobile && !deferredPrompt && ios && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>Add to Home Screen</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
              iPhone and iPad don't support one-tap install — a couple of taps in Safari does the same thing:
            </p>
            <IOSSteps />
          </>
        )}

        {mobile && !deferredPrompt && !ios && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', margin: '0 0 4px' }}>Add to Home Screen</p>
            <AndroidSteps />
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
