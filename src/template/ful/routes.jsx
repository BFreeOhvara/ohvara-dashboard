import { Route, Navigate } from 'react-router-dom'
import Overview from './screens/Overview'
import Queue from './screens/Queue'
import Calls from './screens/Calls'
import Clients from './screens/Clients'
import Servicing from './screens/Servicing'
import Pay from './screens/Pay'
import Messages from './screens/Messages'
import Settings from './screens/Settings'
import { FUL, FUL_ROUTES, mountPath } from './paths'

// P845 — the VA pages as <Route> elements, for both mounts: TemplateApp (preview, /template/fulfillment) and
// src/fulshell/FulfillShell (the real VA URLs). Put them inside a <Route element={<FulFrame />}>. `wrap` lets the
// real mount add its error boundary and the confirm-email banner around each page.
const SCREENS = { overview: Overview, queue: Queue, calls: Calls, clients: Clients, servicing: Servicing, pay: Pay }

export function fulRoutes({ preview, wrap = el => el }) {
  const pages = FUL_ROUTES.filter(([key]) => key !== 'more').map(([key, path]) => {
    const Screen = SCREENS[key]
    return <Route key={path} path={path} element={wrap(<Screen />)} />
  })
  return [
    ...pages,
    <Route key="messages" path={mountPath('messages', preview)} element={wrap(<Messages />)} />,
    <Route key="settings" path={mountPath('settings', preview)} element={wrap(<Settings />)} />,
    // The phone-only More page is the avatar menu now; its address lands on Settings.
    <Route key="more" path={FUL.more} element={<Navigate to={mountPath('settings', preview)} replace />} />,
  ]
}
