import { useMemo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './template.css'
import { NoteProvider, AccountProvider } from './kit'
import TemplateFrame from './TemplateFrame'
import Overview from './screens/Overview'
import Leads from './screens/Leads'
import Calendar from './screens/Calendar'
import Clients from './screens/Clients'
import Submit from './screens/Submit'
import RequestService from './screens/RequestService'
import Messages from './screens/Messages'
import Activity from './screens/Activity'
import Billing from './screens/Billing'
import Settings from './screens/Settings'
import More from './screens/More'
import { SHELL_ROUTES } from './paths'
import { DataProvider } from './data'
import { REAL, realClock, useTz } from '../hooks/agentRealData'
import { setClock } from './leadLifecycle'
import { useDataMode } from '../hooks/useDataMode'

// The template's screens at the real agent URLs (SHELL_ROUTES), inside the app's own router. ShellSwap decides
// who gets here. P848: the data is sample until "Show sample data" is off (or this viewer picks View: Real); then
// every screen reads the agent's own rows (hooks/agentRealData.js). The tree is keyed on the mode, so a switch remounts it.
const SCREENS = {
  overview: Overview, leads: Leads, lead: Leads, calendar: Calendar, clients: Clients, client: Clients, submit: Submit,
  requestService: RequestService, activity: Activity, billing: Billing, more: More, settings: Settings, messages: Messages,
}

export default function AgentShell({ account }) {
  const { mode, canPreview, setView, show } = useDataMode()
  const tz = useTz()
  const real = mode === 'real'
  // The lifecycle rules read the agent's real clock in real mode, the sample clock otherwise (set before children render).
  useMemo(() => setClock(real ? realClock(tz) : null), [real, tz])
  const live = useMemo(() => ({ ...account, view: { mode, canPreview, setView, show } }), [account, mode, canPreview, setView, show])
  return (
    <AccountProvider value={live}>
      <DataProvider key={mode} impl={real ? REAL : null}>
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
      </DataProvider>
    </AccountProvider>
  )
}
