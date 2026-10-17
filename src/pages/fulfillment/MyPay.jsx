import { useCallback, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  usePayouts, usePayoutAccounts, useConnectOverview, useRefreshPayouts, useSavePayoutEmails, useCancels, usePaySettings,
} from '../../hooks/useFulfillmentPayouts'
import { MyPayView } from '../../components/fulfillment/MyPay'
import { PhoneMyPay } from '../../components/fulfillment/phone/PhoneMyPay'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { PayoutSettingsView } from '../../components/fulfillment/PayoutSettings'
import { payPeriod } from '../../lib/payPeriod'
import { accountStatus, cancelTotals, isoDay } from '../../lib/myPay'
import { useNow } from '../../lib/agentBookings'

// Prompt 753 — /fulfillment/pay, "My pay" (Getting Paid before; the old
// /fulfillment/getting-paid redirects here). Two views, like Manage billing:
// the page, and Payout settings at ?settings=1 (?setup=1 also opens Stripe's
// onboarding). Prompt 764: pay per verified cancel. The week comes from the
// rep's fulfillment_cancels (status + amount, nothing else); paid weeks from
// fulfillment_payouts (written by the Monday pay run); the account card from
// fulfillment_payout_accounts, refreshed live from Stripe through
// fulfillment-connect-session once the rep has started setup.

// The payouts list: real payout rows, plus this week's (and, before Monday's
// run, last week's) upcoming amount. A held / failed row is dropped once a
// later payout went out (its cancels were paid in that one).
function payoutList(rows, cancels, now) {
  const list = rows.filter((p, i) => !(['held', 'failed'].includes(p.status) && rows.slice(0, i).some(q => q.status === 'paid')))
  const add = []
  for (const back of [0, 7]) {
    const per = payPeriod(now - back * 864e5)
    const start = isoDay(per.start)
    if (list.some(p => p.period_start === start)) continue
    const t = cancelTotals(cancels.filter(c => c.week_start === start && !c.paid_at))
    if (back && !t.verifiedCents) continue
    const end = new Date(per.end.getTime() - 864e5)
    add.push({
      // This week: what's earned so far (verified + being checked), as in the hero.
      id: `upcoming-${start}`, period_start: start, period_end: isoDay(end), amount_cents: back ? t.verifiedCents : t.earnedCents,
      cancels: back ? t.verified : t.verified + t.checking, status: 'upcoming', sub: back ? 'Last week · paid Monday' : 'This week · verified by Sunday',
    })
  }
  return [...add, ...list]
}

export default function MyPay() {
  const { profile, refreshProfile } = useAuth()
  const phone = usePhoneLayout()
  const now = useNow(30e3)
  const [which, setWhich] = useState('this')
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const settings = params.get('settings') === '1'
  const period = useMemo(() => payPeriod(which === 'last' ? now - 7 * 864e5 : now), [which, now])

  const since = useMemo(() => isoDay(payPeriod(now - 7 * 864e5).start), [now])
  const { data: cancels = [] } = useCancels(profile?.id, since, !!profile)
  const { data: paySettings } = usePaySettings()
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

  if (phone) {
    const week = payPeriod(now)
    return (
      <PhoneMyPay
        period={week} now={now}
        weekCancels={cancels.filter(c => c.week_start === isoDay(week.start))}
        rate={paySettings?.pay_per_cancel_cents ?? 1000}
        payouts={payoutList(payouts, cancels, now)} account={account} status={status}
        accountLoading={accountsLoading || (started && overview.isLoading && !stored)}
        onConnect={() => open({ settings: '1', setup: '1' })}
        onSettings={() => open({ settings: '1' })}
      />
    )
  }

  return (
    <MyPayView
      which={which} onWhich={setWhich} period={period} now={now}
      weekCancels={cancels.filter(c => c.week_start === isoDay(period.start))}
      rate={paySettings?.pay_per_cancel_cents ?? 1000} minCents={paySettings?.weekly_min_cents ?? null}
      payouts={payoutList(payouts, cancels, now)} account={account} status={status}
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
