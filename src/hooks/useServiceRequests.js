import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Migration 187 — a service request on a client the agent already has. The
// RPC is the only way in (service_requests has no insert grant). A request
// doesn't count against the week's submissions. Refusals carry a hint:
// no_servicing (a Leads-only account) and not_live (submit_live is off).
export const REQUEST_KINDS = [
  { value: 'beneficiary_change', label: 'Beneficiary change', hint: 'Who gets the payout', group: 'change' },
  { value: 'address_change', label: 'Address change', hint: 'A new home or mailing address', group: 'change' },
  { value: 'payment_method_change', label: 'Payment method change', hint: 'A new bank account or card', group: 'change' },
  { value: 'draft_date_change', label: 'Draft date change', hint: 'Move the day the premium is taken', group: 'change' },
  { value: 'lapse_help', label: 'Lapse help', hint: 'The policy lapsed or is about to', group: 'help' },
  { value: 'claims_help', label: 'Claims help', hint: 'Help filing or following a claim', group: 'help' },
  { value: 'carrier_call', label: 'Carrier call', hint: 'We call the carrier with them', group: 'help' },
]
export const kindLabel = v => REQUEST_KINDS.find(k => k.value === v)?.label || ''

// What each kind asks in the note box.
export const NOTE_LABEL = {
  beneficiary_change: 'Who’s the new beneficiary',
  address_change: 'What’s the new address',
  payment_method_change: 'What needs to change on the payment',
  draft_date_change: 'Which day should the draft move to',
  lapse_help: 'What happened with the policy',
  claims_help: 'What’s the claim about',
  carrier_call: 'What should we ask the carrier',
}

export function useSubmitServiceRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ policyId, kind, note, bestTime }) => {
      const { data, error } = await supabase.rpc('agent_submit_service_request', {
        p_policy: policyId, p_kind: kind, p_note: note || null, p_best_time: bestTime || null,
      })
      if (error) throw error
      return data
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })
}
