import { lazy, Suspense, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePortal } from '../../hooks/usePortalAccess'
import { isNativeApp } from '../../lib/native'
import { showShell } from '../../template/paths'
import { showFulShell } from '../../fulshell/paths'
import { ProtectedRoute } from './ProtectedRoute'
import { DeleteAccountDialog } from '../shared/DeleteAccount'

const AgentShell = lazy(() => import('../../template/AgentShell'))
const FulfillShell = lazy(() => import('../../fulshell/FulfillShell'))

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
    <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
  </div>
)

// The agent portal swap: an agent at one of the shell URLs (paths.js SHELL_ROUTES) gets the template's screens.
// P837: a Fulfillment rep at a Fulfillment URL (fulshell/paths.js) gets the same design, on real data.
// Everyone else (admin, logged out, the phone app) gets `children`, today's routes, untouched.
export function ShellSwap({ children }) {
  const { profile, loading } = useAuth()
  const { pathname } = useLocation()
  const native = isNativeApp()
  // Until we know the role, hold a shell URL: today's catch-all would send /agent/request-service (shell-only) home,
  // and /fulfillment/servicing (shell-only) the same way.
  if (loading && (showShell({ role: 'agent', pathname, native }) || showFulShell({ role: 'fulfillment', pathname, native }))) return <Spinner />
  if (showFulShell({ role: profile?.role, pathname, native })) {
    return <ProtectedRoute allowedRoles={['fulfillment']}><FulfillmentOnly /></ProtectedRoute>
  }
  if (!showShell({ role: profile?.role, pathname, native })) return children
  return <ProtectedRoute allowedRoles={['agent']}><OpenOnly old={children} /></ProtectedRoute>
}

// The Fulfillment shell. The old Fulfillment routes had no portal gate (BillingGate passes non-agents through).
function FulfillmentOnly() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const account = useMemo(() => ({
    live: true,
    name: profile?.full_name || profile?.email || 'Fulfillment',
    signOut: async () => { await signOut(); navigate('/login') },
    DeleteDialog: DeleteAccountDialog,
  }), [profile?.full_name, profile?.email, signOut, navigate])
  return <Suspense fallback={<Spinner />}><FulfillShell account={account} /></Suspense>
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
