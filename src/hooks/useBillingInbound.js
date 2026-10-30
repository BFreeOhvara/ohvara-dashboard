import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invokeBilling } from '../lib/billing'
import { isNativeApp } from '../lib/native'

const KEY = ['billing-inbound']

// The agent's weekly inbound amounts (agent-billing inbound_get). Never asked for in the phone app.
export function useBillingInbound() {
  return useQuery({
    queryKey: KEY,
    enabled: !isNativeApp(),
    retry: false,
    queryFn: () => invokeBilling('inbound_get'),
  })
}

// inbound_set answers with the same shape as inbound_get. A refusal throws with the server's message.
export function useSetBillingInbound() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: body => invokeBilling('inbound_set', body),
    onSuccess: data => {
      qc.setQueryData(KEY, data)
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}
