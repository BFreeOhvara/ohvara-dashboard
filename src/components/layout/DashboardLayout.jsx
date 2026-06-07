import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function DashboardLayout({ children }) {
  const { pathname } = useLocation()

  return (
    <div className="flex min-h-screen bg-[var(--bg-base)]">
      <Sidebar />
      <main className="flex-1 overflow-auto scrollbar-thin">
        <div key={pathname} className="max-w-6xl mx-auto p-6 page-enter">
          {children}
        </div>
      </main>
    </div>
  )
}
