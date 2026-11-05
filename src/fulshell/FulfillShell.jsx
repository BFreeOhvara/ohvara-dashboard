import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import '../template/template.css'
import { NoteProvider, AccountProvider } from '../template/kit'
import { ActiveCallProvider } from '../contexts/ActiveCallContext'
import { PhoneLayoutContext, useIsPhone } from '../hooks/usePhoneLayout'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { ConfirmEmailBanner } from '../components/layout/ConfirmEmailBanner'
import VaLeads from '../pages/fulfillment/VaLeads'
import MyCalls from '../pages/fulfillment/MyCalls'
import FulfillmentPipeline from '../pages/fulfillment/Pipeline'
import MyPay from '../pages/fulfillment/MyPay'
import FulfillmentMore from '../pages/fulfillment/More'
import Messages from '../pages/Messages'
import Settings from '../pages/Settings'
import FulfillFrame from './FulfillFrame'
import Today from './screens/Today'
import Servicing from './screens/Servicing'
import { FUL } from './paths'

// P837 — the Fulfillment (VA) portal in the agent shell's design. ShellSwap sends a Fulfillment rep here at the
// Fulfillment URLs (paths.js). Today and Servicing are new; Queue, Calls, Clients, Pay, Messages, Settings and More
// are today's real pages, unchanged in logic, inside the new frame (fulshell.css restyles them). Under 768px the
// pages render their phone screens, as they did inside PhoneShell.
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
  const phone = useIsPhone()
  const pages = [
    [FUL.today, <Today />], [FUL.queue, <VaLeads />], [FUL.calls, <MyCalls />], [FUL.clients, <FulfillmentPipeline />],
    [FUL.servicing, <Servicing />], [FUL.pay, <MyPay />], [FUL.messages, <Messages />], [FUL.settings, <Settings />],
    [FUL.more, <FulfillmentMore />],
  ]
  return (
    <AccountProvider value={account}>
      <NoteProvider>
        <ActiveCallProvider>
          <PhoneLayoutContext.Provider value={phone}>
            <Routes>
              <Route element={<FulfillFrame />}>
                {pages.map(([path, el]) => <Route key={path} path={path} element={<Page>{el}</Page>} />)}
              </Route>
              <Route path="*" element={<Navigate to={FUL.today} replace />} />
            </Routes>
          </PhoneLayoutContext.Provider>
        </ActiveCallProvider>
      </NoteProvider>
    </AccountProvider>
  )
}
