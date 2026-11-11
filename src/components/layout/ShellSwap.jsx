import { lazy, Suspense, useMemo } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePortal } from '../../hooks/usePortalAccess'
import { isNativeApp } from '../../lib/native'
import { showShell } from '../../template/paths'
import { showFulShell } from '../../fulshell/paths'
import { showAdminShell, isAdminPreviewPath, adminOldTarget } from '../../adminshell/paths'
import { AdminBoundary } from '../../adminshell/AdminBoundary'
import { ProtectedRoute } from './ProtectedRoute'
import { DeleteAccountDialog } from '../shared/DeleteAccount'

const AgentShell = lazy(() => import('../../template/AgentShell'))
const FulfillShell = lazy(() => import('../../fulshell/FulfillShell'))
const AdminShell = lazy(() => import('../../adminshell/AdminShell'))

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
    <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
  </div>
)

// The agent portal swap: an agent at one of the shell URLs (paths.js SHELL_ROUTES) gets the template's screens.
// P837: a Fulfillment rep at a Fulfillment URL (fulshell/paths.js) gets the same design, on real data.
// P849: an admin at an admin URL gets the admin shell. Everyone else (logged out, or an agent not yet open)
// gets `children`, today's routes, untouched. P956: the phone app gets the same shells as the website. /preview/admin is the admin shell with nobody signed in.
// P919: the old admin pages are gone. No ?classic=1 and no switch back; an admin is never sent to an old page, on the
// web or in the phone app: old addresses land on their new page (adminOldTarget). The flag the old switch remembered
// is cleared on load, so a tab that chose the old pages lands on the new ones.
const CLASSIC_KEY = 'ohvara-admin-classic'
try { window.sessionStorage.removeItem(CLASSIC_KEY); window.localStorage.removeItem(CLASSIC_KEY) } catch { /* private window */ }

// The query string an old link carried, minus the retired ?classic= flag.
const stripClassic = search => {
  const q = new URLSearchParams(search || '')
  q.delete('classic')
  const t = q.toString()
  return t ? `?${t}` : ''
}

export function ShellSwap({ children }) {
  const { profile, loading } = useAuth()
  const { pathname, search } = useLocation()
  const native = isNativeApp()
  if (isAdminPreviewPath(pathname) && !native) return <Suspense fallback={<Spinner />}><AdminShell preview /></Suspense>
  // Until we know the role, hold a shell URL: today's catch-all would send /agent/request-service (shell-only) home,
  // and /fulfillment/servicing (shell-only) the same way, and /admin/agents (P849, shell-only).
  if (loading && (showShell({ role: 'agent', pathname, native }) || showFulShell({ role: 'fulfillment', pathname, native }) || showAdminShell({ role: 'admin', pathname }))) return <Spinner />
  if (profile?.role === 'admin') {
    const to = adminOldTarget(pathname)
    if (to) return <Navigate to={to.includes('#') ? to : `${to}${stripClassic(search)}`} replace />
  }
  if (showAdminShell({ role: profile?.role, pathname })) {
    return <ProtectedRoute allowedRoles={['admin']}><AdminOnly /></ProtectedRoute>
  }
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

// The admin shell (P849). Sample info, like the other two shells, until the backend step.
function AdminOnly() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const account = useMemo(() => ({
    live: true,
    name: profile?.full_name || profile?.email || 'Admin',
    signOut: async () => { await signOut(); navigate('/login') },
    DeleteDialog: DeleteAccountDialog,
  }), [profile?.full_name, profile?.email, signOut, navigate])
  // P855: if the shell's code can't load (a tab left open across a deploy) or the shell itself throws, show the crash panel.
  return <AdminBoundary><Suspense fallback={<Spinner />}><AdminShell account={account} /></Suspense></AdminBoundary>
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
