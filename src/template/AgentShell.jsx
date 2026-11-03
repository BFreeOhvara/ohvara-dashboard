import { useMemo } from 'react'
import { Routes, Route } from 'react-router-dom'
import './template.css'
import { useAuth } from '../hooks/useAuth'
import { DeleteAccountDialog } from '../components/shared/DeleteAccount'
import { NoteProvider } from './kit'
import { ShellAccount } from './account'
import { SHELL_ROUTES } from './paths'
import TemplateFrame from './TemplateFrame'
import Overview from './screens/Overview'
import Leads from './screens/Leads'
import LeadPage from './screens/LeadPage'
import Calendar from './screens/Calendar'
import Clients from './screens/Clients'
import ClientPage from './screens/ClientPage'
import Submit from './screens/Submit'
import RequestService from './screens/RequestService'
import Activity from './screens/Activity'
import Billing from './screens/Billing'
import More from './screens/More'
import Settings from './screens/Settings'
import Messages from './screens/Messages'

// The shell at the real agent URLs, on the sample data. Routes only: the app's one router sits above it.
export default function AgentShell() {
  const { signOut } = useAuth()
  const account = useMemo(() => ({ signOut, DeleteDialog: DeleteAccountDialog }), [signOut])
  return (
    <NoteProvider>
      <ShellAccount.Provider value={account}>
        <Routes>
          <Route element={<TemplateFrame />}>
            <Route path={SHELL_ROUTES.overview} element={<Overview />} />
            <Route path={SHELL_ROUTES.leads} element={<Leads />} />
            <Route path={SHELL_ROUTES.lead} element={<LeadPage />} />
            <Route path={SHELL_ROUTES.calendar} element={<Calendar />} />
            <Route path={SHELL_ROUTES.clients} element={<Clients />} />
            <Route path={SHELL_ROUTES.client} element={<ClientPage />} />
            <Route path={SHELL_ROUTES.submit} element={<Submit />} />
            <Route path={SHELL_ROUTES.requestService} element={<RequestService />} />
            <Route path={SHELL_ROUTES.activity} element={<Activity />} />
            <Route path={SHELL_ROUTES.billing} element={<Billing />} />
            <Route path={SHELL_ROUTES.more} element={<More />} />
            <Route path={SHELL_ROUTES.settings} element={<Settings />} />
            <Route path={SHELL_ROUTES.messages} element={<Messages />} />
          </Route>
        </Routes>
      </ShellAccount.Provider>
    </NoteProvider>
  )
}
