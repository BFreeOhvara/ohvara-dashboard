import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMyAppointments() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['appointments', 'my', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          lead:leads(id, business_name, contact_name, phone, email, niche, city, pain_points, notes, job_title, monthly_labor_cost),
          rep:profiles!appointments_rep_id_fkey(id, full_name),
          reminders:reminder_log(id, scheduled_time, status, channel)
        `)
        .eq('closer_id', profile.id)
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })
}

export function usePastDeals() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['appointments', 'past', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          *,
          lead:leads(id, business_name, contact_name, niche, city),
          rep:profiles!appointments_rep_id_fkey(id, full_name)
        `)
        .eq('closer_id', profile.id)
        .neq('status', 'pending')
        .order('updated_at', { ascending: false })
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
