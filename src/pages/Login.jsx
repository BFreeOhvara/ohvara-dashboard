import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Mail, Lock, ShieldCheck, Loader2, ArrowRight, ArrowLeft, MailCheck, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase, setKeepSignedIn, keepSignedIn } from '../lib/supabase'
import { isNativeApp, webUrl } from '../lib/native'
import { useSignupOpen } from '../lib/signupStatus'
import { CodeBoxes } from '../components/agent/AgentUI'
import { AuthPage, AuField, PasswordField, AuCheck, AuAlert } from '../components/auth/AuthShell'
import { keepSubmitVisible, EMAIL_RE, SUPPORT_EMAIL } from '../components/auth/authUtils'

// Sign-in — Prompt 781: the theme-proof navy page (mockups media/sign-in/
// SignIn + SignInPhone in the vault). The field says Email; the three legacy
// accounts still type their username into it and useAuth.signIn resolves it
// on the server (username-sign-in), unlisted. Two-step accounts get the code
// card after the password, and nothing past /login opens until it checks out.
//
// Forgot password goes through account-email: same answer whoever asks, and
// it only mails an account whose email is confirmed (a text-invite account
// must click its confirm link first).

const WRONG = 'That email and password don’t match. Check them and try again.'

function Story() {
  return (
    <>
      <span className="sx-pill"><i />For agents, Fulfillment and admins</span>
      <h1 className="sx-h1">Every switch,<br /><span className="sx-grad">cancelled cleanly.</span></h1>
      <p className="sx-lede">
        You book the call. We get the old policy cancelled.<span className="sx-desk-only"> Everyone sees it happen, live.</span>
      </p>
      <div className="sx-preview" aria-hidden="true">
        <div className="sx-pv-next">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="sx-pv-tag"><i />UP NEXT</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--sx-mute)' }}>in 12 min</span>
          </div>
          <div className="sx-pv-time">3:30 PM</div>
          <div style={{ marginTop: 4, fontSize: 15, fontWeight: 700 }}>Linda Okafor</div>
          <div style={{ fontSize: 12.5, color: 'var(--sx-mute)' }}>Cancel with Globe Life · Denver, CO</div>
        </div>
        <div className="sx-pv-done">
          <span className="sx-pv-check"><Check size={16} strokeWidth={3} /></span>
          <span>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>Cancelled · verified</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--sx-dim)' }}>Globe Life confirmed on the call</span>
          </span>
        </div>
        <div className="sx-pv-chip"><i />Booked by your agent · 2 min ago</div>
      </div>
    </>
  )
}

function AppGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="3" /><rect x="10" y="18" width="4" height="1.6" rx=".8" fill="var(--sx-hi)" />
    </svg>
  )
}

