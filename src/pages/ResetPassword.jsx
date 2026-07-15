import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import ohvaraLogo from '../assets/ohvara-logo.png'

// Password-reset landing page (Prompt 282) — Supabase's recovery email links
// here with a recovery session already in the URL hash (supabase-js picks it
// up automatically). With that session live, updateUser({ password }) sets
// the new password. Reached without a session (direct nav, expired link),
// there's nothing to update against — show the dead-link state.
export default function ResetPassword() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState(false)

  async function handleSubmit() {
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setSaving(true)
    try {
      const { error: updError } = await supabase.auth.updateUser({ password })
      if (updError) throw updError
      setDone(true)
    } catch (err) {
      setError(err.message || 'Could not update the password — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-[380px] page-enter">
        <div className="text-center mb-8">
          <img src={ohvaraLogo} alt="Ohvara" className="inline-block w-12 h-12 rounded-[10px] mb-4 object-cover" />
          <h1 className="text-2xl font-medium text-[var(--text-primary)] tracking-tight">Reset Password</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Outreach Dashboard</p>
        </div>

        <div className="glass-accent" style={{ padding: 24 }}>
          {loading ? (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : done ? (
            <div className="text-center py-2 space-y-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">Password updated</p>
              <Button onClick={() => navigate('/', { replace: true })} className="w-full" size="md">
                Continue to Dashboard
              </Button>
            </div>
          ) : !session ? (
            <div className="text-center py-4">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-2">This reset link isn't valid</p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                It may have expired or already been used. Request a new one from the sign-in page.
              </p>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="mt-4 text-xs text-[var(--accent)] hover:brightness-110 transition-all"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <div className="space-y-4" onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}>
              <Input
                label="New Password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                autoFocus
                autoComplete="new-password"
              />
              <Input
                label="Confirm New Password"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              {error && (
                <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                  <span className="text-[#EF4444] leading-relaxed">{error}</span>
                </div>
              )}
              <Button onClick={handleSubmit} className="w-full" size="md" disabled={saving}>
                {saving ? 'Updating…' : 'Update Password'}
              </Button>
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
