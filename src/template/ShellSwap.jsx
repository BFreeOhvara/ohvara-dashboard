import { lazy, Suspense } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { ProtectedRoute } from '../components/layout/ProtectedRoute'
import { isNativeApp } from '../lib/native'
import { isShellPath, showShell } from './paths'

// Lazy, so admin and fulfillment never download it.
const AgentShell = lazy(() => import('./AgentShell'))

const spinner = (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
    <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
  </div>
)

// The whole swap: an agent on a shell URL (web only) gets the shell, everyone else gets today's routes.
// ProtectedRoute stays in front because it still sends mfaRequired to the code step.
export default function ShellSwap({ children }) {
  const { profile, loading } = useAuth()
  const { pathname } = useLocation()
  if (showShell({ role: profile?.role, pathname, native: isNativeApp() })) {
    return (
      <ProtectedRoute allowedRoles={['agent']}>
        <Suspense fallback={spinner}>
          <AgentShell />
        </Suspense>
      </ProtectedRoute>
    )
  }
  // Role not known yet: hold, as ProtectedRoute does. Request a service has no route of its own, so today's catch-all would send a reload home.
  if (loading && isShellPath(pathname)) return spinner
  return children
}
