import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { X, Copy, Check, Download, Share, Plus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { appLink, loadAppConfig } from '../../lib/appConfig'
import { isNativeApp, openExternal } from '../../lib/native'
import { isMobileDevice, isIOS } from '../../lib/platform'

// Prompt 775 — Get the phone app (replaces P286's add-to-home-screen modal).
// One link for everyone, /app: an iPhone goes to the App Store, an Android to
// Google Play, anything else sees both badges and this same QR code. Until
// the store links are in public/app/config.json it says "Coming soon" and
// keeps the old add-to-home-screen steps as the for-now option. Admins can
// copy the link or download the QR as a PNG to send to new people.

function Steps({ items }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13.5, color: 'var(--ov-soft)', lineHeight: 1.45 }}>
      {items.map((t, i) => <li key={i}>{t}</li>)}
    </ol>
  )
}

const IOS_STEPS = [
  <>Open the portal in Safari and tap <Share size={12} style={{ verticalAlign: -1 }} aria-label="Share" /></>,
  <>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong></>,
]
const ANDROID_STEPS = [
  <>Open the portal in Chrome and tap the menu (<Plus size={12} style={{ verticalAlign: -1 }} aria-hidden="true" /> or ⋮)</>,
  <>Tap <strong>Add to Home screen</strong> or <strong>Install app</strong></>,
]

export function GetAppModal({ onClose }) {
  const { profile } = useAuth()
  const [cfg, setCfg] = useState(null)
  const [qr, setQr] = useState(null)
  const [copied, setCopied] = useState(false)
  const link = appLink()
  const admin = profile?.role === 'admin'
  const phone = isMobileDevice()
  const live = !!(cfg?.ios || cfg?.android)

  useEffect(() => { loadAppConfig().then(setCfg) }, [])
  useEffect(() => {
    QRCode.toDataURL(link, { width: 440, margin: 1, color: { dark: '#080810', light: '#FFFFFF' } }).then(setQr).catch(() => {})
  }, [link])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* no clipboard */ }
  }

  async function downloadPng() {
    const url = await QRCode.toDataURL(link, { width: 1024, margin: 2, color: { dark: '#080810', light: '#FFFFFF' } })
    const a = document.createElement('a')
    a.href = url
    a.download = 'ohvara-app-qr.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const store = (key, label) => cfg?.[key] && (
    <button type="button" className="ov-solid ov-invite-btn" style={{ flex: 1, height: 46, borderRadius: 999 }} onClick={() => openExternal(cfg[key])}>{label}</button>
  )

  return createPortal(
    <>
      <div className="ov-scrim" onClick={onClose} aria-hidden="true" />
      <div className="ov-invite-wrap" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <section className="ov-card ov-invite" role="dialog" aria-modal="true" aria-labelledby="getapp-title">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h2 id="getapp-title" className="ov-invite-title">Get the phone app</h2>
              <p className="ov-invite-sub">
                {live ? 'Ohvara for iPhone and Android: your portal, with alerts on your phone.' : 'Coming soon to the App Store and Google Play.'}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="ov-invite-x"><X size={18} strokeWidth={2} /></button>
          </div>

          {(!phone || admin) && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {qr
                ? <img src={qr} alt={`QR code for ${link}`} width={200} height={200} style={{ borderRadius: 12, display: 'block' }} />
                : <div style={{ width: 200, height: 200, borderRadius: 12, background: 'var(--ov-line)' }} />}
              <span style={{ fontSize: 13, color: 'var(--ov-mute)', textAlign: 'center' }}>
                {live ? 'Point a phone’s camera here to get the app.' : 'Scan to open Ohvara on a phone.'}
              </span>
            </div>
          )}

          {live && (
            <div style={{ display: 'flex', gap: 10 }}>
              {(!phone || isIOS()) && store('ios', 'App Store')}
              {(!phone || !isIOS()) && store('android', 'Google Play')}
            </div>
          )}

          {!live && !isNativeApp() && (
            <details className="ov-note ov-invite-note" style={{ display: 'block' }}>
              <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--ov-hi)' }}>Use the website on your phone for now</summary>
              <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
                <div><div className="ov-invite-label" style={{ marginBottom: 6 }}>iPhone</div><Steps items={IOS_STEPS} /></div>
                <div><div className="ov-invite-label" style={{ marginBottom: 6 }}>Android</div><Steps items={ANDROID_STEPS} /></div>
              </div>
            </details>
          )}

          {admin && (
            <div className="ov-invite-actions">
              <button type="button" className="ov-ghost ov-invite-btn" onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {copied ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={16} strokeWidth={2} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              {!isNativeApp() && (
                <button type="button" className="ov-ghost ov-invite-btn" onClick={downloadPng} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Download size={16} strokeWidth={2} aria-hidden="true" />Download QR
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </>,
    document.body,
  )
}
