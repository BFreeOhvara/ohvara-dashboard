import { Route, Navigate } from 'react-router-dom'
import OldCall from './OldCall'
import Overview from './screens/Overview'
import Schedule from './screens/Schedule'
import Clients from './screens/Clients'
import Servicing from './screens/Servicing'
import Pay from './screens/Pay'
import Messages from './screens/Messages'
import Settings from './screens/Settings'
import Training from '../../fulshell/training/Training'
import { FUL, FUL_ROUTES, OLD_CALLS, OLD_QUEUE, mountPath } from './paths'

// P845 — the VA pages as <Route> elements, for both mounts: TemplateApp (preview, /template/fulfillment) and
// src/fulshell/FulfillShell (the real VA URLs). Put them inside a <Route element={<FulFrame />}>. `wrap` lets the
// real mount add its error boundary and the confirm-email banner around each page.
const SCREENS = { overview: Overview, schedule: Schedule, clients: Clients, servicing: Servicing, pay: Pay, training: Training }

export function fulRoutes({ preview, wrap = el => el }) {
  const pages = FUL_ROUTES.filter(([key]) => key !== 'more').map(([key, path]) => {
    const Screen = SCREENS[key]
    return <Route key={path} path={path} element={wrap(<Screen />)} />
  })
  return [
    ...pages,
    <Route key="old-calls" path={OLD_CALLS} element={<OldCall />} />,
    <Route key="old-call" path={`${OLD_CALLS}/:id`} element={<OldCall />} />,
    // P907: no Queue. Its old address (and a lead under it) lands on the Schedule.
    <Route key="old-queue" path={OLD_QUEUE} element={<Navigate to={FUL.schedule} replace />} />,
    <Route key="old-lead" path={`${OLD_QUEUE}/:id`} element={<Navigate to={FUL.schedule} replace />} />,
    <Route key="messages" path={mountPath('messages', preview)} element={wrap(<Messages />)} />,
    <Route key="settings" path={mountPath('settings', preview)} element={wrap(<Settings />)} />,
    // The phone-only More page is the avatar menu now; its address lands on Settings.
    <Route key="more" path={FUL.more} element={<Navigate to={mountPath('settings', preview)} replace />} />,
  ]
}
