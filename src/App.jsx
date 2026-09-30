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
import Profile from './pages/Profile'

import AgentPolicies from './pages/agent/MyPolicies'
import AgentSubmissions from './pages/agent/Submissions'
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
  if (profile.role === 'closer') return <Navigate to="/agent/submissions" replace />
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
              <ProtectedRoute allowedRoles={['closer', 'admin', 'fulfillment']}>
                <DashboardLayout><Settings /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Profile — split out of Settings (Prompt 338) so the sidebar
                footer's account popover has its own distinct destination,
                shared across every role same as Settings. */}
            <Route path="/profile" element={
              <ProtectedRoute allowedRoles={['closer', 'admin', 'fulfillment']}>
                <DashboardLayout><Profile /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Prompt 661 — app stripped to agent Submissions + the
                cancellation team's Fulfillment Queue. Pre-pivot setter
                (rep), old closer, and client routes are gone; old bookmarks
                fall through to the catch-all redirect. */}
            <Route path="/agent/submissions" element={
              <ProtectedRoute allowedRoles={['closer', 'admin']}>
                <DashboardLayout><AgentSubmissions /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/policies" element={
              <ProtectedRoute allowedRoles={['closer', 'admin']}>
                <DashboardLayout><AgentPolicies /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent" element={<Navigate to="/agent/submissions" replace />} />
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
