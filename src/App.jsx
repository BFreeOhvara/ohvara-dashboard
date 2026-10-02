import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SecretsProvider } from './contexts/SecretsContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { DashboardLayout } from './components/layout/DashboardLayout'
// Side-effect import — attaches the beforeinstallprompt listener at app
// boot (Prompt 286) so it's never missed while the user is still on Login.
import './lib/installPrompt'

import Login from './pages/Login'
import Join from './pages/Join'
import ResetPassword from './pages/ResetPassword'
import Settings from './pages/Settings'

import AgentOverview from './pages/agent/Overview'
import AgentBookCall from './pages/agent/BookCall'
import AgentClients from './pages/agent/Clients'
import AgentPerformance from './pages/agent/Performance'
import AgentTraining from './pages/agent/Training'
import FulfillmentQueue from './pages/fulfillment/FulfillmentQueue'
import Users from './pages/admin/Users'

const qc = new QueryClient({
  // refetchOnWindowFocus off: tabbing back must be silent — fresh data
  // arrives via explicit invalidations, not a focus-triggered refetch wave.
  defaultOptions: { queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false } },
})

function RoleRedirect() {
  const { profile, loading } = useAuth()
  // Prompt 323 investigation — this is the installed PWA's start_url ('/'),
  // so every cold launch hits this loading branch first. It used to render
  // nothing at all here (unlike ProtectedRoute's matching branch, which
  // shows a spinner) — a genuine blank screen for however long auth takes
  // to resolve, on the one route guaranteed to run on every app open.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'agent') return <Navigate to="/agent" replace />
  if (profile.role === 'admin') return <Navigate to="/admin/users" replace />
  if (profile.role === 'fulfillment') return <Navigate to="/fulfillment" replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <SecretsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/" element={<RoleRedirect />} />

            {/* Settings — shared across every role (Prompt 226) */}
            <Route path="/settings" element={
              <ProtectedRoute allowedRoles={['agent', 'admin', 'fulfillment']}>
                <DashboardLayout><Settings /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Prompt 674 — Profile lives in Settings again (first tab);
                old /profile links land there. */}
            <Route path="/profile" element={<Navigate to="/settings#profile" replace />} />

            {/* Prompt 661 — app stripped to agent Submissions + the
                cancellation team's Fulfillment Queue. Pre-pivot setter
                (rep), old closer, and client routes are gone; old bookmarks
                fall through to the catch-all redirect. */}
            {/* Prompt 665 — agent portal: Overview, Book a call, My Clients,
                Performance. Old Submissions / My Policies URLs redirect to
                their replacements so bookmarks keep working. */}
            <Route path="/agent" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <DashboardLayout><AgentOverview /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/book" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentBookCall /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/clients" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentClients /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/performance" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentPerformance /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 670 — Training. Admin can open it to review the content
                and see each agent's progress. */}
            <Route path="/agent/training" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentTraining /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/submissions" element={<Navigate to="/agent/book" replace />} />
            <Route path="/agent/policies" element={<Navigate to="/agent/clients" replace />} />
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Users /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <DashboardLayout><FulfillmentQueue /></DashboardLayout>
              </ProtectedRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
        </SecretsProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
