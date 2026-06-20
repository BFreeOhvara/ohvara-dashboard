import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Fetches both the pending pipeline (this closer's own + unassigned, picked
// up by anyone) AND this closer's own closed/lost/no-show history in one
// query — MyAppointments.jsx splits the result into Pending/Closed tabs
// client-side (Prompt 11, replaces the standalone Past Deals page).
export function useMyAppointments() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['appointments', 'my', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          lead:leads(id, business_name, contact_name, phone, email, niche, city, pain_points, notes, job_title, monthly_labor_cost, calls_missed_per_week, avg_ticket, recommended_automations, custom_monthly_price, recommended_stack, stack_generated_at),
          rep:profiles!appointments_rep_id_fkey(id, full_name),
          reminders:reminder_log(id, scheduled_time, status, channel)
        `)
        .or(`closer_id.eq.${profile.id},and(closer_id.is.null,status.eq.pending)`)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })
}

export function useUpdateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ appointmentId, updates }) => {
      const { data, error } = await supabase
        .from('appointments')
        .update(updates)
        .eq('id', appointmentId)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export function useAllAppointments() {
  return useQuery({
    queryKey: ['appointments', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          lead:leads(id, business_name, contact_name, niche, city),
          closer:profiles!appointments_closer_id_fkey(id, full_name),
          rep:profiles!appointments_rep_id_fkey(id, full_name),
          reminders:reminder_log(id, scheduled_time, status, channel)
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useReminderLog(appointmentId) {
  return useQuery({
    queryKey: ['reminders', appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminder_log')
        .select('*')
        .eq('appointment_id', appointmentId)
        .order('scheduled_time', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!appointmentId,
  })
}
