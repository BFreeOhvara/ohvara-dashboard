import { useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import {
  invokeConnect, usePayRuns, usePaySettings, usePayoutAccounts, useRefreshPayouts, useSavePaySettings, useStripeBalance,
} from '../../hooks/useFulfillmentPayouts'
import { PayoutsView } from '../../components/admin/PayoutsView'
import { bankText, payoutsModel } from '../../lib/adminPayouts'
import { useNow } from '../../lib/agentBookings'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { AdminPhonePay } from '../../components/admin/phone/AdminPhonePay'

// Admin Payouts (Prompt 761; simple version Prompt 765, mockup
// media/admin-redesign/admin-payouts-simple.dc.html). P890: VAs are paid by the
// hour from clock in and out, and pay goes out by itself every Monday 8 AM
// Central, so nothing here approves or pays. This page shows the next pay day,
// the past runs, and the payout settings. The wiring only; the numbers are in
// lib/adminPayouts.js and the look in components/admin/PayoutsView.jsx.

// Prompt 774 — under 768px, inside the admin phone shell, the phone screen.
export default function AdminPayouts() {
  return usePhoneLayout() ? <AdminPhonePay /> : <AdminPayoutsDesktop />
}

function AdminPayoutsDesktop() {
  const { profile } = useAuth()
  const now = useNow(60e3)

  const settings = usePaySettings()
  const runs = usePayRuns()
  const accounts = usePayoutAccounts(null)
  const balance = useStripeBalance()
  const savePay = useSavePaySettings()
  const refresh = useRefreshPayouts()

  const model = useMemo(() => payoutsModel({ now, settings: settings.data, runs: runs.data || [] }), [now, settings.data, runs.data])

  const mine = (accounts.data || []).find(a => a.rep_id === profile?.id) || null
  const loading = settings.isLoading || accounts.isLoading
  const error = settings.error?.message || runs.error?.message || accounts.error?.message || ''

  return (
    <PayoutsView
      model={model} loading={loading} error={error}
      balance={balance.data ?? null} balanceLoading={balance.isLoading}
      bank={bankText(mine)} hasBankAccount={!!mine?.details_submitted}
      autoOn={!settings.data?.payouts_paused} savingAuto={savePay.isPending}
      onToggleAuto={on => savePay.mutate({ payouts_paused: !on })}
      onBankClosed={() => { invokeConnect('overview').catch(() => {}).finally(refresh) }}
    />
  )
}
