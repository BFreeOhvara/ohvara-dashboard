import { useMemo } from 'react'
import { usePayRuns, usePaySettings, useStripeBalance } from '../../../hooks/useFulfillmentPayouts'
import { payoutsModel } from '../../../lib/adminPayouts'
import { useNow } from '../../../lib/agentBookings'

// Prompt 774 — the admin phone's pay picture, shared by the Pay tab, Home's
// Needs you and the tab bar's amber dot (same react-query keys as desktop
// Payouts, so the reads are shared). P890: VAs are paid by the hour, so this
// is only the pay mode and the past runs. `state`: Monday's run will
//   auto    go out by itself
//   paused  not go: automatic payouts are paused
//   off     not go: payouts aren't live yet
// `alert` lights the dot when the run won't go out.

export function useAdminPay() {
  const now = useNow(60e3)
  const settings = usePaySettings()
  const runs = usePayRuns()
  const balance = useStripeBalance()

  const model = useMemo(() => payoutsModel({ now, settings: settings.data, runs: runs.data || [] }), [now, settings.data, runs.data])

  const state = model.mode
  const loaded = !settings.isLoading
  return {
    model, state, balance: balance.data ?? null, settings: settings.data,
    loading: settings.isLoading,
    error: settings.error?.message || runs.error?.message || '',
    listenError: '',
    alert: loaded && state !== 'auto',
    refetch: () => [settings, runs].forEach(q => q.isError && q.refetch()),
  }
}

// "Tue 4:20 PM" — a time in the admin's zone.
export const listenWhen = (iso, tz) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`
}
