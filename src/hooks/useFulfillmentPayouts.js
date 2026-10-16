import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Prompt 753 — My pay on Stripe Connect (migration 138); Prompt 764 pays per
// verified cancel (migration 145). Paid weeks live in fulfillment_payouts
// (written only by the Monday pay run, fulfillment-pay-week; nobody
// approves); fulfillment_payout_accounts is what Stripe says about the rep's
// connected account (bank name + last 4 only). Payout settings talk to
// Stripe through fulfillment-connect-session. recovery_config.payouts_live is
// the off switch, payouts_paused skips runs.

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

// Payout rows (Prompt 764: written only by the Monday pay run, one per rep
// per pay week). `repId: null` = every rep RLS allows (admin: the team).
export function usePayouts(repId = null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'weeks', repId ?? 'all'],
    enabled,
    queryFn: async () => {
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

// Prompt 764 — the pay settings on recovery_config (admin writes; anyone
// signed in reads): payouts_live, payouts_paused, pay_per_cancel_cents,
// weekly_min_cents (null = off), weekly_cancel_cap.
const PAY_COLS = 'payouts_live, payouts_paused, pay_per_cancel_cents, weekly_min_cents, weekly_cancel_cap'
export function usePaySettings() {
  return useQuery({
    queryKey: [...KEY, 'settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('recovery_config').select(PAY_COLS).limit(1).maybeSingle()
      if (error) throw error
      return data || { payouts_live: false, payouts_paused: false, pay_per_cancel_cents: 1000, weekly_min_cents: null, weekly_cancel_cap: 40 }
    },
  })
}
export const usePayoutsLive = () => {
  const q = usePaySettings()
  return { ...q, data: !!q.data?.payouts_live }
}

export function useSavePaySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async patch => {
      const { error } = await supabase.from('recovery_config')
        .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true)
      if (error) throw error
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [...KEY, 'settings'] })
      qc.invalidateQueries({ queryKey: ['recovery-config'] })
    },
  })
}
export function useSetPayoutsLive() {
  const save = useSavePaySettings()
  return { ...save, mutate: (on, opts) => save.mutate({ payouts_live: on }, opts) }
}

// Prompt 764 — cancels (fulfillment_cancels, migration 145): one row per
// Cancelled result, its status and pay. A rep reads their own (RLS), an
// admin all. `since` = the earliest week_start ('YYYY-MM-DD').
export function useCancels(repId = null, since = null, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'cancels', repId ?? 'all', since],
    enabled,
    refetchInterval: q => (q.state.data?.some(c => c.status === 'checking') ? 30e3 : false),
    queryFn: async () => {
      let q = supabase.from('fulfillment_cancels')
        .select('id, policy_id, rep_id, agent_id, client_name, carrier_name, agent_name, logged_at, week_start, amount_cents, status, reason, verified_at, decided_at, payout_id, paid_at')
        .neq('status', 'void').order('logged_at', { ascending: false }).limit(500)
      if (repId) q = q.eq('rep_id', repId)
      if (since) q = q.gte('week_start', since)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
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

// Prompt 765 — Admin Payouts. Admin-only reads (RLS: is_admin) and the
// decision RPC. Nothing here moves money; the Monday run does that.

// Verified cancels not yet paid: what the next Monday run will pay.
export function useUnpaidVerified(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'unpaid'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('fulfillment_cancels')
        .select('id, rep_id, amount_cents, week_start, logged_at')
        .in('status', ['verified', 'verified_by_admin']).is('paid_at', null).limit(1000)
      if (error) throw error
      return data || []
    },
  })
}

// Cancels waiting on Brayden, with where the AI thinks the carrier says it and
// the recording's length (the audio itself only comes through
// fulfillment-recording).
export function useNeedsListen(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'needs-listen'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('fulfillment_cancels')
        .select('id, rep_id, client_name, carrier_name, agent_name, logged_at, amount_cents, reason, listen_at_seconds, recording_id, recording:fulfillment_recordings(id, status, duration_seconds)')
        .eq('status', 'needs_listen').order('logged_at', { ascending: true }).limit(100)
      if (error) throw error
      return data || []
    },
  })
}

// Finished pay runs that paid someone, newest first.
export function usePayRuns(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'runs'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('fulfillment_pay_runs')
        .select('id, pay_date, period_start, status, cancels, paid_cents, paid_reps')
        .gt('paid_cents', 0).order('pay_date', { ascending: false }).limit(8)
      if (error) throw error
      return data || []
    },
  })
}

// Pay it / Don't pay (a reason is required for Don't pay).
export function useDecideCancel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, pay, note }) => {
      const { error } = await supabase.rpc('fulfillment_decide_cancel', { p_cancel: id, p_pay: pay, p_note: note?.trim() || null })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

// Ohvara's Stripe balance, live, through the admin-only
// fulfillment-stripe-balance function. Not retried: if the function isn't
// deployed or Stripe is down the page says "Balance unavailable".
export function useStripeBalance(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'balance'],
    enabled,
    staleTime: 60e3,
    retry: false,
    queryFn: async () => (await invoke('fulfillment-stripe-balance', {})).available_cents,
  })
}

// The recording as a blob URL, fetched with the admin's session (an <audio
// src> can't send the header). Not cached: it's never stored anywhere.
export async function loadRecordingUrl(recordingId) {
  const { data: s } = await supabase.auth.getSession()
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fulfillment-recording?id=${encodeURIComponent(recordingId)}`, {
    headers: { Authorization: `Bearer ${s?.session?.access_token || ''}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
  })
  if (!res.ok) {
    let msg = 'Couldn’t load the recording'
    try { msg = (await res.json())?.error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return URL.createObjectURL(await res.blob())
}
