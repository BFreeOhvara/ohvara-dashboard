import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { signInWithProvider, socialAvailable } from '../../lib/oauth'
import './phoneAuth.css'

// P999 — Sign in with Apple / Google. `phone`: the approved mockup (an "or" line, then Apple black and Google white
// side by side). Desktop: "or", then two full-width buttons under the email form. Hidden where it can't work (an app
// build older than 1.2). `beforeStart` can refuse (e.g. the terms box on Create account isn't ticked).

export function AppleLogo({ dark = false }) {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true">
      <path fill={dark ? 'currentColor' : '#FFFFFF'} d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.3ZM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5Z" />
    </svg>
  )
}

export function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

export function SocialButtons({ phone = false, onError, beforeStart, next }) {
  const [ok, setOk] = useState(null)
  const [busy, setBusy] = useState(null)
  useEffect(() => { let on = true; socialAvailable().then(v => { if (on) setOk(v) }); return () => { on = false } }, [])
  if (!ok) return null

  async function go(provider) {
    if (busy || (beforeStart && beforeStart() === false)) return
    setBusy(provider)
    try {
      await signInWithProvider(provider, { next })
    } catch {
      onError?.('That sign-in didn’t open. Try again, or use your email and password.')
    } finally {
      // The web page leaves; the app's sheet is open. Either way the button can be pressed again.
      setTimeout(() => setBusy(null), 1500)
    }
  }
  const spin = <Loader2 size={17} className="animate-spin" aria-hidden="true" />

  return (
    <div className={phone ? 'pa-social' : 'lg-social'}>
      <div className="pa-or" role="separator"><span /><small>or</small><span /></div>
      <div className={phone ? 'pa-social-row' : 'lg-social-col'}>
        {phone ? (
          <>
            <button type="button" className="pa-sbtn pa-sbtn--apple" onClick={() => go('apple')} aria-label="Sign in with Apple" disabled={!!busy}>
              {busy === 'apple' ? spin : <AppleLogo />}Apple
            </button>
            <button type="button" className="pa-sbtn pa-sbtn--google" onClick={() => go('google')} aria-label="Sign in with Google" disabled={!!busy}>
              {busy === 'google' ? spin : <GoogleLogo />}Google
            </button>
          </>
        ) : (
          <>
            <button type="button" className="lg-sbtn" onClick={() => go('google')} disabled={!!busy}>
              {busy === 'google' ? spin : <GoogleLogo />}Continue with Google
            </button>
            <button type="button" className="lg-sbtn lg-sbtn--apple" onClick={() => go('apple')} disabled={!!busy}>
              {busy === 'apple' ? spin : <AppleLogo dark />}Continue with Apple
            </button>
          </>
        )}
      </div>
    </div>
  )
}
