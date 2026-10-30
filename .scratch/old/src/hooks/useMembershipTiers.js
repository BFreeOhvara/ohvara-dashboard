import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Every active membership tier (migration 180), in row order, for Plan & billing. Prices, ad %
// and counts are Brayden's and still null; the page shows "Price set by Ohvara" for a null price.
// A failed read throws, so the page can say it couldn't load (Today's usage card reads the same
// table through useMembershipTier in useInbounds.js and stays quiet instead).
export function useMembershipTiers() {
  const { profile } = useAuth()
  return useQuery({
    queryKey: ['membership-tiers', 'all'],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_tiers')
        .select('key, name, product_keys, price_cents, monthly_appointments, description, sort_order, is_active')
        .eq('is_active', true).order('sort_order')
      if (error) throw error
      return data || []
    },
  })
}
