import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

export function ProtectedRoute({ children, allowedRoles }) {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect to their own dashboard
    if (profile.role === 'rep') return <Navigate to="/setter" replace />
    if (profile.role === 'closer') return <Navigate to="/agent" replace />
    if (profile.role === 'admin') return <Navigate to="/admin" replace />
    if (profile.role === 'client') return <Navigate to="/client" replace />
  }

  return children
}
