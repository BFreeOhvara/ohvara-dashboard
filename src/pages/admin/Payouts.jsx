import { useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useAllProfiles } from '../../hooks/useProfiles'
import {
  invokeConnect, loadRecordingUrl, useDecideCancel, useNeedsListen, usePayRuns, usePaySettings, usePayoutAccounts,
  useRefreshPayouts, useSavePaySettings, useStripeBalance, useUnpaidVerified,
} from '../../hooks/useFulfillmentPayouts'
import { PayoutsView } from '../../components/admin/PayoutsView'
import { bankText, payoutsModel } from '../../lib/adminPayouts'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import { useNow } from '../../lib/agentBookings'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { AdminPhonePay } from '../../components/admin/phone/AdminPhonePay'

// Admin Payouts (Prompt 761; simple version Prompt 765, mockup
// media/admin-redesign/admin-payouts-simple.dc.html). Pay is per verified
// cancel and goes out by itself every Monday 8 AM Central
// (fulfillment-pay-week, Prompt 764), so nothing here approves or pays. This
// page shows the next run, the cancels that need a listen (Pay it / Don't pay
// through fulfillment_decide_cancel), the past runs, and the payout settings.
// The wiring only; the numbers are in lib/adminPayouts.js and the look in
// components/admin/PayoutsView.jsx.

// Prompt 774 — under 768px, inside the admin phone shell, the phone screen.
export default function AdminPayouts() {
  return usePhoneLayout() ? <AdminPhonePay /> : <AdminPayoutsDesktop />
}

function AdminPayoutsDesktop() {
  const { profile } = useAuth()
  const now = useNow(60e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE

  const settings = usePaySettings()
  const unpaid = useUnpaidVerified()
  const listen = useNeedsListen()
  const runs = usePayRuns()
  const accounts = usePayoutAccounts(null)
  const profiles = useAllProfiles()
  const balance = useStripeBalance()
  const decide = useDecideCancel()
  const savePay = useSavePaySettings()
  const refresh = useRefreshPayouts()

  const people = useMemo(() => new Map((profiles.data || []).map(p => [p.id, p])), [profiles.data])
  const model = useMemo(() => payoutsModel({
    now, settings: settings.data, unpaid: unpaid.data || [], listen: listen.data || [], accounts: accounts.data || [], runs: runs.data || [],
  }), [now, settings.data, unpaid.data, listen.data, accounts.data, runs.data])

  const mine = (accounts.data || []).find(a => a.rep_id === profile?.id) || null
  const loading = settings.isLoading || unpaid.isLoading || accounts.isLoading || profiles.isLoading
  const error = unpaid.error?.message || settings.error?.message || accounts.error?.message || ''

  return (
    <PayoutsView
      model={model} profiles={people} tz={tz} rate={settings.data?.pay_per_cancel_cents ?? 1000}
      loading={loading} error={error} listenError={listen.error?.message || ''}
      balance={balance.data ?? null} balanceLoading={balance.isLoading}
      bank={bankText(mine)} hasBankAccount={!!mine?.details_submitted}
      autoOn={!settings.data?.payouts_paused} savingAuto={savePay.isPending}
      onToggleAuto={on => savePay.mutate({ payouts_paused: !on })}
      deciding={decide.isPending ? decide.variables?.id : null}
      onDecide={args => decide.mutateAsync(args)}
      loadAudio={loadRecordingUrl}
      onBankClosed={() => { invokeConnect('overview').catch(() => {}).finally(refresh) }}
    />
  )
}
