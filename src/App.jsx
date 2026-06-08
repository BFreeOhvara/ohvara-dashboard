import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { DashboardLayout } from './components/layout/DashboardLayout'

import Login from './pages/Login'

// Rep pages
import MyLeads from './pages/rep/MyLeads'
import TrainingCenter from './pages/rep/TrainingCenter'
import MyStats from './pages/rep/MyStats'
import MyGoals from './pages/rep/MyGoals'
import ActivityFeed from './pages/rep/ActivityFeed'

// Closer pages
import MyAppointments from './pages/closer/MyAppointments'
import PastDeals from './pages/closer/PastDeals'
import RevenueTracker from './pages/closer/RevenueTracker'
import RepAnalytics from './pages/closer/RepAnalytics'
import CallLeads from './pages/closer/CallLeads'
import CloserPipeline from './pages/closer/CloserPipeline'
import LeadScraperCloser from './pages/admin/LeadScraper'

// Admin pages
import Overview from './pages/admin/Overview'
import RepPerformance from './pages/admin/RepPerformance'
import AllLeads from './pages/admin/AllLeads'
import LeadPipeline from './pages/admin/LeadPipeline'
import ReEngagement from './pages/admin/ReEngagement'
import LeadSources from './pages/admin/LeadSources'
import LeadScraper from './pages/admin/LeadScraper'
import Users from './pages/admin/Users'

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 30000, retry: 1 } },
})

function RoleRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (!profile) return <Navigate to="/login" replace />
  if (profile.role === 'rep') return <Navigate to="/rep" replace />
  if (profile.role === 'closer') return <Navigate to="/closer" replace />
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
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
            <Route path="/rep/feed" element={
              <ProtectedRoute allowedRoles={['rep']}>
                <DashboardLayout><ActivityFeed /></DashboardLayout>
              </ProtectedRoute>
            } />

            {/* Closer routes */}
            <Route path="/closer" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><MyAppointments /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/closer/deals" element={
              <ProtectedRoute allowedRoles={['closer']}>
                <DashboardLayout><PastDeals /></DashboardLayout>
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
            <Route path="/admin/leads" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AllLeads /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/pipeline" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><LeadPipeline /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/reengagement" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><ReEngagement /></DashboardLayout>
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

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
