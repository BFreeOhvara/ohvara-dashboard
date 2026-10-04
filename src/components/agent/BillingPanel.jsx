import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { card, cardTitle, primaryBtn, ghostBtn, MONO } from '../../lib/exportStyles'
import { GapNote } from '../ui/ExportForm'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import {
  BILLING_STATUS, TONE_STYLE, formatWeekly, formatBillingDate, daysUntil, invokeBilling,
  capState, capLabel, formatReset,
} from '../../lib/billing'

// ── Billing (Prompt 673) ────────────────────────────────────────────────────
// The agent's weekly retainer. Card entry, cancelling and invoices all
// happen on Stripe-hosted pages (Checkout to subscribe, Customer Portal to
// manage), so no card data ever touches this app. Until the agent-billing
// edge function is deployed with a Stripe key, `status` fails and the panel
// says billing isn't connected, same pattern as Caller ID.
// Prompt 691 — moved out of Settings into its own page (/agent/billing).
// Prompt 692 — two plans (Standard / Premium, rows of agent_billing_tiers)
// that differ by weekly submission cap; switching goes through the Customer
// Portal's plan switcher (upgrade bills the difference now, downgrade waits
// for the end of the paid week).
export function BillingPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage } = useWeeklyUsage(profile.id)
  const [configured, setConfigured] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const currentTier = tiers.find(t => t.key === profile.billing_tier) || tiers[0]
  const price = formatWeekly(currentTier?.weekly_cents)
  const cap = capState(usage)
  const status = profile.billing_status || 'none'
  const meta = BILLING_STATUS[status] || BILLING_STATUS.none
  const periodEnd = formatBillingDate(profile.billing_current_period_end)
  const graceEnd = formatBillingDate(profile.billing_grace_until)
  const subscribed = ['active', 'past_due', 'canceled'].includes(status)

  // Prompt 677 — time-remaining at a glance: days to the next charge while
  // active, days of paid access left once cancelled.
  const days = ['active', 'canceled'].includes(status) ? daysUntil(profile.billing_current_period_end) : null
  const countdown = days === null ? null : {
    value: days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`,
    caption: status === 'canceled' ? 'until access ends' : `until next ${price} charge`,
  }

  // canceled = cancel-at-period-end, still inside the paid week: renewing goes
  // through the Customer Portal so it un-cancels the same subscription rather
  // than Checkout starting a second one.

  // Coming back from Stripe: the webhook has usually landed by now, so pull
  // the fresh row once. refreshProfile isn't memoized; run this on mount only.
  useEffect(() => {
    invokeBilling('status')
      .then(d => setConfigured(!!d.configured))
      .catch(() => setConfigured(false))
    refreshProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const detail = {
    none:     'No subscription yet.',
    active:   periodEnd ? `Paid through ${periodEnd}. Renews automatically.` : 'Paid up. Renews automatically.',
    past_due: graceEnd ? `Your last payment failed. Update your card by ${graceEnd} to keep access.` : 'Your last payment failed. Update your card to keep access.',
    lapsed:   'Your subscription has lapsed. Subscribe again to get back in.',
    canceled: periodEnd ? `Cancelled. Access runs through ${periodEnd}.` : 'Cancelled.',
    exempt:   "Your account isn't billed.",
  }[status]

  async function go(action, extra) {
    setError(''); setBusy(true)
    try {
      const d = await invokeBilling(action, extra)
      if (!d?.url) throw new Error('Stripe did not return a page to open')
      window.location.assign(d.url)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div style={{ ...card }}>
      <p style={cardTitle}>Billing</p>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 560 }}>
        Portal access is billed weekly to your card and covers that week's batch of cancellations. Your plan sets
        how many submissions you can book each week (Monday to Sunday); the cap is per account, so it doesn't
        grow with the number of people on one login. Cancel any time: you keep access through the end of the
        week you've paid for.
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 8, maxWidth: 560,
        background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
      }}>
        <span style={{
          display: 'inline-flex', padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600,
          whiteSpace: 'nowrap', ...TONE_STYLE[meta.tone],
        }}>
          {meta.label}
        </span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 13.5, color: 'var(--text-secondary)' }}>{detail}</span>
        {countdown && (
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{countdown.value}</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{countdown.caption}</p>
          </div>
        )}
      </div>

      {cap && (
        <div style={{ maxWidth: 560, marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>Submissions this week</span>
            <span style={{ fontFamily: MONO, fontSize: 14, color: cap.atCap ? 'var(--warning)' : 'var(--text-primary)' }}>
              {cap.cap == null ? `${cap.used} (no cap)` : `${cap.used} of ${cap.cap} used`}
            </span>
          </div>
          {cap.cap != null && (
            <div style={{ height: 6, borderRadius: 999, marginTop: 8, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, (cap.used / cap.cap) * 100)}%`, borderRadius: 999,
                background: cap.atCap ? 'var(--warning)' : 'var(--accent)',
              }} />
            </div>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            {cap.cap == null ? 'Nothing limits your submissions.' : `Resets ${formatReset(usage.week_end)} at midnight.`}
          </p>
        </div>
      )}

      {status !== 'exempt' && configured === false && (
        <GapNote>
          Billing isn't connected yet, so nothing is being charged and your access isn't affected. Subscribing
          switches on here once it is.
        </GapNote>
      )}

      {status !== 'exempt' && configured && tiers.length > 0 && (
        <>
          <p style={{ ...cardTitle, margin: '22px 0 10px', fontSize: 14 }}>
            {subscribed ? 'Your plan' : 'Choose a plan'}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', maxWidth: 560 }}>
            {tiers.map((t, i) => {
              const current = subscribed && t.key === profile.billing_tier
              const higher = i > tiers.findIndex(x => x.key === profile.billing_tier)
              return (
                <div key={t.key} style={{
                  flex: '1 1 240px', padding: '14px 16px', borderRadius: 10,
                  background: 'var(--bg-elevated)',
                  border: current ? '1px solid var(--accent)' : 'var(--border-w) solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</span>
                    {current && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)' }}>Current plan</span>}
                  </div>
                  <p style={{ margin: '6px 0 2px', fontFamily: MONO, fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {formatWeekly(t.weekly_cents)}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}> /week</span>
                  </p>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>{capLabel(t.weekly_cap)}</p>
                  {!subscribed && (
                    <button onClick={() => go('checkout', { tier: t.key })} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : `Subscribe to ${t.name}`}
                    </button>
                  )}
                  {subscribed && !current && ['active', 'past_due'].includes(status) && (
                    <>
                      <button onClick={() => go('portal', { flow: 'change_plan' })} disabled={busy} style={{ ...(higher ? primaryBtn : ghostBtn), opacity: busy ? 0.6 : 1 }}>
                        {higher ? `Upgrade to ${t.name}` : `Switch to ${t.name}`}
                      </button>
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                        {higher ? "You're charged the difference for this week now." : 'Takes effect at the end of your paid week.'}
                      </p>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {subscribed && (
              <button onClick={() => go('portal')} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
                {status === 'past_due' ? 'Update card' : status === 'canceled' ? 'Renew or manage' : 'Manage billing'}
              </button>
            )}
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Opens on Stripe's secure site.</span>
          </div>
        </>
      )}

      {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
