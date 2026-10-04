import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAppSettings } from '../../hooks/useAppSettings'
import { card, cardTitle, primaryBtn, ghostBtn, MONO } from '../../lib/exportStyles'
import { GapNote } from '../ui/ExportForm'
import {
  BILLING_STATUS, TONE_STYLE, formatWeekly, formatBillingDate, daysUntil, invokeBilling,
} from '../../lib/billing'

// ── Billing (Prompt 673) ────────────────────────────────────────────────────
// The agent's $350/week retainer. Card entry, cancelling and invoices all
// happen on Stripe-hosted pages (Checkout to subscribe, Customer Portal to
// manage), so no card data ever touches this app. Until the agent-billing
// edge function is deployed with a Stripe key, `status` fails and the panel
// says billing isn't connected, same pattern as Caller ID.
// Prompt 691 — moved out of Settings into its own page (/agent/billing).
export function BillingPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const { data: settings } = useAppSettings()
  const [configured, setConfigured] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const price = formatWeekly(settings?.agent_billing_weekly_cents)
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

  async function go(action) {
    setError(''); setBusy(true)
    try {
      const d = await invokeBilling(action)
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
        Portal access is a flat <span style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{price}</span> a week,
        charged weekly to your card, and it covers that week's batch of cancellations. Cancel any time: you keep
        access through the end of the week you've paid for.
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

      {status !== 'exempt' && configured === false && (
        <GapNote>
          Billing isn't connected yet, so nothing is being charged and your access isn't affected. Subscribing
          switches on here once it is.
        </GapNote>
      )}

      {status !== 'exempt' && configured && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {!subscribed && (
            <button onClick={() => go('checkout')} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <>Subscribe · <span style={{ fontFamily: MONO }}>{price}</span>/week</>}
            </button>
          )}
          {subscribed && (
            <button onClick={() => go('portal')} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>
              {status === 'past_due' ? 'Update card' : status === 'canceled' ? 'Renew or manage' : 'Manage billing'}
            </button>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Opens on Stripe's secure site.</span>
        </div>
      )}

      {error && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
