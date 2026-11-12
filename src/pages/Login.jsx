import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Mail, Lock, ShieldCheck, Loader2, ArrowRight, ArrowLeft, MailCheck, Check } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase, setKeepSignedIn, keepSignedIn } from '../lib/supabase'
import { isNativeApp, webUrl } from '../lib/native'
import { CodeBoxes } from '../components/agent/AgentUI'
import { AuField, PasswordField, AuCheck, AuAlert } from '../components/auth/AuthShell'
import { OhvaraMark } from '../components/ui/OhvaraMark'
import { LIMIT_KEYS, limitNote, safeReturnPath } from '../lib/sessionLimits'
import { keepSubmitVisible, EMAIL_RE, SUPPORT_EMAIL } from '../components/auth/authUtils'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import '@fontsource/urbanist/700.css'
import './login.css'

// Sign-in — Prompt 895: a fresh page on the agent shell's look (DESIGN.md v17:
// Urbanist, the --sh-* palette, frosted glass, the shell backdrop), in light
// and dark. The card sits in the middle of the screen; the story sits to its
// left and a sample of the lead flow (a lead called in seconds, a live call,
// a booked call) to its right. On phones and tablets the card comes first.
// Layout and tokens: ./login.css. The fields still come from AuthShell (the
// other signed-out pages keep P781's navy shell untouched).
//
// Logic unchanged from P781: the field says Email; the three legacy accounts
// still type their username into it and useAuth.signIn resolves it on the
// server (username-sign-in), unlisted. Two-step accounts get the code card
// after the password, and nothing past /login opens until it checks out.
// Forgot password goes through account-email: same answer whoever asks, and
// it only mails an account whose email is confirmed.

const WRONG = 'That email and password don’t match. Check them and try again.'
const SITE = 'https://ohvara.com'

// P970 — the page an agent was on when the portal signed them out (read here, cleared when they get there).
function peekReturnPath() {
  try { return safeReturnPath(sessionStorage.getItem(LIMIT_KEYS.back)) } catch { return null }
}

// DRAFT copy (P895) — for Brayden to OK or reword.
function Story() {
  return (
    <div className="lg-story">
      <span className="lg-pill"><i />For agents, VAs and admins</span>
      <h1 className="lg-h1">Every lead called <span className="lg-grad">in seconds.</span></h1>
      <p className="lg-lede">Ready now, they ring your phone. Not yet, they’re on your calendar.</p>
    </div>
  )
}

// Sample only (decoration): the new lead flow, never a cancellation.
function FlowSample() {
  return (
    <div className="lg-flow" aria-hidden="true">
      <div className="lg-fl-chip">
        <span className="lg-fl-ok"><Check size={13} strokeWidth={3} /></span>
        New lead · called in <b>8 sec</b>
      </div>
      <div className="lg-fl-card lg-fl-live">
        <div className="lg-fl-row">
          <span className="lg-fl-tag lg-fl-tag--live"><i />LIVE CALL</span>
          <span className="lg-fl-time">0:21</span>
        </div>
        <div className="lg-fl-title">Take this call?</div>
        <div className="lg-fl-name">Marcus Bell, 58</div>
        <div className="lg-fl-sub">Final expense · Tampa, FL · ready now</div>
        <div className="lg-fl-acts"><span className="lg-fl-yes">Yes, ring me</span><span className="lg-fl-no">Not now</span></div>
      </div>
      <div className="lg-fl-card lg-fl-booked">
        <div className="lg-fl-row">
          <span className="lg-fl-tag lg-fl-tag--booked"><i />BOOKED</span>
          <span className="lg-fl-in">in 12 min</span>
        </div>
        <div className="lg-fl-big">3:30 PM</div>
        <div className="lg-fl-name">Linda Okafor</div>
        <div className="lg-fl-sub">Life insurance · Denver, CO</div>
      </div>
    </div>
  )
}

function Foot({ phone = false }) {
  return (
    <div className={phone ? 'lg-foot lg-foot--phone' : 'lg-foot lg-foot--desk'}>
      {!phone && <span>© {new Date().getFullYear()} Ohvara</span>}
      <a href={`${SITE}/privacy`} target="_blank" rel="noreferrer">Privacy</a>
      <a href={`${SITE}/terms`} target="_blank" rel="noreferrer">Terms</a>
      <a href={`mailto:${SUPPORT_EMAIL}`}>{phone ? 'Help' : SUPPORT_EMAIL}</a>
    </div>
  )
}

function AppGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="3" /><rect x="10" y="18" width="4" height="1.6" rx=".8" fill="var(--lg-getapp-ico)" />
    </svg>
  )
}

export default function Login() {
  const { signIn, signOut, session, profile, loading, mfaRequired } = useAuth()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  // Prompt 775 — Delete my account lands here; the note shows once.
  const [deleted] = useState(() => {
    try { const v = sessionStorage.getItem('ohvara-deleted') === '1'; sessionStorage.removeItem('ohvara-deleted'); return v } catch { return false }
  })
  // P970 — an agent signed out for being away: the note shows once, and the page they were on is kept for after login.
  const [limitText] = useState(() => {
    try { const v = sessionStorage.getItem(LIMIT_KEYS.note); sessionStorage.removeItem(LIMIT_KEYS.note); return limitNote(v) } catch { return '' }
  })
  const [backTo] = useState(peekReturnPath)
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

  // Marks <html> while mounted so overscroll shows the page colour in either theme.
  useEffect(() => {
    const el = document.documentElement
    el.classList.add('lg-root')
    return () => el.classList.remove('lg-root')
  }, [])

  // Role redirect — held while the two-step code is still owed.
  useEffect(() => {
    if (loading || !profile || mfaRequired) return
    if (profile.role === 'admin')            navigate('/admin',               { replace: true })
    else if (profile.role === 'agent') {
      try { sessionStorage.removeItem(LIMIT_KEYS.back) } catch { /* storage blocked */ }
      navigate(backTo || '/agent', { replace: true })
    }
    else if (profile.role === 'fulfillment') navigate('/fulfillment',         { replace: true })
  }, [profile, loading, mfaRequired, navigate, backTo])

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
    <div className="lg-page">
      <div className="lg-bd" aria-hidden="true" />
      <header className="lg-top">
        <span className="lg-brand">
          <OhvaraMark height={36} back="var(--sh-mark-back)" front="var(--sh-mark-front)" />
          <span className="lg-brand-name">Ohvara Portal</span>
        </span>
      </header>
      <main className="lg-main">
      <div className="lg-side lg-side--story"><Story /></div>
      <div className="lg-mid">
      <section className="lg-card" aria-label={codeStep ? 'Two-step check' : forgotMode ? 'Reset your password' : 'Sign in'}>
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
            {limitText && <div className="sx-note" role="status">{limitText}</div>}
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
            {/* P895: agents sign up themselves (Q57). DRAFT wording. The phone app never shows sign-up. */}
            <div className="sx-invite-note lg-join">
              {isNativeApp()
                ? <>New agents sign up on the Ohvara website.</>
                : <>New agent? <Link to="/signup">Create an account</Link></>}
              <small>VAs and admins join by invite from Ohvara.</small>
            </div>
          </form>
        )}
      </section>
      {!isNativeApp() && (
        <a href="/app" className="lg-getapp">
          <span className="lg-getapp-ico"><AppGlyph /></span>Get the phone app
        </a>
      )}
      </div>
      <div className="lg-side lg-side--flow"><FlowSample /></div>
      </main>
      <Foot />
      <Foot phone />
    </div>
  )
}
