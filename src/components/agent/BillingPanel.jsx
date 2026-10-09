import { useEffect, useState } from 'react'
import { Crown, CreditCard, Lock, Info, ArrowRight, Check, Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { DISPLAY } from '../../lib/exportStyles'
import { useBillingTiers, useWeeklyUsage } from '../../hooks/useBillingTiers'
import {
  formatWeekly, formatBillingDate, daysUntil, invokeBilling, capState, nextTier, formatReset, GRACE_HOURS,
  isComped, shownStatus, renewsAt,
} from '../../lib/billing'
import { RenewalRing, BookingMeter, PlanCard, BillingFacts } from './AgentUI'

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
// Prompt 719 — rebuilt on the v16 language: a plan hero with a renewal ring,
// this week's bookings meter, plan cards, and a "no plan yet" page that sells
// the plans. Billing logic is unchanged.
// Prompt 725 — a comped account (billing_exempt) renders as Active on its
// tier, renewing at the end of its booking week, with the tier's cap. Its
// Stripe buttons answer "Your account isn't billed." and never open Stripe.

const DAY = 86400000
const fmtDay = ms => formatBillingDate(new Date(ms).toISOString())
// Ranked by cap; null (no cap) counts as the most.
const capRank = t => (t.weekly_cap == null ? Infinity : t.weekly_cap)
const mostBookings = tiers => tiers.reduce((best, t) => (!best || capRank(t) > capRank(best) ? t : best), null)
const listNames = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`)

const H2 = { margin: 0, fontFamily: DISPLAY, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ov-hi)' }

function B({ children }) {
  return <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{children}</span>
}

function Spin({ on, children }) {
  return on ? <Loader2 size={17} className="animate-spin" /> : children
}

export function BillingPanel({ profile }) {
  const { refreshProfile } = useAuth()
  const { data: tiers = [] } = useBillingTiers()
  const { data: usage } = useWeeklyUsage(profile.id)
  const [configured, setConfigured] = useState(null)
  const [busy, setBusy] = useState(null) // which button is waiting on Stripe
  const [error, setError] = useState('')

  const comped = isComped(profile)
  const status = shownStatus(profile)
  const subscribed = ['active', 'past_due', 'canceled'].includes(status)
  // Comped: the plan they're set to, else the one with the most bookings.
  const currentTier = tiers.find(t => t.key === profile.billing_tier) || (comped ? mostBookings(tiers) : tiers[0])
  const price = currentTier ? formatWeekly(currentTier.weekly_cents) : null
  const cap = capState(usage)
  const end = renewsAt(profile, usage)
  const periodEnd = formatBillingDate(end)
  const graceEnd = formatBillingDate(profile.billing_grace_until)

  // Prompt 677 — time-remaining at a glance: days to the next charge while
  // active, days of paid access left once cancelled.
  const days = ['active', 'canceled'].includes(status) ? daysUntil(end) : null

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

  async function go(action, extra) {
    setError('')
    // Same answer agent-billing gives a comped account (409). Answered here so
    // the live function, which isn't redeployed with the billing_exempt check
    // yet, never touches Stripe for it.
    if (comped) { setError("Your account isn't billed."); return }
    setBusy(action === 'checkout' ? `checkout:${extra.tier}` : extra?.flow || action)
    try {
      const d = await invokeBilling(action, extra)
      if (!d?.url) throw new Error('Stripe did not return a page to open')
      window.location.assign(d.url)
    } catch (e) {
      setError(e.message)
      setBusy(null)
    }
  }

  // Stripe buttons work only once billing is known to be connected. A comped
  // account's buttons are always live (they never reach Stripe).
  const locked = comped ? !!busy : configured !== true || !!busy

  const notConnected = !comped && configured === false && (
    <div className="ov-card" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-soft)' }}>
      <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--ov-mid)' }} />
      Billing isn't connected yet, so nothing is being charged and your access isn't affected. Subscribing
      switches on here once it is.
    </div>
  )
  const errorBox = error && (
    <div role="alert" className="ov-card" style={{ padding: '12px 14px', borderRadius: 12, borderColor: 'var(--danger-bd)', fontSize: 13.5, color: 'var(--danger)' }}>
      {error}
    </div>
  )

  return (
    <div className="ov-bill flex flex-col gap-[14px] sm:gap-4" style={{ maxWidth: 1120, width: '100%', margin: '0 auto' }}>
      {subscribed ? (
        <>
          <PlanHero {...planHero()} />
          {notConnected}
          {errorBox}
          {bookingsCard()}
          {tiers.length > 0 && plans()}
        </>
      ) : (
        <>
          <PickHero lapsed={status === 'lapsed'} names={tiers.map(t => t.name)} />
          {notConnected}
          {errorBox}
          {tiers.length > 0 && buyCards()}
        </>
      )}

      <BillingFacts />
    </div>
  )

  // ── plan view ──────────────────────────────────────────────────────────

  function planHero() {
    const manage = { label: 'Manage billing', icon: CreditCard, onClick: () => go('portal'), disabled: locked, busy: busy === 'portal' }
    const base = { planName: currentTier?.name, price }
    if (status === 'past_due') {
      const fix = daysUntil(profile.billing_grace_until)
      return {
        ...base,
        chip: { label: 'Payment failed', tone: 'is-warn' },
        line: graceEnd
          ? <>Your last payment failed. Update your card by <B>{graceEnd}</B> to keep access.</>
          : 'Your last payment failed. Update your card to keep access.',
        phoneLine: graceEnd ? `Update your card by ${graceEnd}` : 'Update your card',
        action: { ...manage, label: 'Update card' },
        ring: fix == null ? null : { days: fix, total: Math.ceil(GRACE_HOURS / 24), label: 'days to fix', phoneLabel: 'days to fix', todayLabel: 'last day to fix' },
      }
    }
    if (status === 'canceled') {
      return {
        ...base,
        chip: { label: 'Cancelled' },
        line: periodEnd ? <>Cancelled. Access runs through <B>{periodEnd}</B>.</> : 'Cancelled.',
        phoneLine: periodEnd ? `Access runs through ${periodEnd}` : 'Cancelled',
        action: { ...manage, label: 'Renew or manage' },
        ring: days == null ? null : { days: Math.min(days, 7), label: 'days of access left', phoneLabel: 'days left', todayLabel: 'access ends' },
      }
    }
    return {
      ...base,
      chip: { label: 'Active', tone: 'is-active' },
      line: periodEnd
        ? <>Paid through <B>{fmtDay(new Date(end).getTime() - DAY)}</B>. Next charge of {price} on <B>{periodEnd}</B>, renews automatically.</>
        : 'Paid up. Renews automatically.',
      phoneLine: periodEnd ? `Next charge ${periodEnd}` : 'Renews automatically',
      action: manage,
      ring: days == null ? null : { days: Math.min(days, 7), label: 'days to renewal', phoneLabel: 'days left', todayLabel: 'renewal day' },
    }
  }

  function bookingsCard() {
    const range = usage?.week_end
      ? `${fmtDay(new Date(usage.week_end).getTime() - 7 * DAY)} – ${fmtDay(new Date(usage.week_end).getTime() - DAY)}`
      : null
    const reset = formatReset(usage?.week_end)
    if (!cap) return null
    const next = nextTier(tiers, profile.billing_tier)
    return (
      <BookingMeter
        used={cap.used}
        cap={cap.cap}
        range={range}
        note={cap.cap == null
          ? 'Nothing limits your bookings.'
          : `Resets ${reset} at midnight. The limit is per account, not per person on the login.`}
        paused={cap.blocking ? `New bookings are paused until ${reset}.` : null}
        upgrade={cap.blocking && next ? {
          label: busy === 'change_plan' ? 'Opening Stripe…' : `Upgrade to ${next.name}`,
          onClick: () => go('portal', { flow: 'change_plan' }),
          disabled: locked,
        } : null}
      />
    )
  }

  function plans() {
    const curIdx = tiers.findIndex(t => t.key === currentTier?.key)
    const canSwitch = ['active', 'past_due'].includes(status)
    const currentNote = status === 'canceled' ? (periodEnd ? `Access ends ${periodEnd}` : 'Cancelled')
      : status === 'past_due' ? (graceEnd ? `Update your card by ${graceEnd}` : 'Payment failed')
      : periodEnd ? `Renews ${periodEnd}` : 'Renews automatically'
    return (
      <section aria-labelledby="ov-bill-plans" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 4px' }}>
          <h2 id="ov-bill-plans" style={H2}>Plans</h2>
          <span className="hidden sm:inline" style={{ fontSize: 13, color: 'var(--ov-mute)', textAlign: 'right' }}>
            {tiers.length === 2 ? 'Both cover' : 'Every plan covers'} that week's batch of cancellations
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {tiers.map((t, i) => {
            const current = i === curIdx
            const higher = i > curIdx
            let footer = null
            if (current) {
              footer = (
                <>
                  <div style={{
                    height: 44, borderRadius: 999, border: '1px dashed var(--ov-st-booked-edge)', color: 'var(--ov-st-booked)',
                    fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    You're on this plan
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ov-mute)', textAlign: 'center' }}>{currentNote}</div>
                </>
              )
            } else if (canSwitch) {
              footer = (
                <>
                  <button
                    type="button" className="ov-ghost" disabled={locked}
                    onClick={() => go('portal', { flow: 'change_plan' })}
                    style={{ height: 44, borderRadius: 999, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Spin on={busy === 'change_plan'}>{higher ? `Upgrade to ${t.name}` : `Switch to ${t.name}`}</Spin>
                  </button>
                  <div style={{ fontSize: 12.5, color: 'var(--ov-mute)', textAlign: 'center' }}>
                    {higher
                      ? "You're charged the difference for this week now."
                      : periodEnd ? `Takes effect when your paid week ends, ${periodEnd}.` : 'Takes effect when your paid week ends.'}
                  </div>
                </>
              )
            }
            return (
              <PlanCard
                key={t.key} tier={t} price={formatWeekly(t.weekly_cents)} pick={current} footer={footer}
                tag={current && (
                  <span style={{
                    height: 26, padding: '0 11px', borderRadius: 999, background: 'var(--ov-st-booked)', color: 'var(--ov-on-kind)',
                    fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                  }}>
                    <Check size={12} strokeWidth={3} /> Current plan
                  </span>
                )}
              />
            )
          })}
        </div>
      </section>
    )
  }

  // ── no plan yet ────────────────────────────────────────────────────────

  function buyCards() {
    const top = tiers.length > 1 ? mostBookings(tiers) : null
    return (
      <section aria-label="Plans" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {tiers.map(t => {
          const pick = t === top
          const key = `checkout:${t.key}`
          return (
            <PlanCard
              key={t.key} tier={t} price={formatWeekly(t.weekly_cents)} big pick={pick} className={pick ? 'ov-plan-first' : ''}
              sub={t.weekly_cap ? `${formatWeekly(Math.round(t.weekly_cents / t.weekly_cap))} a booking if you use all ${t.weekly_cap}` : null}
              tag={pick && (
                <span style={{
                  height: 26, padding: '0 11px', borderRadius: 999, background: 'var(--ov-st-booked-tint)', color: 'var(--ov-st-booked)',
                  fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
                }}>
                  <Crown size={12} strokeWidth={2.4} /> Most bookings
                </span>
              )}
              footer={
                <>
                  <button
                    type="button" className={pick ? 'ov-buy' : 'ov-ghost'} disabled={locked}
                    onClick={() => go('checkout', { tier: t.key })}
                    style={{ height: 50, borderRadius: 999, fontSize: 15, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Spin on={busy === key}>Subscribe to {t.name}<ArrowRight size={17} strokeWidth={2.2} /></Spin>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, color: 'var(--ov-mute)' }}>
                    <Lock size={13} strokeWidth={2} /> Secure checkout on Stripe
                  </div>
                </>
              }
            />
          )
        })}
      </section>
    )
  }
}

// The subscribed hero: plan + status chips, the weekly price, the next-charge
// line, the Stripe button and the ring. Phones get the compact stack.
function PlanHero({ planName, chip, price, line, phoneLine, action, ring }) {
  const chips = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {planName && <span className="ov-hero-chip"><Crown size={14} strokeWidth={2.2} />{planName} plan</span>}
      <span className={`ov-bill-chip ${chip.tone || ''}`}><i />{chip.label}</span>
    </div>
  )
  const Icon = action.icon
  const button = (style) => (
    <button type="button" className="ov-hero-btn" onClick={action.onClick} disabled={action.disabled} title={action.title} style={style}>
      <Spin on={action.busy}><Icon size={17} strokeWidth={2.1} /> {action.label}</Spin>
    </button>
  )
  const num = { fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1, color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }
  return (
    <section className="ov-hero" aria-label="Your plan">
      <div className="hidden sm:flex" style={{ alignItems: 'center', gap: 36, flexWrap: 'wrap', padding: '34px 36px' }}>
        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          {chips}
          <div style={{ marginTop: 18, display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ ...num, fontSize: 56, letterSpacing: '-0.04em' }}>{price ?? ' '}</span>
            <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--ov-hero-soft)' }}>/ week</span>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 16, color: 'var(--ov-hero-soft)' }}>{line}</p>
          <div style={{ marginTop: 22, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {button({ height: 48, padding: '0 22px', fontSize: 15 })}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ov-hero-soft)' }}>
              <Lock size={14} strokeWidth={2} /> Card, invoices and cancelling open on Stripe's secure site
            </span>
          </div>
        </div>
        {ring && <RenewalRing size={148} days={ring.days} total={ring.total} label={ring.label} todayLabel={ring.todayLabel} />}
      </div>

      <div className="flex sm:hidden" style={{ flexDirection: 'column', gap: 16, padding: '22px 20px' }}>
        {chips}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ ...num, fontSize: 44, letterSpacing: '-0.035em' }}>{price ?? ' '}</span>
              <span style={{ fontSize: 15, color: 'var(--ov-hero-soft)' }}>/ week</span>
            </div>
            <div style={{ marginTop: 8, fontSize: 14, color: 'var(--ov-hero-soft)' }}>{phoneLine}</div>
          </div>
          {ring && <RenewalRing size={104} days={ring.days} total={ring.total} label={ring.phoneLabel} todayLabel={ring.todayLabel} />}
        </div>
        {button({ width: '100%', height: 50, fontSize: 16 })}
      </div>
    </section>
  )
}

// No plan yet (or it ended): what a plan covers and the three steps to start.
function PickHero({ lapsed, names }) {
  const steps = [
    ['Pick a plan', names.length ? `${listNames(names)}, by how many clients you book a week` : 'By how many clients you book a week'],
    ['Pay on Stripe', 'Secure checkout, your card never touches this portal'],
    ['Start booking', 'Your bookings unlock the moment payment goes through'],
  ]
  return (
    <section className="ov-hero ov-bill-pad" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        {lapsed
          ? <span className="ov-bill-chip is-danger"><i />Plan ended</span>
          : <span className="ov-hero-chip"><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ov-hero-dot)' }} />No plan yet</span>}
      </div>
      <div>
        <h1 className="ov-bill-h1" style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.035em', color: '#FFFFFF' }}>
          {lapsed ? 'Your plan has ended' : 'Pick a plan to start booking'}
        </h1>
        <p style={{ margin: '12px 0 0', maxWidth: 640, fontSize: 16.5, lineHeight: 1.5, color: 'var(--ov-hero-soft)' }}>
          {lapsed
            ? 'Pick a plan to get back in. Clients you already booked are still being worked.'
            : "Your plan covers each week's batch of cancellations: you book the client, Fulfillment calls them and gets the old policy cancelled."}
        </p>
      </div>
      <ol style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: 0, padding: 0, listStyle: 'none' }}>
        {steps.map(([title, line], i) => (
          <li key={title} style={{
            flex: '1 1 200px', display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 16,
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
          }}>
            <span style={{
              width: 30, height: 30, flexShrink: 0, borderRadius: '50%', background: '#FFFFFF', color: 'var(--ov-hero-btn-text)',
              fontFamily: DISPLAY, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {i + 1}
            </span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: '#FFFFFF' }}>{title}</div>
              <div style={{ marginTop: 2, fontSize: 13, lineHeight: 1.45, color: 'var(--ov-hero-soft)' }}>{line}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
