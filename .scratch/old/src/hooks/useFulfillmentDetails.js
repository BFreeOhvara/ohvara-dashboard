import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 419 — the full Fulfillment intake record (bank/DL/beneficiary/
// address/current carrier), 1:1 with a policy via policy_id. Isolated from
// usePolicies.js on purpose: this table's RLS (migration 104) is
// deliberately tighter than the Fulfillment Queue listing itself — only the
// submitting agent, the specific claimant, or admin can read a row — so it
// reads as its own narrow surface, not a variant of the general policies
// query surface.

export function useCreateFulfillmentDetails() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fields) => {
      const { data, error } = await supabase
        .from('policy_fulfillment_details')
        .insert(fields)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['fulfillment-details', vars.policy_id] })
    },
  })
}

// `enabled` should mirror the same claim check the RLS itself enforces
// (claimed-by-me or admin) — querying before that just returns a clean
// "no rows" empty result under RLS, but there's no reason to fire the
// request at all until the caller can actually see something.
export function usePolicyFulfillmentDetails(policyId, enabled) {
  return useQuery({
    queryKey: ['fulfillment-details', policyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('policy_fulfillment_details')
        .select('*')
        .eq('policy_id', policyId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!policyId && !!enabled,
  })
}
