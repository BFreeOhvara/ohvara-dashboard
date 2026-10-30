import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check, Lock } from 'lucide-react'
import { OhvaraMark } from '../ui/OhvaraMark'
import { SUPPORT_EMAIL } from './authUtils'
import './auth.css'

// Prompt 781 — the shell every signed-out page shares: sign in, create
// account (/join), confirm email, reset password. Always the deep-navy look
// (auth.css holds its own fixed tokens), so the OS/app theme never shows here.

const SITE = 'https://ohvara.com'

export function Brand() {
  return (
    <div className="sx-brand">
      <OhvaraMark height={44} back="var(--sx-hi)" front="var(--sx-mark-front)" />
      <span className="sx-brand-name">Ohvara Portal</span>
    </div>
  )
}

export function FootLinks({ phone = false }) {
  return (
    <div className={phone ? 'sx-foot sx-foot--phone' : 'sx-foot'}>
      {!phone && <span>© {new Date().getFullYear()} Ohvara</span>}
      <a href={`${SITE}/privacy`} target="_blank" rel="noreferrer">Privacy</a>
      <a href={`${SITE}/terms`} target="_blank" rel="noreferrer">Terms</a>
      <a href={`mailto:${SUPPORT_EMAIL}`}>{phone ? 'Help' : SUPPORT_EMAIL}</a>
    </div>
  )
}

// left = the story column (hidden parts collapse on phones), children = the
// card column. Marks <html> while mounted so overscroll stays navy.
export function AuthPage({ left, children }) {
  useEffect(() => {
    const el = document.documentElement
    el.classList.add('sx-root')
    return () => el.classList.remove('sx-root')
  }, [])
  return (
    <div className="sx-page">
      <div className="sx-left">
        <Brand />
        <div className="sx-left-mid">{left}</div>
        <FootLinks />
      </div>
      <div className="sx-right">{children}</div>
      <div className="sx-spacer" aria-hidden="true" />
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
