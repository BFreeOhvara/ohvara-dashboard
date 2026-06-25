import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { ActiveCallProvider } from '../../contexts/ActiveCallContext'
import { NotificationToast } from '../rep/NotificationToast'
import { useAuth } from '../../hooks/useAuth'

function ToastMount() {
  const { profile } = useAuth()
  if (!profile || !['rep', 'closer'].includes(profile.role)) return null
  return <NotificationToast profileId={profile.id} />
}

export function DashboardLayout({ children }) {
  const { pathname } = useLocation()
  const isFullWidth = pathname.includes('/messages')

  return (
    <ActiveCallProvider>
      <div className="min-h-screen bg-[var(--bg-base)]">
        <Sidebar />
        {/* ml matches the fixed sidebar width (240px) */}
        <main
          className={`ml-[240px] scrollbar-thin ${isFullWidth ? 'h-screen overflow-hidden flex flex-col' : 'min-h-screen overflow-auto'}`}
        >
          <div
            key={pathname}
            className={isFullWidth ? 'page-enter flex-1 overflow-hidden flex flex-col' : 'max-w-6xl mx-auto p-6 page-enter'}
          >
            {children}
          </div>
        </main>
        <ToastMount />
      </div>
    </ActiveCallProvider>
  )
}
