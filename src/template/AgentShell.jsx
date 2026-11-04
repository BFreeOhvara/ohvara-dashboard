import { Routes, Route, Navigate } from 'react-router-dom'
import './template.css'
import { NoteProvider, AccountProvider } from './kit'
import TemplateFrame from './TemplateFrame'
import Overview from './screens/Overview'
import Leads from './screens/Leads'
import LeadPage from './screens/LeadPage'
import Calendar from './screens/Calendar'
import Clients from './screens/Clients'
import ClientPage from './screens/ClientPage'
import Submit from './screens/Submit'
import RequestService from './screens/RequestService'
import Messages from './screens/Messages'
import Activity from './screens/Activity'
import Billing from './screens/Billing'
import Settings from './screens/Settings'
import More from './screens/More'
import { SHELL_ROUTES } from './paths'

// The template's screens at the real agent URLs (SHELL_ROUTES), inside the app's own router. ShellSwap decides
// who gets here; sample info only until the real data is wired.
const SCREENS = {
  overview: Overview, leads: Leads, lead: LeadPage, calendar: Calendar, clients: Clients, client: ClientPage, submit: Submit,
  requestService: RequestService, activity: Activity, billing: Billing, more: More, settings: Settings, messages: Messages,
}

export default function AgentShell({ account }) {
  return (
    <AccountProvider value={account}>
      <NoteProvider>
        <Routes>
          <Route element={<TemplateFrame />}>
            {Object.entries(SHELL_ROUTES).map(([key, path]) => {
              const Screen = SCREENS[key]
              // Screens read the id as :id (the /template routes); the real client URL calls it :clientId.
              return <Route key={key} path={path.replace(':clientId', ':id')} element={<Screen />} />
            })}
          </Route>
          <Route path="*" element={<Navigate to={SHELL_ROUTES.overview} replace />} />
        </Routes>
      </NoteProvider>
    </AccountProvider>
  )
}
