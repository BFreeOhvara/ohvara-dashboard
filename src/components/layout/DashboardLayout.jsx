import { Sidebar } from './Sidebar'

export function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-[#0f1117]">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6 scrollbar-thin">
        {children}
      </main>
    </div>
  )
}
