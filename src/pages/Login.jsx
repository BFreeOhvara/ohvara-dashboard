import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Zap } from 'lucide-react'

export default function Login() {
  const { signIn, session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (loading || !profile) return
    if (profile.role === 'admin')       navigate('/admin',  { replace: true })
    else if (profile.role === 'closer') navigate('/closer', { replace: true })
    else                                navigate('/rep',    { replace: true })
  }, [profile, loading, navigate])

  useEffect(() => {
    if (!loading && session && !profile && !submitting) {
      setError('Signed in but profile failed to load — check the browser console for details.')
    }
  }, [loading, session, profile, submitting])

  async function handleSubmit(e) {
    e.preventDefault()
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(108,99,255,0.12) 0%, var(--bg-base) 70%)' }}
    >
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          opacity: 0.3,
        }}
      />

      <div className="w-full max-w-[380px] relative z-10 page-enter">
        {/* Brand mark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[var(--accent)] mb-4 shadow-[0_0_32px_var(--accent-glow)]">
            <Zap size={22} className="text-white" fill="white" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Ohvara</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Outreach Dashboard</p>
        </div>

        {/* Login card */}
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-2xl p-6 shadow-[var(--shadow-panel)]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="jsmith"
              autoFocus
              autoComplete="username"
              required
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />

            {error && (
              <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                <span className="text-[#EF4444] leading-relaxed">{error}</span>
              </div>
            )}

            {!error && submitting === false && session && loading && (
              <p className="text-xs text-[var(--text-muted)] text-center">Loading profile…</p>
            )}

            <Button type="submit" className="w-full" size="md" disabled={submitting || loading}>
              {submitting ? 'Signing in…' : loading && session ? 'Loading…' : 'Sign In'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-6">
          Internal use only · Ohvara Outreach Team
        </p>
      </div>
    </div>
  )
}
