import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import ohvaraLogo from '../assets/ohvara-logo.png'

// Public invite-claim page (Prompt 282) — /join/<token>. The invited person
// registers themselves: real name, real email, phone, and their own password.
// Role comes from the invite; admin never sees the password. Mirrors Login's
// layout so the first thing a new hire sees matches the app they'll live in.
export default function Join() {
  const { token } = useParams()
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [invite, setInvite]     = useState(null) // { role } when valid
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', confirm: '' })
  const [error, setError]           = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      const { data, error: fnError } = await supabase.functions.invoke('claim-invite', {
        body: { action: 'check', token },
      })
      if (cancelled) return
      setInvite(!fnError && data?.valid ? { role: data.role } : null)
      setChecking(false)
    }
    check()
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit() {
    setError('')
    if (!form.full_name.trim()) return setError('Enter your full name')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address')
    if (form.password.length < 8) return setError('Password must be at least 8 characters')
    if (form.password !== form.confirm) return setError('Passwords do not match')

    setSubmitting(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('claim-invite', {
        body: {
          action: 'claim',
          token,
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          password: form.password,
        },
      })
      // supabase-js surfaces non-2xx as fnError with the body unread — pull
      // the function's real error message out of the response when present.
      if (fnError) {
        let msg = 'Registration failed — try again'
        try {
          const body = await fnError.context?.json()
          if (body?.error) msg = body.error
        } catch { /* keep generic */ }
        throw new Error(msg)
      }
      if (data?.error) throw new Error(data.error)

      // Account created — sign them straight in and let RoleRedirect route.
      await signIn(form.email.trim().toLowerCase(), form.password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Registration failed — try again')
      setSubmitting(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSubmit()
  }

  const ROLE_LABELS = { rep: 'Rep', closer: 'Closer', admin: 'Admin' }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-[380px] page-enter">
        <div className="text-center mb-8">
          <img src={ohvaraLogo} alt="Ohvara" className="inline-block w-12 h-12 rounded-[10px] mb-4 object-cover" />
          <h1 className="text-2xl font-medium text-[var(--text-primary)] tracking-tight">Join Ohvara</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {invite ? `You've been invited as a ${ROLE_LABELS[invite.role] || invite.role}` : 'Outreach Dashboard'}
          </p>
        </div>

        <div className="glass-accent" style={{ padding: 24 }}>
          {checking ? (
            <div className="py-8 flex justify-center">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !invite ? (
            <div className="text-center py-4">
              <p className="text-sm font-medium text-[var(--text-primary)] mb-2">This invite link isn't valid</p>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                It may have expired or already been used. Ask whoever sent it for a new link.
              </p>
            </div>
          ) : (
            <div className="space-y-4" onKeyDown={handleKeyDown}>
              <Input
                label="Full Name"
                type="text"
                value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Jordan Smith"
                autoFocus
                autoComplete="name"
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <Input
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 123-4567"
                autoComplete="tel"
              />
              <Input
                label="Password"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Min 8 characters"
                autoComplete="new-password"
              />
              <Input
                label="Confirm Password"
                type="password"
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                placeholder="••••••••"
                autoComplete="new-password"
              />

              {error && (
                <div className="flex items-start gap-2.5 text-xs bg-[#EF4444]/8 border border-[#EF4444]/20 rounded-lg px-3 py-2.5">
                  <span className="text-[#EF4444] leading-relaxed">{error}</span>
                </div>
              )}

              <Button onClick={handleSubmit} className="w-full" size="md" disabled={submitting}>
                {submitting ? 'Creating account…' : 'Create Account'}
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
