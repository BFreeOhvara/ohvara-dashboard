import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { SecretsProvider } from './contexts/SecretsContext'
import { PortalPhoneProvider } from './contexts/PortalPhoneContext'
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { DashboardLayout } from './components/layout/DashboardLayout'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import { NativeBridge } from './components/native/NativeBridge'
import { LEADS_PAGE } from './lib/leadsPage'
import { usePortalV2 } from './lib/portalV2'
// Side-effect import — attaches the beforeinstallprompt listener at app
// boot (Prompt 286) so it's never missed while the user is still on Login.
import './lib/installPrompt'

import Login from './pages/Login'
import Join from './pages/Join'
import ProtectLanding from './pages/public/ProtectLanding'
import ConfirmEmail from './pages/ConfirmEmail'
import ResetPassword from './pages/ResetPassword'
import RescheduleLink from './pages/RescheduleLink'
import Settings from './pages/Settings'
import Messages from './pages/Messages'

import AgentOverview from './pages/agent/Overview'
import AgentBookCall from './pages/agent/BookCall'
import AgentClients from './pages/agent/Clients'
import AgentActivity from './pages/agent/Activity'
import AgentBilling from './pages/agent/Billing'
import AgentMore from './pages/agent/More'
// The v2 agent portal (app_settings.agent_portal_v2, off by default): Today, Inbounds, Inbound detail,
// Calendar, Clients, Plan & billing. Lazy, so a flag-off agent never downloads it.
const V2Today = lazy(() => import('./pages/agent/v2/Today'))
const V2Inbounds = lazy(() => import('./pages/agent/v2/Inbounds'))
const V2InboundDetail = lazy(() => import('./pages/agent/v2/InboundDetail'))
const V2Calendar = lazy(() => import('./pages/agent/v2/Calendar'))
const V2Clients = lazy(() => import('./pages/agent/v2/Clients'))
const V2Plan = lazy(() => import('./pages/agent/v2/Plan'))
// P808: Leads mounts only in dev behind VITE_LEADS_PAGE=1; otherwise the page is not in the bundle.
// The DEV check sits here, in this file, so a production build drops the import() and the chunk.
const AgentLeads = import.meta.env.DEV && LEADS_PAGE ? lazy(() => import('./pages/agent/Leads')) : null
import MyCalls from './pages/fulfillment/MyCalls'
import VaLeads from './pages/fulfillment/VaLeads'
import FulfillmentOverview from './pages/fulfillment/Overview'
import FulfillmentPipeline from './pages/fulfillment/Pipeline'
import MyPay, { GettingPaidRedirect } from './pages/fulfillment/MyPay'
import FulfillmentMore from './pages/fulfillment/More'
import Users from './pages/admin/Users'
import AdminOverview from './pages/admin/Overview'
import AdminPipeline from './pages/admin/Pipeline'
import AdminFulfillment from './pages/admin/Fulfillment'
import AdminPayouts from './pages/admin/Payouts'
import AdminMore from './pages/admin/More'

const qc = new QueryClient({
  // refetchOnWindowFocus off: tabbing back must be silent — fresh data
  // arrives via explicit invalidations, not a focus-triggered refetch wave.
  defaultOptions: { queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false } },
})

// Prompt 758 — an admin who lands on a page that now has an Admin home (old
// bookmarks, links inside the agent / Fulfillment pages) goes there instead,
// query string kept. Agents and Fulfillment see the page as before.
function AdminTo({ to, children }) {
  const { profile } = useAuth()
  const { search } = useLocation()
  if (profile?.role === 'admin') return <Navigate to={`${to}${search}`} replace />
  return children
}

// Old /mp ad links forward to /protect with the query string (utm tags) kept.
function MpToProtect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/protect', search }} replace />
}

// /agent: the v2 Today when the flag is on, else the Overview exactly as before. ?portal=v1 skips the
// wait and shows the Overview. While the flag is still loading a spinner shows, never the wrong page.
function AgentHome() {
  const v2 = usePortalV2()
  if (v2.loading) return <Spinner />
  if (v2.on) return <Suspense fallback={<Spinner />}><V2Today /></Suspense>
  return <DashboardLayout><AgentOverview /></DashboardLayout>
}

// /agent/clients: the v2 Clients when the flag is on, else My Pipeline exactly as before (?portal=v1 too).
function AgentClientsRoute() {
  const v2 = usePortalV2()
  if (v2.loading) return <Spinner />
  if (v2.on) return <Suspense fallback={<Spinner />}><V2Clients /></Suspense>
  return <DashboardLayout><AgentClients /></DashboardLayout>
}

// The v2-only routes: with the flag off they go back to /agent.
function V2Only({ children }) {
  const v2 = usePortalV2()
  if (v2.loading) return <Spinner />
  if (!v2.on) return <Navigate to="/agent" replace />
  return <Suspense fallback={<Spinner />}>{children}</Suspense>
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
      <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

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
  if (profile.role === 'admin') return <Navigate to="/admin" replace />
  if (profile.role === 'fulfillment') return <Navigate to="/fulfillment" replace />
  return <Navigate to="/login" replace />
}

