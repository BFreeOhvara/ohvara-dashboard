import { useCallback, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentPay } from '../../hooks/useFulfillmentPay'
import {
  usePayouts, usePayoutAccounts, useConnectOverview, useRefreshPayouts, useSavePayoutEmails,
} from '../../hooks/useFulfillmentPayouts'
import { MyPayView } from '../../components/fulfillment/MyPay'
import { PayoutSettingsView } from '../../components/fulfillment/PayoutSettings'
import { payPeriod } from '../../lib/payPeriod'
import { accountStatus } from '../../lib/myPay'
import { useNow } from '../../lib/agentBookings'

// Prompt 753 — /fulfillment/pay, "My pay" (Getting Paid before; the old
// /fulfillment/getting-paid redirects here). Two views, like Manage billing:
// the page, and Payout settings at ?settings=1 (?setup=1 also opens Stripe's
// onboarding). Hours and the estimate come from the schedule
// (lib/payPeriod.js); pay weeks from fulfillment_payouts (server-computed);
// the account card from fulfillment_payout_accounts, refreshed live from
// Stripe through fulfillment-connect-session once the rep has started setup.

export default function MyPay() {
  const { profile, refreshProfile } = useAuth()
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const settings = params.get('settings') === '1'
  const period = useMemo(() => payPeriod(which === 'last' ? now - 7 * 864e5 : now), [which, now])

  const { data: payRows = [] } = useFulfillmentPay(profile?.id, !!profile)
  const { data: payouts = [] } = usePayouts(profile?.id, !!profile)
  const { data: accounts = [], isLoading: accountsLoading } = usePayoutAccounts(profile?.id, !!profile)
  const started = !!accounts[0]
  // Live check with Stripe: always in Payout settings, on My pay only once set up.
  const overview = useConnectOverview(!!profile && (settings || started))
  const refresh = useRefreshPayouts()

  const stored = accounts[0] || null
  const account = overview.data?.account
    ? { ...stored, ...overview.data.account, details_submitted: overview.data.status !== 'incomplete' && overview.data.status !== 'none' }
    : stored
  const status = overview.data?.status || accountStatus(stored)

  const open = (next, replace = false) => setParams(next, { replace, state: { payView: true } })
  const back = () => (location.state?.payView ? navigate(-1) : setParams({}, { replace: true }))
  const onChanged = useCallback(() => { refresh(); overview.refetch() }, [refresh, overview])

  const saveEmails = useSavePayoutEmails()
  const [emailState, setEmailState] = useState({ saved: false, error: '' })
  function onEmail(patch) {
    setEmailState({ saved: false, error: '' })
    saveEmails.mutate({ id: profile.id, patch }, {
      onSuccess: async () => { await refreshProfile(); setEmailState({ saved: true, error: '' }) },
      onError: e => setEmailState({ saved: false, error: e.message }),
    })
  }

  if (!profile) return null

  if (settings) {
    return (
      <PayoutSettingsView
        overview={overview.data} overviewLoading={overview.isLoading}
        overviewError={overview.error ? overview.error.message : ''}
        payouts={payouts} profile={profile} now={now}
        onBack={back} onChanged={onChanged}
        autoSetup={params.get('setup') === '1'}
        emails={{
          sent: profile.payout_email_sent !== false, problem: profile.payout_email_problem !== false,
          saving: saveEmails.isPending, ...emailState,
        }}
        onEmail={onEmail}
      />
    )
  }

  return (
    <MyPayView
      which={which} onWhich={setWhich} period={period} now={now}
      pay={payRows[0]} payouts={payouts} account={account} status={status}
      accountLoading={accountsLoading || (started && overview.isLoading && !stored)}
      onConnect={() => open({ settings: '1', setup: '1' })}
      onSettings={() => open({ settings: '1' })}
    />
  )
}

// The old /fulfillment/getting-paid path, query kept (?settings=1 still works).
export function GettingPaidRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/fulfillment/pay${search}`} replace />
}
