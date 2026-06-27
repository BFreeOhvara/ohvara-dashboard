import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SecretsProvider } from './contexts/SecretsContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { DashboardLayout } from './components/layout/DashboardLayout'

import Login from './pages/Login'
import ClientPreview from './pages/ClientPreview'
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
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'rep') return <Navigate to="/rep" replace />
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
            <Route path="/preview/:appointmentId" element={<ClientPreview />} />
            <Route path="/" element={<RoleRedirect />} />

            {/* Rep routes */}
            <Route path="/rep" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyLeads /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/training" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><TrainingCenter /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/stats" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyStats /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/goals" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyGoals /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/commissions" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyCommissions /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/feed" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><ActivityFeed /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/messages" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><RepMessages /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/rep/calls" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><MyCalls /></DashboardLayout>
              </ProtectedRoute>
            } />

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
