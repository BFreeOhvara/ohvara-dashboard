import { Route, Navigate } from 'react-router-dom'
import OldCall from './OldCall'
import Overview from './screens/Overview'
import Calendar from './screens/Calendar'
import Clients from './screens/Clients'
import Schedule from './screens/Schedule'
import Pay from './screens/Pay'
import Messages from './screens/Messages'
import Settings from './screens/Settings'
import Training from '../../fulshell/training/Training'
import { FUL, FUL_ROUTES, OLD_CALLS, OLD_QUEUE, OLD_SERVICING, mountPath } from './paths'

// P845 — the VA pages as <Route> elements, for both mounts: TemplateApp (preview, /template/fulfillment) and
// src/fulshell/FulfillShell (the real VA URLs). Put them inside a <Route element={<FulFrame />}>. `wrap` lets the
// real mount add its error boundary and the confirm-email banner around each page.
// P918: six tabs: Overview, Calendar (every booked call), Clients, Schedule (the VA's own hours), Pay, Training.
const SCREENS = { overview: Overview, calendar: Calendar, clients: Clients, schedule: Schedule, pay: Pay, training: Training }

export function fulRoutes({ preview, wrap = el => el }) {
  const pages = FUL_ROUTES.filter(([key]) => key !== 'more').map(([key, path]) => {
    const Screen = SCREENS[key]
    return <Route key={path} path={path} element={wrap(<Screen />)} />
  })
  // Old addresses for a booked call: Calls, Queue, Servicing, and a call under the old Schedule. All land on the Calendar.
  const old = [OLD_CALLS, OLD_QUEUE, OLD_SERVICING].flatMap(o => [
    <Route key={o} path={o} element={<OldCall />} />,
    <Route key={`${o}/:id`} path={`${o}/:id`} element={<OldCall />} />,
  ])
  return [
    ...pages,
    ...old,
    <Route key="old-sched-call" path={`${FUL.schedule}/:id`} element={<OldCall />} />,
    <Route key="messages" path={mountPath('messages', preview)} element={wrap(<Messages />)} />,
    <Route key="settings" path={mountPath('settings', preview)} element={wrap(<Settings />)} />,
    // The phone-only More page is the avatar menu now; its address lands on Settings.
    <Route key="more" path={FUL.more} element={<Navigate to={mountPath('settings', preview)} replace />} />,
  ]
}
