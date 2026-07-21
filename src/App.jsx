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
import ClientPreview from './pages/ClientPreview'
import Settings from './pages/Settings'
import { BackgroundOrbs } from './components/BackgroundOrbs'

// Rep pages
import MyLeads from './pages/rep/MyLeads'
import TrainingCenter from './pages/rep/TrainingCenter'
import MyStats from './pages/rep/MyStats'
import MyGoals from './pages/rep/MyGoals'
import MyCommissions from './pages/rep/MyCommissions'
import ActivityFeed from './pages/rep/ActivityFeed'
import MyCalls from './pages/rep/MyCalls'

// Closer pages
import MyAppointments from './pages/closer/MyAppointments'
import CloserMyCalls from './pages/closer/MyCalls'
import RevenueTracker from './pages/closer/RevenueTracker'
import RepAnalytics from './pages/closer/RepAnalytics'
import CallLeads from './pages/closer/CallLeads'
import CloserPipeline from './pages/closer/CloserPipeline'
import CloserMyStats from './pages/closer/CloserMyStats'
import CloserScript from './pages/closer/CloserScript'
import LeadScraperCloser from './pages/admin/LeadScraper'

// Admin pages
import Overview from './pages/admin/Overview'
import RepPerformance from './pages/admin/RepPerformance'
import LeadPipeline from './pages/admin/LeadPipeline'
import LeadSources from './pages/admin/LeadSources'
import LeadScraper from './pages/admin/LeadScraper'
import Users from './pages/admin/Users'
import Commissions from './pages/admin/Commissions'
import Payouts from './pages/admin/Payouts'
import RepMessages from './pages/rep/Messages'
import CloserMessages from './pages/closer/Messages'
import AdminMessages from './pages/admin/Messages'

// Client pages
import ClientOverview from './pages/client/ClientOverview'
import ClientOnboarding from './pages/client/ClientOnboarding'
import ClientAutomations from './pages/client/ClientAutomations'
import ClientMessages from './pages/client/ClientMessages'

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
  if (profile.role === 'rep') return <Navigate to="/setter" replace />
  if (profile.role === 'closer') return <Navigate to="/closer" replace />
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  if (profile.role === 'client') return <Navigate to="/client" replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <SecretsProvider>
        <BrowserRouter>
          <BackgroundOrbs />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/preview/:appointmentId" element={<ClientPreview />} />
            <Route path="/" element={<RoleRedirect />} />

            {/* Settings — shared across every role (Prompt 226) */}
            <Route path="/settings" element={
              <ProtectedRoute allowedRoles={['rep', 'closer', 'admin', 'client']}>
                <DashboardLayout><Settings /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Setter routes (Prompt 299 — renamed from /rep; internal role
                value/rep_id columns/hook names deliberately untouched, this
                is a display/URL-only rename) */}
            <Route path="/setter" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyLeads /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/training" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><TrainingCenter /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/stats" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyStats /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/goals" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyGoals /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/commissions" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyCommissions /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/feed" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><ActivityFeed /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/messages" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><RepMessages /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/setter/calls" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyCalls /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Old /rep/* bookmarks/links — redirect to the new /setter/*
                path instead of hard-breaking them (Prompt 299) */}
            <Route path="/rep" element={<Navigate to="/setter" replace />} />
            <Route path="/rep/training" element={<Navigate to="/setter/training" replace />} />
            <Route path="/rep/stats" element={<Navigate to="/setter/stats" replace />} />
            <Route path="/rep/goals" element={<Navigate to="/setter/goals" replace />} />
            <Route path="/rep/commissions" element={<Navigate to="/setter/commissions" replace />} />
            <Route path="/rep/feed" element={<Navigate to="/setter/feed" replace />} />
            <Route path="/rep/messages" element={<Navigate to="/setter/messages" replace />} />
            <Route path="/rep/calls" element={<Navigate to="/setter/calls" replace />} />

            {/* Closer routes */}
            <Route path="/closer" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><MyAppointments /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/revenue" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><RevenueTracker /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/reps" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><RepAnalytics /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/scraper" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><LeadScraperCloser /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/call-leads" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CallLeads /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/pipeline" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CloserPipeline /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/stats" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CloserMyStats /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/messages" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CloserMessages /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/script" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CloserScript /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/calls" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><CloserMyCalls /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Admin routes */}
            <Route path="/admin" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Overview /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/reps" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><RepPerformance /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/pipeline" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><LeadPipeline /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/sources" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><LeadSources /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/scraper" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><LeadScraper /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Users /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/messages" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminMessages /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/commissions" element={
              <ProtectedRoute allowedRoles={['admin', 'closer']}>
                <DashboardLayout><Commissions /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/payouts" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Payouts /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/commissions" element={
              <ProtectedRoute allowedRoles={['admin', 'closer']}>
                <DashboardLayout><Commissions /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Client routes */}
            <Route path="/client/onboarding" element={
              <ProtectedRoute allowedRoles={['client']}>
                <ClientOnboarding />
              </ProtectedRoute>
            } />
            <Route path="/client" element={
              <ProtectedRoute allowedRoles={['client']}>
                <DashboardLayout><ClientOverview /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/client/automations" element={
              <ProtectedRoute allowedRoles={['client']}>
                <DashboardLayout><ClientAutomations /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/client/messages" element={
              <ProtectedRoute allowedRoles={['client']}>
                <DashboardLayout><ClientMessages /></DashboardLayout>
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
