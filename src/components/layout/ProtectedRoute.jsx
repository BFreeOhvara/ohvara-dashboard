import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { needsTerms } from '../../lib/oauth'
import { Loader } from '../shared/Loader'

export function ProtectedRoute({ children, allowedRoles }) {
  const { session, profile, loading, mfaRequired } = useAuth()

  // P1020: the loading screen (shows only past 300 ms).
  if (loading) return <Loader />

  if (!session) return <Navigate to="/login" replace />
  // Prompt 720 — password done, two-step code not yet: Login shows the code step.
  if (mfaRequired) return <Navigate to="/login" replace />
  // P999: a first Google / Apple sign-in agrees to the terms on /login before anything opens.
  if (needsTerms(profile)) return <Navigate to="/login" replace />

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect to their own dashboard
    if (profile.role === 'agent') return <Navigate to="/agent" replace />
    if (profile.role === 'admin') return <Navigate to="/admin" replace />
    if (profile.role === 'fulfillment') return <Navigate to="/fulfillment" replace />
  }

  return children
}
