import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(username.trim(), password)
      // Role-based redirect is handled by RoleRedirect in App.jsx via onAuthStateChange
    } catch (err) {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] px-4">
      <div className="w-full max-w-[360px]">
        {/* Brand mark */}
        <div className="text-center mb-8">
          <p className="text-xl font-bold text-[var(--text-primary)] tracking-tight">Ohvara</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Outreach Dashboard</p>
        </div>

        {/* Login card */}
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-xl p-6 shadow-card">
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
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-900 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" size="md" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
