import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check, Lock } from 'lucide-react'
import { OhvaraMark } from '../ui/OhvaraMark'
import { SUPPORT_EMAIL } from './authUtils'
import { isNativeApp } from '../../lib/native'
import { usePublicTheme } from '../../hooks/useTheme'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import './auth.css'
import '../../pages/login.css'
import './public.css'

// The shell every signed-out page shares: create account (/signup), invite (/join), confirm email, reset password.
// P996: on /login's look (P895): the shell backdrop, a frosted glass card, the real logo (big piece navy, wing teal
// in light). Light unless this browser saved a theme. The fields keep auth.css's sx-* rules, fed the shell palette
// by login.css. Was P781's always-navy shell.

const SITE = 'https://ohvara.com'


export function Brand() {
  return (
    <span className="lg-brand">
      <OhvaraMark height={36} back="var(--sh-mark-back)" front="var(--sh-mark-front)" />
      {/* P983: the app is just "Ohvara"; the website keeps "Ohvara Portal". */}
      {isNativeApp()
        ? <span className="lg-brand-name">Ohvara</span>
        : <><span className="lg-brand-name lg-name-web">Ohvara Portal</span><span className="lg-brand-name lg-name-phone">Ohvara</span></>}
    </span>
  )
}

export function FootLinks({ phone = false }) {
  return (
    <div className={phone ? 'lg-foot lg-foot--phone' : 'lg-foot lg-foot--desk'}>
      {!phone && <span>© {new Date().getFullYear()} Ohvara</span>}
      <a href={`${SITE}/privacy`} target="_blank" rel="noreferrer">Privacy</a>
      <a href={`${SITE}/terms`} target="_blank" rel="noreferrer">Terms</a>
      <a href={`mailto:${SUPPORT_EMAIL}`}>{phone ? 'Help' : SUPPORT_EMAIL}</a>
    </div>
  )
}

// left = the story column, children = the card column. Marks <html> while mounted so overscroll shows the page
// colour in either theme.
export function AuthPage({ left, children, waiting = false }) {
  usePublicTheme()
  useEffect(() => {
    const el = document.documentElement
    el.classList.add('lg-root')
    el.style.background = '' // index.html's first-paint colour; lg-root paints it from here
    return () => el.classList.remove('lg-root')
  }, [])
  return (
    <div className="lg-page">
      <div className="lg-bd" aria-hidden="true" />
      <header className="lg-top"><Brand /></header>
      <main className="lg-main lg-main--pub">
        <div className="lg-side lg-side--story">{left}</div>
        <div className={`lg-mid${waiting ? ' lg-mid--wait' : ''}`}>{children}</div>
      </main>
      <FootLinks />
      <FootLinks phone />
    </div>
  )
}

// One labelled field. `error` paints the red border (the message itself is
// one alert above the fields); `locked` is the invite-filled email.
export function AuField({ label, icon: Icon, error, locked, first, hint, hintId, right, className = '', inputRef, ...input }) {
  return (
    <label className={`sx-field${first ? ' sx-field--first' : ''}`}>
      <span className="sx-label">{label}</span>
      <span className={`sx-box${right ? ' sx-box--eye' : ''}${error ? ' is-err' : ''}${locked ? ' is-locked' : ''}`}>
        {Icon && <Icon size={18} strokeWidth={2} className="sx-ico" aria-hidden="true" />}
        <input ref={inputRef} className={`sx-input ${className}`} aria-invalid={error || undefined}
          aria-describedby={hintId} readOnly={locked || undefined} {...input} />
        {locked && <span className="sx-chip-lock"><Lock size={11} strokeWidth={2.4} aria-hidden="true" />Invite</span>}
        {right}
      </span>
      {hint && <span className="sx-hint" id={hintId}>{hint}</span>}
    </label>
  )
}

export function PasswordField(props) {
  const [show, setShow] = useState(false)
  return (
    <AuField {...props} type={show ? 'text' : 'password'}
      right={
        <button type="button" className="sx-eye" onClick={() => setShow(s => !s)}
          aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={19} strokeWidth={2} /> : <Eye size={19} strokeWidth={2} />}
        </button>
      } />
  )
}

export function AuCheck({ checked, onChange, children, error, terms }) {
  return (
    <label className={`sx-check${terms ? ' sx-check--terms' : ''}${error ? ' is-err' : ''}`}>
      <input type="checkbox" className="sx-check-input" checked={checked} onChange={e => onChange(e.target.checked)}
        aria-invalid={error || undefined} />
      <span className="sx-check-box" aria-hidden="true">{checked && <Check size={13} strokeWidth={3.4} />}</span>
      <span>{children}</span>
    </label>
  )
}

export function AuAlert({ children }) {
  return (
    <div role="alert" className="sx-alert">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </div>
  )
}