export default function Login() {
  const { signIn, signOut, session, profile, loading, mfaRequired } = useAuth()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  // Sign-up open (web only): swaps the invite-only note for a Create account link. Closed or unknown keeps the note.
  const signupOpen = useSignupOpen()
  // Prompt 775 — Delete my account lands here; the note shows once.
  const [deleted] = useState(() => {
    try { const v = sessionStorage.getItem('ohvara-deleted') === '1'; sessionStorage.removeItem('ohvara-deleted'); return v } catch { return false }
  })
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [keep, setKeep] = useState(() => keepSignedIn())
  const [error, setError]       = useState('')
  const [wrong, setWrong]       = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [forgotMode, setForgotMode]   = useState(() => search.get('forgot') === '1') // /signup's "Reset your password" link
  const [resetEmail, setResetEmail]   = useState('')
  const [resetSent, setResetSent]     = useState(false)
  const [resetError, setResetError]   = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [verifying, setVerifying] = useState(false)

  // Role redirect — held while the two-step code is still owed.
  useEffect(() => {
    if (loading || !profile || mfaRequired) return
    if (profile.role === 'admin')            navigate('/admin',               { replace: true })
    else if (profile.role === 'agent')      navigate('/agent',   { replace: true })
    else if (profile.role === 'fulfillment') navigate('/fulfillment',         { replace: true })
  }, [profile, loading, mfaRequired, navigate])

  useEffect(() => {
    if (!loading && session && !profile && !submitting && !mfaRequired) {
      setError('Signed in but your profile didn’t load. Refresh the page, or write to ' + SUPPORT_EMAIL + '.')
    }
  }, [loading, session, profile, submitting, mfaRequired])

  async function handleSubmit(e) {
    e?.preventDefault()
    setError(''); setWrong(false)
    if (!identifier.trim() || !password) { setWrong(true); return setError('Enter your email and password.') }
    setSubmitting(true)
    try {
      setKeepSignedIn(keep)
      await signIn(identifier.trim(), password)
    } catch (err) {
      const m = err.message || ''
      if (/invalid login credentials/i.test(m) || !m) { setWrong(true); setError(WRONG) }
      else setError(m)
    } finally {
      setSubmitting(false)
    }
  }

  function openForgot() {
    setForgotMode(true); setResetSent(false); setResetError('')
    if (!resetEmail && identifier.includes('@')) setResetEmail(identifier.trim())
  }

  async function handleReset(e) {
    e?.preventDefault()
    setResetError('')
    const email = resetEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return setResetError('Type the email you joined with.')
    setResetSending(true)
    try {
      const { error: fnError } = await supabase.functions.invoke('account-email', {
        body: { action: 'reset', email, redirect_to: webUrl('/reset-password') },
      })
      if (fnError) throw fnError
      setResetSent(true)
    } catch {
      setResetError('Couldn’t send the reset link. Try again.')
    } finally {
      setResetSending(false)
    }
  }

  async function verifyCode(c = code) {
    if (c.length !== 6) return
    setCodeError(''); setVerifying(true)
    try {
      const { data, error: le } = await supabase.auth.mfa.listFactors()
      if (le) throw le
      const factor = data.totp.find(f => f.status === 'verified')
      if (!factor) throw new Error('No authenticator is set up on this account.')
      const { error: ve } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: c })
      if (ve) throw ve
      // useAuth re-reads the assurance level on MFA_CHALLENGE_VERIFIED; the
      // redirect effect above takes it from there.
    } catch {
      setCode('')
      setCodeError("That code didn't work. Codes change every 30 seconds.")
    } finally {
      setVerifying(false)
    }
  }

  async function switchAccount() {
    setCode(''); setCodeError(''); setPassword('')
    await signOut()
  }

  const codeStep = session && mfaRequired && !loading

  return (
    <AuthPage left={<Story />}>
      <section className="sx-card" aria-label={codeStep ? 'Two-step check' : forgotMode ? 'Reset your password' : 'Sign in'}>
        {codeStep ? (
          <>
            <span className="sx-big-ico sx-big-ico--ok"><ShieldCheck size={24} strokeWidth={2} /></span>
            <h2>Two-step check</h2>
            <p className="sx-card-sub">Open your authenticator app and enter the 6-digit code for Ohvara.</p>
            <div style={{ marginTop: 20 }}>
              <CodeBoxes value={code} onChange={setCode} onComplete={verifyCode} autoFocus disabled={verifying} invalid={!!codeError} height={58} />
            </div>
            {codeError && <AuAlert>{codeError}</AuAlert>}
            <button type="button" className="sx-btn" style={{ marginTop: 20 }} onClick={() => verifyCode()} disabled={verifying || code.length !== 6}>
              {verifying ? <Loader2 size={18} className="animate-spin" /> : 'Verify'}
            </button>
            <div className="sx-center-note"><button type="button" className="sx-link" onClick={switchAccount}>Use a different account</button></div>
          </>
        ) : forgotMode ? (
          <>
            <button type="button" className="sx-link sx-link--back" onClick={() => { setForgotMode(false); setResetSent(false); setResetError('') }}>
              <ArrowLeft size={16} strokeWidth={2.2} />Back to sign in
            </button>
            <h2 style={{ marginTop: 10 }}>{resetSent ? 'Check your email' : 'Reset your password'}</h2>
            <p className="sx-card-sub">
              {resetSent
                ? <>We sent a link to <strong>{resetEmail.trim()}</strong>.</>
                : 'Type the email you joined with and we’ll send you a link to set a new password.'}
            </p>
            {resetSent ? (
              <>
                <div className="sx-ok" role="status">
                  <span className="sx-ok-ico"><MailCheck size={22} strokeWidth={2} /></span>
                  <span>If that email has an Ohvara account, a reset link is on its way. It works for 1 hour.</span>
                </div>
                <button type="button" className="sx-btn sx-btn--ghost" style={{ marginTop: 16 }}
                  onClick={() => { setForgotMode(false); setResetSent(false) }}>Back to sign in</button>
              </>
            ) : (
              <form onSubmit={handleReset} onFocus={keepSubmitVisible} noValidate>
                {resetError && <AuAlert>{resetError}</AuAlert>}
                <AuField first label="Email" icon={Mail} type="email" inputMode="email" name="email" autoComplete="email"
                  autoCapitalize="none" spellCheck={false} value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                  placeholder="you@email.com" autoFocus error={!!resetError} />
                <button type="submit" className="sx-btn" style={{ marginTop: 20 }} disabled={resetSending}>
                  {resetSending ? <><Loader2 size={18} className="animate-spin" />Sending…</> : 'Send reset link'}
                </button>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={handleSubmit} onFocus={keepSubmitVisible} noValidate>
            <h2>Welcome back</h2>
            <p className="sx-card-sub">Sign in to your Ohvara account.</p>
            {deleted && <div className="sx-note" role="status">Your account was deleted. Thanks for working with Ohvara.</div>}
            {error && <AuAlert>{error}</AuAlert>}
            <AuField first label="Email" icon={Mail} type="text" inputMode="email" name="email" autoComplete="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} value={identifier}
              onChange={e => setIdentifier(e.target.value)} placeholder="you@email.com" autoFocus={!isNativeApp()} error={wrong} />
            <PasswordField label="Password" icon={Lock} name="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" error={wrong} />
            <button type="button" className="sx-link sx-link--forgot" onClick={openForgot}>Forgot password?</button>
            {!isNativeApp() && (
              <div><AuCheck checked={keep} onChange={setKeep}>Keep me signed in</AuCheck></div>
            )}
            <button type="submit" className="sx-btn" disabled={submitting || (loading && !!session)}>
              {submitting ? <><Loader2 size={18} className="animate-spin" />Signing in…</>
                : loading && session ? 'Loading…'
                : <>Sign in<ArrowRight size={17} strokeWidth={2.4} /></>}
            </button>
            {signupOpen === true && !isNativeApp() ? (
              <div className="sx-invite-note">New here? <Link to="/signup">Create an account</Link></div>
            ) : (
              <div className="sx-invite-note">
                New to Ohvara? Accounts are invite-only.<br />
                Ask your agent or <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> for an invite.
              </div>
            )}
          </form>
        )}
      </section>
      {!isNativeApp() && (
        <a href="/app" className="sx-getapp">
          <span className="sx-getapp-ico"><AppGlyph /></span>Get the phone app
        </a>
      )}
    </AuthPage>
  )
}
