import { Route, Navigate } from 'react-router-dom'
import Overview from './screens/Overview'
import Agents from './screens/Agents'
import Setup from './screens/Setup'
import Team from './screens/Team'
import Leads from './screens/Leads'
import Clients from './screens/Clients'
import Billing from './screens/Billing'
import Messages from './screens/Messages'
import Settings from './screens/Settings'
import Connect from './screens/Connect'
import { BugsPage, NumbersPage, CompliancePage } from './screens/Work934'
import { ADM_OLD, ADM_GONE as GONE, PREVIEW_BASE, admRoutes, ap } from './paths'

// P849 — the admin pages as <Route> elements, for both mounts (the real admin URLs and /preview/admin). Put them
// inside a <Route element={<AdminFrame />}>. `wrap` lets the real mount add its error boundary around each page.
// Old addresses land on their new home: Users is a Settings section, Payouts a Billing tab, More is Settings.
const SCREENS = { overview: Overview, agents: Agents, setup: Setup, team: Team, leads: Leads, clients: Clients, billing: Billing, messages: Messages, settings: Settings, connect: Connect, bugs: BugsPage, numbers: NumbersPage, compliance: CompliancePage }

export function admRouteEls({ preview, wrap = el => el }) {
  const b = preview ? PREVIEW_BASE : ''
  return [
    ...admRoutes(preview).map(([key, path]) => { const Screen = SCREENS[key]; return <Route key={path} path={path} element={wrap(<Screen />)} /> }),
    <Route key="users" path={b + ADM_OLD.users} element={<Navigate to={`${ap('settings', null, preview)}?tab=people`} replace />} />,
    <Route key="payouts" path={b + ADM_OLD.payouts} element={<Navigate to={`${ap('billing', null, preview)}?tab=payouts`} replace />} />,
    <Route key="more" path={b + ADM_OLD.more} element={<Navigate to={ap('settings', null, preview)} replace />} />,
    // P936: pages that left the rail (Training, Wording to approve, Carrier playbook) land on Overview.
    ...GONE.map(k => <Route key={k} path={b + ADM_OLD[k]} element={<Navigate to={ap('overview', null, preview)} replace />} />),
  ]
}
