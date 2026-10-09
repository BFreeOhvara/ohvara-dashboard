import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Lock, ShieldCheck, Loader2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { DISPLAY } from '../lib/exportStyles'
import { OvField, CodeBoxes } from '../components/agent/AgentUI'
import ohvaraLogo from '../assets/ohvara-logo.png'

// Sign-in — Prompt 720: email only on screen ("Email", no mention of
// usernames). The three legacy accounts still type their username into the
// same field; useAuth.signIn resolves it. When the account has two-step on,
// the password step is followed by the Two-step check card (six code boxes),
// and nothing past /login opens until the code checks out.
//
// Forgot password (Prompt 282) only reaches accounts with a real email, and
// nothing arrives until an SMTP sender is set up on the Supabase project.

const H1 = { margin: 0, fontFamily: DISPLAY, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--ov-hi)' }
const SUB = { margin: '4px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ov-mute)' }
const errBox = { margin: 0, padding: '10px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, color: 'var(--danger)', background: 'var(--danger-dim)', border: '1px solid var(--danger-bd)' }

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <img src={ohvaraLogo} alt="" style={{ width: 34, height: 34, borderRadius: 10, objectFit: 'cover' }} />
      <span style={{ fontFamily: DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ov-hi)' }}>Ohvara Portal</span>
    </div>
  )
}

export default function Login() {
  const { signIn, signOut, session, profile, loading, mfaRequired } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [forgotMode, setForgotMode]   = useState(false)
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
    if (profile.role === 'admin')            navigate('/admin/users',         { replace: true })
    else if (profile.role === 'agent')      navigate('/agent',   { replace: true })
    else if (profile.role === 'fulfillment') navigate('/fulfillment',         { replace: true })
  }, [profile, loading, mfaRequired, navigate])

  useEffect(() => {
    if (!loading && session && !profile && !submitting && !mfaRequired) {
      setError('Signed in but profile failed to load — check the browser console for details.')
    }
  }, [loading, session, profile, submitting, mfaRequired])

  async function handleSubmit() {
    setError('')
    if (!identifier.trim() || !password) return setError('Enter your email and password')
    setSubmitting(true)
    try {
      await signIn(identifier.trim(), password)
    } catch (err) {
      setError(/invalid login credentials/i.test(err.message || '') ? 'Wrong email or password' : err.message || 'Wrong email or password')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReset() {
    setResetError('')
    const email = resetEmail.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setResetError('Enter the email address on your account')
      return
    }
    setResetSending(true)
    try {
      const { error: rpError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (rpError) throw rpError
      setResetSent(true)
    } catch (err) {
      setResetError(err.message || 'Could not send the reset email — try again')
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
    <div className="min-h-screen flex justify-center px-4" style={{ position: 'relative', background: 'var(--bg-base)' }}>
      <div className="app-backdrop app-backdrop--v2" style={{ left: 0 }} aria-hidden="true" />
      <div className="page-enter" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, padding: 'clamp(48px, 18vh, 190px) 0 48px' }}>
        <div className="ov-card ov-auth">
          <Brand />
          {codeStep ? (
            <>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={24} strokeWidth={2} />
              </div>
              <div>
                <h1 style={H1}>Two-step check</h1>
                <p style={SUB}>Open your authenticator app and enter the 6-digit code for Ohvara.</p>
              </div>
              <CodeBoxes value={code} onChange={setCode} onComplete={verifyCode} autoFocus disabled={verifying} invalid={!!codeError} height={58} />
              {codeError && <p role="alert" style={errBox}>{codeError}</p>}
              <button type="button" className="ov-buy ov-set-btn" style={{ height: 50, fontSize: 15 }} onClick={() => verifyCode()} disabled={verifying || code.length !== 6}>
                {verifying ? <Loader2 size={16} className="animate-spin" /> : 'Verify'}
              </button>
              <button type="button" className="ov-set-link" style={{ alignSelf: 'center' }} onClick={switchAccount}>Use a different account</button>
            </>
          ) : forgotMode ? (
            <>
              <div>
                <h1 style={H1}>{resetSent ? 'Check your email' : 'Reset password'}</h1>
                <p style={SUB}>
                  {resetSent
                    ? <>If an account exists for <span style={{ fontWeight: 600, color: 'var(--ov-soft)' }}>{resetEmail.trim()}</span>, a password reset link is on its way.</>
                    : "Enter your account's email and we'll send a reset link."}
                </p>
              </div>
              {!resetSent && (
                <>
                  <OvField label="Email" icon={Mail} type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                    placeholder="you@example.com" autoFocus autoComplete="email" error={!!resetError}
                    onKeyDown={e => { if (e.key === 'Enter') handleReset() }} />
                  {resetError && <p role="alert" style={errBox}>{resetError}</p>}
                  <button type="button" className="ov-buy ov-set-btn" style={{ height: 50, fontSize: 15 }} onClick={handleReset} disabled={resetSending}>
                    {resetSending ? 'Sending…' : 'Send reset link'}
                  </button>
                </>
              )}
              <button type="button" className="ov-set-link" style={{ alignSelf: 'center' }}
                onClick={() => { setForgotMode(false); setResetSent(false); setResetError('') }}>
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <div>
                <h1 style={H1}>Sign in</h1>
                <p style={SUB}>Use the email you joined with.</p>
              </div>
              <OvField label="Email" icon={Mail} type="text" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="you@example.com" autoFocus
                error={!!error} onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} />
              <OvField label="Password" icon={Lock} type="password" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                error={!!error} onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }} />
              {error && <p role="alert" style={errBox}>{error}</p>}
              <button type="button" className="ov-buy ov-set-btn" style={{ height: 50, fontSize: 15 }} onClick={handleSubmit} disabled={submitting || (loading && !!session)}>
                {submitting ? 'Signing in…' : loading && session ? 'Loading…' : 'Sign in'}
              </button>
              <button type="button" className="ov-set-link" style={{ alignSelf: 'center' }} onClick={() => setForgotMode(true)}>Forgot password?</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
