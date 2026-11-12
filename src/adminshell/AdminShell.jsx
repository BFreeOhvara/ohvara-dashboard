import { useEffect, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import '../template/template.css'
import { NoteProvider, AccountProvider, Empty } from '../template/kit'
import { AdminBoundary } from './AdminBoundary'
import { ConfirmEmailBanner } from '../components/layout/ConfirmEmailBanner'
import AdminFrame from './AdminFrame'
import { admRouteEls } from './routes'
import { ap } from './paths'
import { ME, PLANS, admSnapshot, AdmDataProvider, useAdmMeta } from './data'
import { useAdmRealState, useAdmRealActions } from '../hooks/admRealData'
import { useDataMode } from '../hooks/useDataMode'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { withProducts } from './products955'

// P849 — the Admin portal: the rebuilt admin pages (src/adminshell) on sample info, the same as the agent and VA
// shells until the backend step. Two mounts: the real admin URLs (ShellSwap passes the real name, the real sign-out
// and the delete-account dialog) and /preview/admin (nobody signed in, nothing leaves the browser). P919: the old admin
// pages are gone; this is the only admin portal, on the web and in the phone app.
const SAMPLE = { live: false, name: ME.name, signOut: null, DeleteDialog: null }

// P858: on real data, a page waits for the first load, says so if it failed (with Retry), and names any part that
// didn't load while the rest still shows. Sample data never shows here.
function RealGate({ children }) {
  const meta = useAdmMeta()
  if (!meta) return children
  if (meta.isLoading) return <div className="tp-page fx-page" aria-busy="true"><Empty title="Loading real data" sub="Reading agents, leads, clients and the desk." /></div>
  if (meta.error) {
    return (
      <div className="tp-page fx-page" role="alert">
        <Empty title="Couldn't load real data" sub="Nothing changed. Try again, or turn Sample info on from your avatar menu." />
        <button type="button" className="tp-primary fx-accent" onClick={() => meta.retry?.()}>Try again</button>
      </div>
    )
  }
  return (
    <>
      {meta.failed?.length > 0 && <p className="adm-note" role="status">Real data · couldn't load: {meta.failed.join(', ')}. The rest is current.</p>}
      {children}
    </>
  )
}

function Page({ children, preview }) {
  const { pathname } = useLocation()
  return (
    <AdminBoundary resetKey={pathname}>
      {!preview && <ConfirmEmailBanner />}
      <RealGate>{children}</RealGate>
    </AdminBoundary>
  )
}

// P858: the real store and actions for the pages, keyed on the mode by the caller so nothing swaps mid-mount.
const BASE = { settings: admSnapshot().settings, plans: PLANS }
// P955: what each agent bought (agent_billing_plans.picked, a removal waiting, the Leads setup paid), merged onto the
// real store's agents and Setup tickets. Not migrated yet / not readable = nothing merged (everyone reads as Leads).
const PRODUCT_COLS = 'agent_id, picked, picked_next, picked_next_from, signed_up_at, setup_paid_at, leads_setup_at'
function useAgentProducts() {
  const q = useQuery({
    queryKey: ['p955', 'admin', 'products'], refetchInterval: 60000,
    queryFn: async () => { const { data, error } = await supabase.from('agent_billing_plans').select(PRODUCT_COLS); return error ? null : data || [] },
  })
  return q.data ?? null
}
function RealData({ children }) {
  const raw = useAdmRealState(BASE)
  const products = useAgentProducts()
  const state = useMemo(() => withProducts(raw, products), [raw, products])
  const actions = useAdmRealActions()
  const value = useMemo(() => ({ state, actions }), [state, actions])
  return <AdmDataProvider value={value}>{children}</AdmDataProvider>
}
const SampleData = ({ children }) => children

export default function AdminShell({ account, preview = false }) {
  useEffect(() => {
    if (!preview) return undefined
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [preview])
  // P848/P858: the admin's own view (P934: the Sample info pill). Real (the company switch off, or this admin's own preview) hands
  // the pages the real store (hooks/admRealData.js); /preview/admin is always sample.
  const { mode, canPreview, setView, show } = useDataMode()
  const real = !preview && mode === 'real'
  const Data = real ? RealData : SampleData
  const live = useMemo(() => (account ? { ...account, view: { mode, canPreview, setView, show } } : account), [account, mode, canPreview, setView, show])
  // P855: the outer boundary catches a throw in the frame itself (a page's own boundary keeps the tabs alive).
  return (
    <AdminBoundary>
      <AccountProvider value={preview ? SAMPLE : live}>
        <NoteProvider>
          <Data key={real ? 'real' : 'sample'}>
            <Routes>
              <Route element={<AdminFrame />}>{admRouteEls({ preview, wrap: el => <Page preview={preview}>{el}</Page> })}</Route>
              <Route path="*" element={<Navigate to={ap('overview', null, preview)} replace />} />
            </Routes>
          </Data>
        </NoteProvider>
      </AccountProvider>
    </AdminBoundary>
  )
}
