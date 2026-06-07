import { Calendar } from 'lucide-react'
import { useMyAppointments } from '../../hooks/useAppointments'
import { AppointmentCard } from '../../components/closer/AppointmentCard'

export default function MyAppointments() {
  const { data: appointments, isLoading } = useMyAppointments()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">My Appointments</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            {appointments?.length ?? '…'} pending appointments
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[var(--bg-1)] border border-[var(--border)] animate-pulse" />
          ))}
        </div>
      ) : !appointments?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--bg-2)] flex items-center justify-center mb-4">
            <Calendar className="text-[var(--text-muted)]" size={24} />
          </div>
          <p className="text-[var(--text-secondary)] font-medium">No pending appointments</p>
          <p className="text-[var(--text-muted)] text-sm mt-1">New bookings will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map(appt => (
            <AppointmentCard key={appt.id} appt={appt} />
          ))}
        </div>
      )}
    </div>
  )
}
