import { lazy, Suspense, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePortal } from '../../hooks/usePortalAccess'
import { isNativeApp } from '../../lib/native'
import { showShell } from '../../template/paths'
import { ProtectedRoute } from './ProtectedRoute'
import { DeleteAccountDialog } from '../shared/DeleteAccount'

const AgentShell = lazy(() => import('../../template/AgentShell'))

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
    <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
  </div>
)

// The agent portal swap: an agent at one of the shell URLs (paths.js SHELL_ROUTES) gets the template's screens.
// Everyone else (admin, Fulfillment, VA, logged out, the phone app) gets `children`, today's routes, untouched.
export function ShellSwap({ children }) {
  const { profile, loading } = useAuth()
  const { pathname } = useLocation()
  // Until we know the role, hold a shell URL: today's catch-all would send /agent/request-service (shell-only) home.
  if (loading && showShell({ role: 'agent', pathname, native: isNativeApp() })) return <Spinner />
  if (!showShell({ role: profile?.role, pathname, native: isNativeApp() })) return children
  return <ProtectedRoute allowedRoles={['agent']}><OpenOnly old={children} /></ProtectedRoute>
}

// A locked, paused or welcome-step agent keeps today's gate (BillingGate on the old pages): the shell only
// shows once the portal is open. usePortal only reads (the same check the old pages run).
function OpenOnly({ old }) {
  const portal = usePortal()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const account = useMemo(() => ({
    live: true,
    name: profile?.full_name || profile?.email || 'Agent',
    signOut: async () => { await signOut(); navigate('/login') },
    DeleteDialog: DeleteAccountDialog,
  }), [profile?.full_name, profile?.email, signOut, navigate])
  if (portal.view === 'loading') return <Spinner />
  if (portal.view !== 'open') return old
  return <Suspense fallback={<Spinner />}><AgentShell account={account} /></Suspense>
}
