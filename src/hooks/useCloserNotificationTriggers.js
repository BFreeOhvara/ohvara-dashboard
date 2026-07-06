import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Appointment booked notifier ──────────────────────────────────────────────
// Listens for realtime INSERTs on appointments where closer_id = closerId.
// Fetches the lead's business_name and inserts an appointment_booked notification.
export function useAppointmentBookedNotifier(closerId) {
  const qc = useQueryClient()
  const notifiedThisSession = useRef(new Set())

  useEffect(() => {
    if (!closerId) return
    const channel = supabase
      .channel(`appt-booked-${closerId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'appointments',
        filter: `closer_id=eq.${closerId}`,
      }, async (payload) => {
        const apptId = payload.new?.id
        if (!apptId || notifiedThisSession.current.has(apptId)) return
        notifiedThisSession.current.add(apptId)

        let bizName = 'a new lead'
        if (payload.new?.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('business_name')
            .eq('id', payload.new.lead_id)
            .single()
          if (lead?.business_name) bizName = lead.business_name
        }

        await supabase.from('notifications').insert({
          profile_id: closerId,
          type: 'appointment_booked',
          message: `New appointment booked: ${bizName}`,
          data: {
            appointment_id: apptId,
            lead_id: payload.new?.lead_id,
            business_name: bizName,
          },
        })
        qc.invalidateQueries({ queryKey: ['rep-notifications', closerId] })
        qc.invalidateQueries({ queryKey: ['rep-notifications-unread', closerId] })
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [closerId, qc])
}

// ── Call recording graded notifier ───────────────────────────────────────────
// Mirrors useCallGradedNotifier in useRepNotificationTriggers.js.
// Listens for UPDATE on calls where rep_id = closerId and graded_at transitions
// null → set (the grade-call edge function writes this field on completion).
// Invalidates notification cache so the bell refreshes immediately.
export function useCloserCallGradedNotifier(closerId) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!closerId) return
    const channel = supabase
      .channel(`closer-call-graded-${closerId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls',
        filter: `rep_id=eq.${closerId}`,
      }, (payload) => {
        if (payload.new?.graded_at && !payload.old?.graded_at) {
          qc.invalidateQueries({ queryKey: ['rep-notifications', closerId] })
          qc.invalidateQueries({ queryKey: ['rep-notifications-unread', closerId] })
          qc.invalidateQueries({ queryKey: ['closer-calls', closerId] })
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [closerId, qc])
}

// ── Appointment 5-minute reminder notifier ───────────────────────────────────
// Polls every 60s for pending appointments with scheduled_at within the next
// 6 minutes. Fires a one-time reminder per appointment per session.
export function useAppointmentReminder5MinNotifier(closerId) {
  const qc = useQueryClient()
  const notifiedThisSession = useRef(new Set())

  useEffect(() => {
    if (!closerId) return

    async function check() {
      const now = new Date()
      const soon = new Date(now.getTime() + 6 * 60 * 1000)

      const { data: appts } = await supabase
        .from('appointments')
        .select('id, scheduled_at, lead:leads(business_name)')
        .eq('closer_id', closerId)
        .eq('status', 'pending')
        .gte('scheduled_at', now.toISOString())
        .lte('scheduled_at', soon.toISOString())

      if (!appts?.length) return

      const toNotify = appts.filter(a => {
        if (notifiedThisSession.current.has(a.id)) return false
        notifiedThisSession.current.add(a.id)
        return true
      })
      if (!toNotify.length) return

      await Promise.all(
        toNotify.map(a => supabase.from('notifications').insert({
          profile_id: closerId,
          type: 'appointment_reminder_5min',
          message: `You have an appointment in 5 minutes: ${a.lead?.business_name || 'a lead'}`,
          data: {
            appointment_id: a.id,
            business_name: a.lead?.business_name || null,
            scheduled_at: a.scheduled_at,
          },
        }))
      )
      qc.invalidateQueries({ queryKey: ['rep-notifications', closerId] })
      qc.invalidateQueries({ queryKey: ['rep-notifications-unread', closerId] })
    }

    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [closerId, qc])
}
