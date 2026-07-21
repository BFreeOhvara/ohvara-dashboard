import { useEffect, useState } from 'react'
import ohvaraLogo from '../assets/ohvara-logo.png'

// Cold-launch branded splash (Prompt 320) — a Supercell-style logo moment
// (Brayden's explicit reference: Clash Royale/Clash of Clans) shown once per
// standalone-PWA cold launch, before the real screen appears, instead of a
// blank flash or an instant jump to login/dashboard. Gated by isStandalone()
// at the call site (App.jsx) so desktop and regular mobile-browser loads
// never see this — React Router navigation never remounts App, so mounting
// this once at the app root already satisfies "once per cold launch, not on
// every internal navigation" with no extra bookkeeping.
const SHOW_MS = 1600
const FADE_MS = 250

export function SplashScreen({ onDone }) {
  const [fadingOut, setFadingOut] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadingOut(true), SHOW_MS)
    const doneTimer = setTimeout(onDone, SHOW_MS + FADE_MS)
    return () => { clearTimeout(fadeTimer); clearTimeout(doneTimer) }
  }, [onDone])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-base)',
        opacity: fadingOut ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: fadingOut ? 'none' : 'auto',
      }}
    >
      <img
        src={ohvaraLogo}
        alt="Ohvara"
        style={{
          width: 96, height: 96,
          animation: 'splashLogoIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both, splashPulse 1.1s ease-in-out 0.6s infinite',
        }}
      />
    </div>
  )
}
