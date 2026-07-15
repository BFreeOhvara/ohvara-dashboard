import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import ohvaraLogo from '../assets/ohvara-logo.png'

export default function Login() {
  const { signIn, session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Forgot-password (Prompt 282) — only works for invite-flow accounts with
  // real emails; legacy synthetic @ohvara.internal addresses can't receive
  // mail, and nothing sends at all until Resend/SMTP is configured.
  const [forgotMode, setForgotMode]   = useState(false)
  const [resetEmail, setResetEmail]   = useState('')
  const [resetSent, setResetSent]     = useState(false)
  const [resetError, setResetError]   = useState('')
  const [resetSending, setResetSending] = useState(false)

  useEffect(() => {
    if (loading || !profile) return
    if (profile.role === 'admin')       navigate('/admin',  { replace: true })
    else if (profile.role === 'closer') navigate('/closer', { replace: true })
    else if (profile.role === 'client') navigate('/client', { replace: true })
    else                                navigate('/rep',    { replace: true })
  }, [profile, loading, navigate])

  useEffect(() => {
    if (!loading && session && !profile && !submitting) {
      setError('Signed in but profile failed to load — check the browser console for details.')
    }
  }, [loading, session, profile, submitting])

  async function handleSubmit() {
    setError('')
    setSubmitting(true)
    try {
      await signIn(username.trim(), password)
    } catch (err) {
      setError(err.message || 'Invalid username or password')
    } finally {
      setSubmitting(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSubmit()
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

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-[380px] page-enter">
        {/* Brand mark */}
        <div className="text-center mb-8">
          <img src={ohvaraLogo} alt="Ohvara" className="inline-block w-12 h-12 rounded-[10px] mb-4 object-cover" />
          <h1 className="text-2xl font-medium text-[var(--text-primary)] tracking-tight">Ohvara</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Outreach Dashboard</p>
        </div>

        {/* Login card */}
        <div className="glass-accent" style={{ padding: 24 }}>
          {forgotMode ? (
            <div className="space-y-4">
              {resetSent ? (
                <div className="text-center py-2">
                  <p className="text-sm font-medium text-[var(--text-primary)] mb-2">Check your email</p>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    If an account exists for <span className="font-mono text-[var(--text-secondary)]">{resetEmail.trim()}</span>,
                    a password reset link is on its way.
                  </p>
                </div>
              ) : (
                <>
                  <Input
                    label="Email"
                    type="email"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoFocus
                    autoComplete="email"
                    onKeyDown={e => { if (e.key === 'Enter') handleReset() }}
                  />
                  {resetError && (
                    <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                      <span className="text-[#EF4444] leading-relaxed">{resetError}</span>
                    </div>
                  )}
                  <Button onClick={handleReset} className="w-full" size="md" disabled={resetSending}>
                    {resetSending ? 'Sending…' : 'Send Reset Link'}
                  </Button>
                </>
              )}
              <button
                onClick={() => { setForgotMode(false); setResetSent(false); setResetError('') }}
                className="block w-full text-center text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Back to sign in
              </button>
            </div>
          ) : (
          <div className="space-y-4" onKeyDown={handleKeyDown}>
            <Input
              label="Username or Email"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="jsmith or you@example.com"
              autoFocus
              autoComplete="username"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            {error && (
              <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                <span className="text-[#EF4444] leading-relaxed">{error}</span>
              </div>
            )}

            {!error && submitting === false && session && loading && (
              <p className="text-xs text-[var(--text-muted)] text-center">Loading profile…</p>
            )}

            <Button onClick={handleSubmit} className="w-full" size="md" disabled={submitting || loading}>
              {submitting ? 'Signing in…' : loading && session ? 'Loading…' : 'Sign In'}
            </Button>

            <button
              onClick={() => setForgotMode(true)}
              className="block w-full text-center text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Forgot password?
            </button>
          </div>
          )}
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-6">
          Internal use only · Ohvara Outreach Team
        </p>
      </div>
    </div>
  )
}
