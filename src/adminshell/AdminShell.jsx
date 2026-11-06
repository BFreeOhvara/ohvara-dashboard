import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import '../template/template.css'
import { NoteProvider, AccountProvider } from '../template/kit'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { ConfirmEmailBanner } from '../components/layout/ConfirmEmailBanner'
import AdminFrame from './AdminFrame'
import { admRouteEls } from './routes'
import { ap } from './paths'
import { ME } from './data'

// P849 — the Admin portal: the rebuilt admin pages (src/adminshell) on sample info, the same as the agent and VA
// shells until the backend step. Two mounts: the real admin URLs (ShellSwap passes the real name, the real sign-out
// and the delete-account dialog) and /preview/admin (nobody signed in, nothing leaves the browser). Today's admin
// pages stay in the code and stay reachable with ?classic=1, so the real switches, payouts and people keep working.
const SAMPLE = { live: false, name: ME.name, signOut: null, DeleteDialog: null }

function Page({ children, preview }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      {!preview && <ConfirmEmailBanner />}
      {children}
    </ErrorBoundary>
  )
}

export default function AdminShell({ account, preview = false }) {
  useEffect(() => {
    if (!preview) return undefined
    const tag = document.createElement('meta')
    tag.name = 'robots'
    tag.content = 'noindex'
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [preview])
  return (
    <AccountProvider value={preview ? SAMPLE : account}>
      <NoteProvider>
        <Routes>
          <Route element={<AdminFrame preview={preview} />}>{admRouteEls({ preview, wrap: el => <Page preview={preview}>{el}</Page> })}</Route>
          <Route path="*" element={<Navigate to={ap('overview', null, preview)} replace />} />
        </Routes>
      </NoteProvider>
    </AccountProvider>
  )
}
