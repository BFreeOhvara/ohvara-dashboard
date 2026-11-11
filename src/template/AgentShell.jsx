import { useMemo } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './template.css'
import { NoteProvider, AccountProvider } from './kit'
import { ShellFrame, Pick } from './m/usePhone'
import Overview from './screens/Overview'
import Leads from './screens/Leads'
import Calendar from './screens/Calendar'
import Clients from './screens/Clients'
import Submit from './screens/Submit'
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
// P908: the phone screens load after the desktop ones so the desktop CSS order stays as it was.
import MOverview from './m/MOverview'
import MLeads from './m/MLeads'
import MClients from './m/MClients'
import MCalendar from './m/MCalendar'
import MMore from './m/MMore'
import { DeedstoneCallProvider } from './DeedstoneCall'
import { isNativeApp } from '../lib/native'
import { NativeBillingNote } from '../components/native/NativeBillingNote'

// P956: no payments inside the phone app (P775 rule). Billing there is one line: it's managed on the website.
function NativeBilling() {
  return <div className="tp-page fx-page"><NativeBillingNote /></div>
}

// The template's screens at the real agent URLs (SHELL_ROUTES), inside the app's own router. ShellSwap decides
// who gets here. P848: the data is sample until "Show sample data" is off (or this viewer picks View: Real); then
// every screen reads the agent's own rows (hooks/agentRealData.js). The tree is keyed on the mode, so a switch remounts it.
const SCREENS = {
  overview: Overview, leads: Leads, lead: Leads, calendar: Calendar, clients: Clients, client: Clients, submit: Submit,
  activity: Activity, billing: Billing, more: More, settings: Settings, messages: Messages,
}
// P908: below 768 px these pages are the phone build (src/template/m); the rest keep their screen inside the phone frame.
const PHONE = { overview: MOverview, leads: MLeads, lead: MLeads, calendar: MCalendar, clients: MClients, client: MClients, more: MMore }

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
          {/* P916: every Call in the agent portal goes through Deedstone (one call sheet for the whole portal). */}
          <DeedstoneCallProvider>
          <Routes>
            <Route element={<ShellFrame />}>
              {Object.entries(SHELL_ROUTES).map(([key, path]) => {
                const Screen = key === 'billing' && isNativeApp() ? NativeBilling : SCREENS[key]
                // P924: Request a service is gone; its old address lands on Clients.
                if (key === 'requestService') return <Route key={key} path={path} element={<Navigate to={SHELL_ROUTES.clients} replace />} />
                // Screens read the id as :id (the /template routes); the real client URL calls it :clientId.
                return <Route key={key} path={path.replace(':clientId', ':id')} element={<Pick d={Screen} m={Screen === NativeBilling ? NativeBilling : PHONE[key]} />} />
              })}
            </Route>
            <Route path="*" element={<Navigate to={SHELL_ROUTES.overview} replace />} />
          </Routes>
          </DeedstoneCallProvider>
        </NoteProvider>
      </DataProvider>
    </AccountProvider>
  )
}
