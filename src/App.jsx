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
import Messages from './pages/Messages'

import AgentOverview from './pages/agent/Overview'
import AgentBookCall from './pages/agent/BookCall'
import AgentClients from './pages/agent/Clients'
import AgentTeam from './pages/agent/Team'
import AgentActivity from './pages/agent/Activity'
import FulfillmentQueue from './pages/fulfillment/FulfillmentQueue'
import FulfillmentOverview from './pages/fulfillment/Overview'
import FulfillmentPipeline from './pages/fulfillment/Pipeline'
import FulfillmentGettingPaid from './pages/fulfillment/GettingPaid'
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

            {/* Prompt 679 — agent <-> Fulfillment messages, per-client threads */}
            <Route path="/messages" element={
              <ProtectedRoute allowedRoles={['agent', 'admin', 'fulfillment']}>
                <DashboardLayout><Messages /></DashboardLayout>
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
                Team. Old Submissions / My Policies URLs redirect to
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
            {/* Prompt 690 — Activity: chronological log (policy_events +
                Fulfillment messages). */}
            <Route path="/agent/activity" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentActivity /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 671 — Team: team-wide leaderboard + activity feed
                (team_activity() RPC, no teammate client PII). */}
            <Route path="/agent/team" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentTeam /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 678 — Training and Performance removed; old links land on Overview. */}
            <Route path="/agent/training" element={<Navigate to="/" replace />} />
            <Route path="/agent/performance" element={<Navigate to="/" replace />} />
            <Route path="/agent/submissions" element={<Navigate to="/agent/book" replace />} />
            <Route path="/agent/policies" element={<Navigate to="/agent/clients" replace />} />
            <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Users /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 681 — Fulfillment gets an Overview landing page and a
                team-wide Pipeline; the claim desk moved to /fulfillment/desk. */}
            <Route path="/fulfillment" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <DashboardLayout><FulfillmentOverview /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment/desk" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <DashboardLayout><FulfillmentQueue /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment/pipeline" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <DashboardLayout><FulfillmentPipeline /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 683 — the rep's Getting Paid view, promoted out of Settings. */}
            <Route path="/fulfillment/getting-paid" element={
              <ProtectedRoute allowedRoles={['fulfillment']}>
                <DashboardLayout><FulfillmentGettingPaid /></DashboardLayout>
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