export default function App() {
  return (
    // Prompt 746 — outermost boundary: even a crash in the layout or a
    // provider shows a message instead of a blank page.
    <ErrorBoundary>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <SecretsProvider>
        <BrowserRouter>
          {/* Prompt 751 — the pop-up phone sits above the routes so a call stays up across pages. */}
          <PortalPhoneProvider>
          {/* Prompt 775 — phone app only: push, offline screen. */}
          <NativeBridge />
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Prompt 781 — /join?t=<token>; texts use the short /j/<token>. */}
            <Route path="/join" element={<Join />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/j/:token" element={<Join />} />
            {/* /protect is the one public mortgage-protection page (landing + qualifier; no
                login; posts to submit-mp-lead). /mp forwards to it, utm tags kept. */}
            <Route path="/mp" element={<MpToProtect />} />
            <Route path="/protect" element={<ProtectLanding />} />
            <Route path="/confirm-email" element={<ConfirmEmail />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            {/* Prompt 696 — client-facing reschedule link from the missed-call text; no login */}
            <Route path="/r/:token" element={<RescheduleLink />} />
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
                <AgentHome />
              </ProtectedRoute>
            } />
            {/* v2 portal: Inbounds list, one inbound, Calendar, Plan & billing (flag off: back to /agent). */}
            <Route path="/agent/inbounds" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <V2Only><V2Inbounds /></V2Only>
              </ProtectedRoute>
            } />
            <Route path="/agent/inbounds/:id" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <V2Only><V2InboundDetail /></V2Only>
              </ProtectedRoute>
            } />
            <Route path="/agent/calendar" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <V2Only><V2Calendar /></V2Only>
              </ProtectedRoute>
            } />
            <Route path="/agent/plan" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <V2Only><V2Plan /></V2Only>
              </ProtectedRoute>
            } />
            <Route path="/agent/book" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentBookCall /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/agent/clients" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <AdminTo to="/admin/pipeline"><AgentClientsRoute /></AdminTo>
              </ProtectedRoute>
            } />
            {/* Prompt 690 — Activity: chronological log (policy_events +
                Fulfillment messages). */}
            <Route path="/agent/activity" element={
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><AgentActivity /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* P808: the route mounts only in dev behind VITE_LEADS_PAGE=1; otherwise it redirects to Overview. */}
            <Route path="/agent/leads" element={LEADS_PAGE ? (
              <ProtectedRoute allowedRoles={['agent', 'admin']}>
                <DashboardLayout><Suspense fallback={null}><AgentLeads /></Suspense></DashboardLayout>
              </ProtectedRoute>
            ) : <Navigate to="/agent" replace />} />
            {/* Prompt 691 — Billing, promoted out of Settings. */}
            <Route path="/agent/billing" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <DashboardLayout><AgentBilling /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 772 — More, the phone layout's fifth tab (a desktop visit goes home). */}
            <Route path="/agent/more" element={
              <ProtectedRoute allowedRoles={['agent']}>
                <DashboardLayout><AgentMore /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 693 — Team removed; old links land on Overview. */}
            <Route path="/agent/team" element={<Navigate to="/" replace />} />
            {/* Prompt 678 — Training and Performance removed; old links land on Overview. */}
            <Route path="/agent/training" element={<Navigate to="/" replace />} />
            <Route path="/agent/performance" element={<Navigate to="/" replace />} />
            <Route path="/agent/submissions" element={<Navigate to="/agent/book" replace />} />
            <Route path="/agent/policies" element={<Navigate to="/agent/clients" replace />} />
            {/* Prompt 758 — the Admin side: Overview, Pipeline, Fulfillment,
                Payouts, Users (P759-P762 replace the stand-in pages). Settings
                and Messages are shared. */}
            <Route path="/admin" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminOverview /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/pipeline" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminPipeline /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/fulfillment" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminFulfillment /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/payouts" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminPayouts /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><Users /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 774 — More, the admin phone layout's fifth tab (desktop → /admin). */}
            <Route path="/admin/more" element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DashboardLayout><AdminMore /></DashboardLayout>
              </ProtectedRoute>
            } />
            {/* Prompt 758 — Carrier hours moved into Settings (admin section). */}
            <Route path="/admin/carriers" element={<Navigate to="/settings#carriers" replace />} />

            {/* Prompt 681 — Fulfillment gets an Overview landing page and a
                team-wide Pipeline; the claim desk moved to /fulfillment/desk.
                Prompt 748 — /fulfillment/desk is "My calls", one day at a time. */}
            <Route path="/fulfillment" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <AdminTo to="/admin"><DashboardLayout><FulfillmentOverview /></DashboardLayout></AdminTo>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment/desk" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <AdminTo to="/admin/fulfillment"><DashboardLayout><MyCalls /></DashboardLayout></AdminTo>
              </ProtectedRoute>
            } />
            {/* VA desk: the queue, claim, 4-item checklist and outcome. No admin twin, so admin sees the same page. */}
            <Route path="/fulfillment/leads" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <DashboardLayout><VaLeads /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment/pipeline" element={
              <ProtectedRoute allowedRoles={['fulfillment', 'admin']}>
                <AdminTo to="/admin/pipeline"><DashboardLayout><FulfillmentPipeline /></DashboardLayout></AdminTo>
              </ProtectedRoute>
            } />
            {/* Prompt 683 — the rep's Getting Paid view, promoted out of Settings.
                Prompt 753 — renamed "My pay" at /fulfillment/pay (Payout settings
                is ?settings=1); the old path redirects, keeping its query. */}
            <Route path="/fulfillment/pay" element={
              <ProtectedRoute allowedRoles={['fulfillment']}>
                <DashboardLayout><MyPay /></DashboardLayout>
              </ProtectedRoute>
            } />
            <Route path="/fulfillment/getting-paid" element={<GettingPaidRedirect />} />
            {/* Prompt 773 — More, the rep's phone layout's fifth tab (desktop → /fulfillment). */}
            <Route path="/fulfillment/more" element={
              <ProtectedRoute allowedRoles={['fulfillment']}>
                <DashboardLayout><FulfillmentMore /></DashboardLayout>
              </ProtectedRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </PortalPhoneProvider>
        </BrowserRouter>
        </SecretsProvider>
      </AuthProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  )
}
