import { useMemo } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import '../template/template.css'
import { NoteProvider, AccountProvider } from '../template/kit'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { ConfirmEmailBanner } from '../components/layout/ConfirmEmailBanner'
import FulFrame from '../template/ful/FulFrame'
import { fulRoutes } from '../template/ful/routes'
import { FulDataProvider } from '../template/ful/data'
import { REAL } from '../hooks/fulRealData'
import { useDataMode } from '../hooks/useDataMode'
import { FUL } from './paths'

// P845 — the Fulfillment (VA) portal: the rebuilt VA pages (src/template/ful) at the real Fulfillment URLs. ShellSwap
// decides who gets here and passes the real name, the real sign-out and the delete-account dialog.
// P852 — sample stays on: every VA sees the sample pages until admin Settings → "Show sample data" is switched off.
// Admins (and the test VA) can preview real data for themselves with View: Sample / Real in the avatar menu. In real
// mode FulDataProvider hands the pages the real hooks (hooks/fulRealData.js). The tree is keyed on the mode, so a switch
// remounts it and no page swaps hooks mid-mount.
function Page({ children }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <ConfirmEmailBanner />
      {children}
    </ErrorBoundary>
  )
}

export default function FulfillShell({ account }) {
  const { mode, canPreview, setView, show } = useDataMode()
  const real = mode === 'real'
  const live = useMemo(() => ({ ...account, view: { mode, canPreview, setView, show } }), [account, mode, canPreview, setView, show])
  return (
    <AccountProvider value={live}>
      <FulDataProvider key={mode} impl={real ? REAL : null}>
        <NoteProvider>
          <Routes>
            <Route element={<FulFrame />}>{fulRoutes({ preview: false, wrap: el => <Page>{el}</Page> })}</Route>
            <Route path="*" element={<Navigate to={FUL.today} replace />} />
          </Routes>
        </NoteProvider>
      </FulDataProvider>
    </AccountProvider>
  )
}
