import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, MailCheck, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { AuthPage } from '../components/auth/AuthShell'
import { SUPPORT_EMAIL } from '../components/auth/authUtils'

// Prompt 781 — /confirm-email?t=<token>, the link in the "Confirm your email"
// mail a text-invite account gets. Works signed in or out; once it's done the
// portal banner goes and Forgot password can mail this address.
function Story() {
  return <h1 className="sx-h1">Confirm your<br /><span className="sx-grad">email.</span></h1>
}

export default function ConfirmEmail() {
  const [search] = useSearchParams()
  const token = search.get('t') || ''
  const { session, refreshProfile } = useAuth()
  const [state, setState] = useState('working') // working | done | used | expired | invalid

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!token) { setState('invalid'); return }
      const { data, error } = await supabase.functions.invoke('account-email', { body: { action: 'confirm', token } })
      if (cancelled) return
      if (!error && data?.ok) { setState('done'); refreshProfile?.(); return }
      let reason = 'invalid'
      try { reason = (await error?.context?.json())?.error || reason } catch { /* keep */ }
      setState(['used', 'expired'].includes(reason) ? reason : 'invalid')
    })()
    return () => { cancelled = true }
    // refreshProfile is stable enough; run once per token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const next = session ? '/' : '/login'
  const nextLabel = session ? 'Go to the portal' : 'Go to sign in'

  return (
    <AuthPage left={<Story />}>
      <section className="sx-card" aria-label="Confirm your email" aria-busy={state === 'working' || undefined}>
        {state === 'working' ? (
          <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center', color: 'var(--sx-teal-hi)' }}>
            <Loader2 size={24} className="animate-spin" aria-label="Confirming your email" />
          </div>
        ) : state === 'done' || state === 'used' ? (
          <>
            <span className="sx-big-ico sx-big-ico--ok"><MailCheck size={24} strokeWidth={2} /></span>
            <h2>{state === 'done' ? 'Email confirmed' : 'Already confirmed'}</h2>
            <p className="sx-card-sub" role="status">{state === 'done' ? 'Thanks. This is the email you sign in with, and password resets go here now.' : 'This link was already used, so your email is confirmed.'}</p>
            <Link to={next} replace className="sx-btn" style={{ marginTop: 20 }}>{nextLabel}</Link>
          </>
        ) : (
          <>
            <span className="sx-big-ico sx-big-ico--warn"><Clock size={24} strokeWidth={2} /></span>
            <h2>{state === 'expired' ? 'This link has expired' : 'This link isn’t valid'}</h2>
            <p className="sx-card-sub" style={{ marginTop: 8 }}>
              Sign in and tap <strong>Send again</strong> on the “Confirm your email” banner for a new link.
            </p>
            <Link to={next} replace className="sx-btn" style={{ marginTop: 20 }}>{nextLabel}</Link>
            <div className="sx-center-note">Need help? <a className="sx-soft" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></div>
          </>
        )}
      </section>
    </AuthPage>
  )
}
