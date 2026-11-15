import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useConnectOverview } from '../hooks/useFulfillmentPayouts'
import { destination } from '../lib/myPay'
import { isMissing } from '../hooks/agentRealData'
import { useAccount } from '../template/kit'
import { useAdmAdmins } from './data'

// P1004 — the admin payout bank's data (PayoutBank1004.jsx shows it): your own bank from Stripe Connect when signed in
// (a sample bank in the signed-out preview), and owner payouts (off, split 50/50) from app_settings (migration 275).
const SAMPLE_BANK = { status: 'ready', text: 'Chase •••• 4821' }

export function useMyPayoutBank() {
  const { live } = useAccount()
  const q = useConnectOverview(!!live)
  if (!live) return { live: false, loading: false, ...SAMPLE_BANK, error: null }
  const status = q.data?.status || 'none'
  const setUp = status === 'ready' || status === 'action_needed'
  return { live: true, loading: q.isLoading, status, text: setUp ? destination(q.data?.account) : null, error: q.error?.message || null, refetch: q.refetch }
}

// app_settings.owner_payouts_on / owner_split_pct (275). Missing column or signed out: off, 50/50.
export function useOwnerPayouts() {
  const { live } = useAccount()
  const q = useQuery({
    queryKey: ['p1004', 'owner-payouts'],
    enabled: !!live,
    staleTime: 60e3,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('owner_payouts_on, owner_split_pct').eq('id', 1).maybeSingle()
      if (error) { if (isMissing(error)) return null; throw error }
      return data
    },
  })
  const pct = Number.isFinite(q.data?.owner_split_pct) ? q.data.owner_split_pct : 50
  return { on: q.data?.owner_payouts_on === true, pct }
}

// "Brayden 50% · Jordan 50%": the owner first, then the other admin (or "second owner" until they join).
export function useSplitLine() {
  const { data: admins } = useAdmAdmins()
  const { pct } = useOwnerPayouts()
  const first = s => String(s || '').trim().split(/\s+/)[0] || 'Admin'
  const owner = admins.find(a => a.owner) || admins[0]
  const other = admins.find(a => a !== owner)
  return `${first(owner?.name)} ${pct}% · ${other ? first(other.name) : 'second owner'} ${100 - pct}%`
}
