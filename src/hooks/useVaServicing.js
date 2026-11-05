import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isDutyMissing } from '../lib/duty'

// P837 — the VA servicing desk (/fulfillment/servicing). Reads and writes only through
// migration 206's functions: va_servicing_queue, _claim, _release, _schedule, _outcome,
// _done, _cancel, _send_to_agent. Nothing writes servicing_tasks directly, and nothing
// here texts, emails or calls anyone. RLS keeps a VA to the queue and their own claim.

const KEY = ['va-servicing']

export function useVaServicingQueue(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'queue'],
    enabled,
    refetchInterval: 30e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('va_servicing_queue')
      if (error) {
        if (isDutyMissing(error)) return []
        throw error
      }
      return data || []
    },
  })
}

function useCall(fn, toArgs) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async vars => {
      const { data, error } = await supabase.rpc(fn, toArgs(vars))
      if (error) throw error
      return data
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useVaServicingDesk() {
  return {
    claim: useCall('va_servicing_claim', task => ({ p_task: task })),
    release: useCall('va_servicing_release', task => ({ p_task: task })),
    schedule: useCall('va_servicing_schedule', ({ task, at }) => ({ p_task: task, p_at: at })),
    outcome: useCall('va_servicing_outcome', ({ task, outcome }) => ({ p_task: task, p_outcome: outcome })),
    done: useCall('va_servicing_done', task => ({ p_task: task })),
    cancel: useCall('va_servicing_cancel', ({ task, reason }) => ({ p_task: task, p_reason: reason })),
    send: useCall('va_servicing_send_to_agent', ({ task, reason, question }) => ({ p_task: task, p_reason: reason, p_question: question })),
  }
}
