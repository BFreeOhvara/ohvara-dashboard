import { useMemo } from 'react'
import {
  useNeedsListen, usePayRuns, usePaySettings, usePayoutAccounts, useStripeBalance, useUnpaidVerified,
} from '../../../hooks/useFulfillmentPayouts'
import { payoutsModel } from '../../../lib/adminPayouts'
import { useNow } from '../../../lib/agentBookings'

// Prompt 774 — the admin phone's pay picture, shared by the Pay tab, Home's
// Needs you and the tab bar's amber dot (same react-query keys as desktop
// Payouts, so the reads are shared). `state`: the next run will
//   auto    pay by itself
//   paused  not pay: automatic payouts are paused
//   short   not pay: the Stripe balance doesn't cover it
//   off     not pay: payouts aren't live yet
// `alert` lights the dot: a cancel needs a listen, or the next run won't pay.

export function useAdminPay() {
  const now = useNow(60e3)
  const settings = usePaySettings()
  const unpaid = useUnpaidVerified()
  const listen = useNeedsListen()
  const runs = usePayRuns()
  const accounts = usePayoutAccounts(null)
  const balance = useStripeBalance()

  const model = useMemo(() => payoutsModel({
    now, settings: settings.data, unpaid: unpaid.data || [], listen: listen.data || [], accounts: accounts.data || [], runs: runs.data || [],
  }), [now, settings.data, unpaid.data, listen.data, accounts.data, runs.data])

  const cents = model.nextRun.cents
  const bal = balance.data ?? null
  const short = bal != null && cents > 0 && bal < cents
  const state = model.mode === 'off' ? 'off' : model.mode === 'paused' ? 'paused' : short ? 'short' : 'auto'
  const loaded = !settings.isLoading
  return {
    model, state, balance: bal, settings: settings.data,
    loading: settings.isLoading || unpaid.isLoading || accounts.isLoading,
    error: unpaid.error?.message || settings.error?.message || accounts.error?.message || '',
    listenError: listen.error?.message || '',
    alert: model.listen.length > 0 || (loaded && state !== 'auto'),
    refetch: () => [settings, unpaid, listen, accounts].forEach(q => q.isError && q.refetch()),
  }
}

// "Tue 4:20 PM" — when a cancel was logged, in the admin's zone.
export const listenWhen = (iso, tz) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}`
}
