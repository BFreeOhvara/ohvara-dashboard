import { Calendar } from 'lucide-react'
import { useMyAppointments } from '../../hooks/useAppointments'
import { AppointmentCard } from '../../components/closer/AppointmentCard'

export default function MyAppointments() {
  const { data: appointments, isLoading } = useMyAppointments()

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-100">My Appointments</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {appointments?.length ?? '…'} pending appointments
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#161b24] border border-[#2a3347] animate-pulse" />
          ))}
        </div>
      ) : !appointments?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-[#1e2433] flex items-center justify-center mb-4">
            <Calendar className="text-slate-500" size={24} />
          </div>
          <p className="text-slate-400 font-medium">No pending appointments</p>
          <p className="text-slate-600 text-sm mt-1">New bookings will appear here automatically.</p>
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
