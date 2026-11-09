import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './template.css'
import { NoteProvider, AccountProvider } from './kit'
import { ShellFrame, Pick } from './m/usePhone'
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
import Signup from './screens/Signup'
import Welcome from './screens/Welcome'
import Deedstone from './client/Deedstone'
import FulFrame from './ful/FulFrame'
import { fulRoutes } from './ful/routes'
import { ME } from './ful/data'
import { DeedstoneCallProvider } from './DeedstoneCall'
// P908: the phone screens load last so the desktop CSS order stays as it was.
import MOverview from './m/MOverview'
import MLeads from './m/MLeads'
import MClients from './m/MClients'
import MCalendar from './m/MCalendar'
import MMore from './m/MMore'

// The sample VA signed in to the Fulfillment preview (nothing leaves the browser).
const VA = { live: false, name: ME.name, signOut: null, DeleteDialog: null }

// The clickable agent-side template (and, P845, the Fulfillment side under /template/fulfillment): sample info only, its own router, nothing leaves the browser.
export default function TemplateApp() {
  useEffect(() => {
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [])

  return (
    <BrowserRouter basename="/template">
      <NoteProvider>
        <DeedstoneCallProvider>
        <Routes>
          <Route path="signup" element={<Signup />} />
          <Route path="welcome" element={<Welcome />} />
          <Route path="d/:page" element={<Deedstone />} />
          {/* P908: below 768 px the phone build (src/template/m) at the same addresses; desktop unchanged */}
          <Route element={<ShellFrame />}>
            <Route index element={<Pick d={Overview} m={MOverview} />} />
            <Route path="leads" element={<Pick d={Leads} m={MLeads} />} />
            <Route path="leads/:id" element={<Pick d={Leads} m={MLeads} />} />
            <Route path="calendar" element={<Pick d={Calendar} m={MCalendar} />} />
            <Route path="clients" element={<Pick d={Clients} m={MClients} />} />
            <Route path="clients/:id" element={<Pick d={Clients} m={MClients} />} />
            <Route path="submit" element={<Submit />} />
            <Route path="request-service" element={<RequestService />} />
            <Route path="messages" element={<Messages />} />
            <Route path="activity" element={<Activity />} />
            <Route path="billing" element={<Billing />} />
            <Route path="settings" element={<Settings />} />
            <Route path="more" element={<Pick d={More} m={MMore} />} />
          </Route>
          {/* P845: the Fulfillment (VA) side's preview at /template/fulfillment */}
          <Route element={<AccountProvider value={VA}><FulFrame /></AccountProvider>}>{fulRoutes({ preview: true })}</Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </DeedstoneCallProvider>
      </NoteProvider>
    </BrowserRouter>
  )
}
