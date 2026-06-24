import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ── Commission payouts (Prompt 55) ───────────────────────────────────────────
// The Stripe-payout workflow layer: pending → approved/paid → failed. Separate
// from the `commissions` earned-ledger (useMyCommission). RLS scopes rep reads
// to their own rows; admin sees all.

// Rep's own payout rows + the booked business/date for each.
export function useMyPayouts(repId) {
  return useQuery({
    queryKey: ['payouts', 'mine', repId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_payouts')
        .select('id, amount_cents, deal_value_cents, status, created_at, paid_at, appointment:appointments!appointment_id ( appointment_at, lead:leads ( business_name ) )')
        .eq('rep_profile_id', repId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!repId,
  })
}

// Admin: every payout with the rep name and the booked business/date.
export function useAllPayouts() {
  return useQuery({
    queryKey: ['payouts', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_payouts')
        .select('id, amount_cents, status, created_at, paid_at, stripe_transfer_id, rep_profile_id, appointment_id, rep:profiles!rep_profile_id ( full_name, stripe_onboarding_complete ), appointment:appointments!appointment_id ( appointment_at, lead:leads ( business_name ) )')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}

// Rep: start (or resume) Stripe Connect onboarding — returns a hosted URL.
export function useConnectOnboard() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', { body: {} })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data // { url }
    },
  })
}

// Rep: after Stripe redirects back, confirm the account is ready and flip the
// stripe_onboarding_complete flag in the DB. The caller does a full reload on
// success so useAuth re-fetches the profile (it holds it in React state, not
// react-query, so there's no cache to invalidate here).
export function useCheckOnboardStatus() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard', {
        body: { checkStatus: true },
      })
      if (error) throw error
      return data // { complete }
    },
  })
}

// Admin: approve & pay a pending payout via Stripe Transfer.
export function usePayCommission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payoutId) => {
      const { data, error } = await supabase.functions.invoke('stripe-pay-commission', {
        body: { payout_id: payoutId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })
}

// Admin: manually create a pending payout (back-fill for existing closes).
export function useCreatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ repProfileId, appointmentId, amountCents }) => {
      const { error } = await supabase.from('commission_payouts').insert({
        rep_profile_id: repProfileId,
        appointment_id: appointmentId,
        amount_cents: amountCents,
        status: 'pending',
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
  })
}
