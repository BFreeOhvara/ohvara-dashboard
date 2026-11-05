import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import '../template/template.css'
import { NoteProvider, AccountProvider } from '../template/kit'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { ConfirmEmailBanner } from '../components/layout/ConfirmEmailBanner'
import FulFrame from '../template/ful/FulFrame'
import { fulRoutes } from '../template/ful/routes'
import { FUL } from './paths'

// P845 — the Fulfillment (VA) portal: the rebuilt VA pages (src/template/ful) at the real Fulfillment URLs, on sample
// info, the same as the agent shell (AgentShell) until the backend step. ShellSwap decides who gets here and passes
// the real name, the real sign-out and the delete-account dialog. P837's real wiring stays in the code to swap in:
// useFulData.js (and the hooks it reads), with the old frame and screens beside it, unrouted.
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
  return (
    <AccountProvider value={account}>
      <NoteProvider>
        <Routes>
          <Route element={<FulFrame />}>{fulRoutes({ preview: false, wrap: el => <Page>{el}</Page> })}</Route>
          <Route path="*" element={<Navigate to={FUL.today} replace />} />
        </Routes>
      </NoteProvider>
    </AccountProvider>
  )
}
