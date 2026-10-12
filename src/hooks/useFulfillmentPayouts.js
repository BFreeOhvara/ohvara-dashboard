import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 753 — My pay on Stripe Connect (migration 138). Pay weeks live in
// fulfillment_payouts (hours + amount always computed by the server from the
// schedule); fulfillment_payout_accounts is what Stripe says about the rep's
// connected account (bank name + last 4 only). Payout settings talk to
// Stripe through fulfillment-connect-session; Approve & pay (admin) through
// fulfillment-pay-week. recovery_config.payouts_live is the off switch.

const KEY = ['fulfillment-payouts']

// supabase.functions.invoke hides a non-2xx body behind error.context; unwrap
// it so the page shows our message, like invokeBilling does.
async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) {
    let msg = error.message, code
    try {
      const j = await error.context?.json?.()
      if (j?.error) msg = j.error
      code = j?.code
    } catch { /* not JSON */ }
    const e = new Error(msg)
    e.code = code
    throw e
  }
  if (data?.error) {
    const e = new Error(data.error)
    e.code = data.code
    throw e
  }
  return data
}

export const invokeConnect = (action, extra = {}) => invoke('fulfillment-connect-session', { action, ...extra })

// Refresh this week + last week from the schedule (server-side), then read.
// `repId: null` = every rep RLS allows (admin: the team).
export function usePayouts(repId = null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'weeks', repId ?? 'all'],
    enabled,
    queryFn: async () => {
      const { error: syncError } = await supabase.rpc('fulfillment_sync_payouts', { p_rep: repId })
      if (syncError) console.warn('fulfillment_sync_payouts:', syncError.message)
      let q = supabase.from('fulfillment_payouts').select('*').order('period_start', { ascending: false }).limit(repId ? 12 : 200)
      if (repId) q = q.eq('rep_id', repId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

export function usePayoutAccounts(repId = null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'accounts', repId ?? 'all'],
    enabled,
    queryFn: async () => {
      let q = supabase.from('fulfillment_payout_accounts').select('*')
      if (repId) q = q.eq('rep_id', repId)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })
}

// Live from Stripe (and re-saves the summary). Only when the rep has started
// setup, so a fresh rep never waits on Stripe.
export function useConnectOverview(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'overview'],
    enabled,
    staleTime: 60e3,
    retry: false,
    queryFn: () => invokeConnect('overview'),
  })
}

export function usePayoutsLive() {
  return useQuery({
    queryKey: [...KEY, 'live'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recovery_config').select('payouts_live').limit(1).maybeSingle()
      if (error) throw error
      return !!data?.payouts_live
    },
  })
}

// Admin only (column grant + RLS on recovery_config).
export function useSetPayoutsLive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async on => {
      const { error } = await supabase.from('recovery_config')
        .update({ payouts_live: on, updated_at: new Date().toISOString() }).eq('id', true)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [...KEY, 'live'] }),
  })
}

export function usePayWeek() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ repId, periodStart }) => invoke('fulfillment-pay-week', { rep_id: repId, period_start: periodStart }),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useRefreshPayouts() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: KEY })
}

// The rep's two email switches live on their own profile row (P753).
export function useSavePayoutEmails() {
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('profiles').update(patch).eq('id', id)
      if (error) throw error
    },
  })
}
