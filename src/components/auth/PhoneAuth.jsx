import { useEffect } from 'react'
import { OhvaraMark } from '../ui/OhvaraMark'
import { usePublicTheme } from '../../hooks/useTheme'
import { SUPPORT_EMAIL } from './authUtils'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import '@fontsource/urbanist/800.css'
import './auth.css'
import '../../pages/login.css'
import './phoneAuth.css'

// P999 — the signed-out screens on phones (the app, and the portal in a phone browser), built from Brayden's
// approved mockup (vault media/app-mockup/login-mockup.dc.html): warm stone page with the giant faint Ohvara mark,
// the logo, "Ohvara" and "Leads booked. Policies kept." above one white card centred on the screen, Privacy · Terms
// · Help at the bottom. The keyboard shrinks the screen (Capacitor resizes the web view; phone browsers move the
// visual viewport) and the page scrolls so the focused field stays in view. Light unless a theme was saved.

const SITE = 'https://ohvara.com'

function Watermark() {
  return (
    <div className="pa-bd" aria-hidden="true">
      <span className="pa-wm pa-wm--big"><OhvaraMark height={778} back="var(--pa-wm-wing)" front="var(--pa-wm-body)" /></span>
      <span className="pa-wm pa-wm--small"><OhvaraMark height={316} back="var(--pa-wm-wing-2)" front="var(--pa-wm-body-2)" /></span>
      <span className="pa-glow" />
    </div>
  )
}

export function PhoneAuthPage({ children, label }) {
  usePublicTheme()
  useEffect(() => {
    const el = document.documentElement
    el.classList.add('lg-root', 'pa-root')
    el.style.background = ''
    return () => el.classList.remove('lg-root', 'pa-root')
  }, [])
  return (
    <div className="lg-page pa-page">
      <Watermark />
      <header className="pa-head pa-rise">
        <span aria-hidden="true"><OhvaraMark height={49} back="var(--pa-mark-wing)" front="var(--pa-mark-body)" /></span>
        <span className="pa-name">Ohvara</span>
        <span className="pa-tag">Leads booked. Policies kept.</span>
      </header>
      <main className="pa-mid">
        <section className="pa-card pa-rise" aria-label={label}>{children}</section>
      </main>
      <footer className="pa-foot">
        <a href={`${SITE}/privacy`} target="_blank" rel="noreferrer">Privacy</a>
        <a href={`${SITE}/terms`} target="_blank" rel="noreferrer">Terms</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Help</a>
      </footer>
    </div>
  )
}
