import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './template.css'
import { NoteProvider } from './kit'
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
import Signup from './screens/Signup'
import Welcome from './screens/Welcome'

// The clickable agent-side template: sample info only, its own router, nothing leaves the browser.
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
        <Routes>
          <Route path="signup" element={<Signup />} />
          <Route path="welcome" element={<Welcome />} />
          <Route element={<TemplateFrame />}>
            <Route index element={<Overview />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<Leads />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<Clients />} />
            <Route path="submit" element={<Submit />} />
            <Route path="request-service" element={<RequestService />} />
            <Route path="messages" element={<Messages />} />
            <Route path="activity" element={<Activity />} />
            <Route path="billing" element={<Billing />} />
            <Route path="settings" element={<Settings />} />
            <Route path="more" element={<More />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </NoteProvider>
    </BrowserRouter>
  )
}
