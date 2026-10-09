import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function ProtectedRoute({ children, allowedRoles }) {
  const { session, profile, loading, mfaRequired } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  // Prompt 720 — password done, two-step code not yet: Login shows the code step.
  if (mfaRequired) return <Navigate to="/login" replace />

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect to their own dashboard
    if (profile.role === 'agent') return <Navigate to="/agent" replace />
    if (profile.role === 'admin') return <Navigate to="/admin/users" replace />
    if (profile.role === 'fulfillment') return <Navigate to="/fulfillment" replace />
  }

  return children
}
