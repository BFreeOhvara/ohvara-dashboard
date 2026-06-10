import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function DashboardLayout({ children }) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-[var(--bg-base)]">
      <Sidebar />
      {/* ml matches the fixed sidebar width (240px) */}
      <main className="ml-[240px] min-h-screen overflow-auto scrollbar-thin">
        <div key={pathname} className="max-w-6xl mx-auto p-6 page-enter">
          {children}
        </div>
      </main>
    </div>
  )
}
