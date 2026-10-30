import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Lock, Loader2, Check, KeyRound, Link2Off } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { AuthPage, PasswordField, AuAlert } from '../components/auth/AuthShell'

// Password-reset landing page (Prompt 282) — Supabase's recovery email links
// here with a recovery session already in the URL hash (supabase-js picks it
// up automatically). With that session live, updateUser({ password }) sets
// the new password. Reached without a session (direct nav, expired link),
// there's nothing to update against — show the dead-link state.
// Prompt 781: same navy shell as sign-in.
function Story() {
  return <h1 className="sx-h1">Set a new<br /><span className="sx-grad">password.</span></h1>
}

export default function ResetPassword() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState(false)

  async function handleSubmit(e) {
    e?.preventDefault()
    setError('')
    if (password.length < 8) return setError('Your password needs 8 or more characters.')
    if (password !== confirm) return setError('Those two passwords don’t match.')
    setSaving(true)
    try {
      const { error: updError } = await supabase.auth.updateUser({ password })
      if (updError) throw updError
      setDone(true)
    } catch (err) {
      setError(err.message || 'Couldn’t update the password. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthPage left={<Story />}>
      <section className="sx-card" aria-label="Reset your password">
        {loading ? (
          <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center', color: 'var(--sx-teal-hi)' }}>
            <Loader2 size={24} className="animate-spin" aria-label="Loading" />
          </div>
        ) : done ? (
          <>
            <span className="sx-big-ico sx-big-ico--ok"><Check size={24} strokeWidth={2.4} /></span>
            <h2>Password updated</h2>
            <p className="sx-card-sub">You’re signed in with your new password.</p>
            <button type="button" className="sx-btn" style={{ marginTop: 20 }} onClick={() => navigate('/', { replace: true })}>Go to the portal</button>
          </>
        ) : !session ? (
          <>
            <span className="sx-big-ico sx-big-ico--warn"><Link2Off size={24} strokeWidth={2} /></span>
            <h2>This reset link isn’t valid</h2>
            <p className="sx-card-sub" style={{ marginTop: 8 }}>It may have expired or already been used. Ask for a new one from the sign-in page.</p>
            <Link to="/login" replace className="sx-btn" style={{ marginTop: 20 }}>Back to sign in</Link>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <span className="sx-big-ico sx-big-ico--ok"><KeyRound size={24} strokeWidth={2} /></span>
            <h2>Choose a new password</h2>
            <p className="sx-card-sub">8 or more characters.</p>
            {error && <AuAlert>{error}</AuAlert>}
            <PasswordField first label="New password" icon={Lock} name="new-password" autoComplete="new-password"
              value={password} onChange={e => setPassword(e.target.value)} placeholder="Make a password" autoFocus error={!!error} />
            <PasswordField label="Type it again" icon={Lock} name="confirm-password" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Same password" error={!!error} />
            <button type="submit" className="sx-btn" style={{ marginTop: 20 }} disabled={saving}>
              {saving ? <><Loader2 size={18} className="animate-spin" />Saving…</> : 'Save password'}
            </button>
          </form>
        )}
      </section>
    </AuthPage>
  )
}
