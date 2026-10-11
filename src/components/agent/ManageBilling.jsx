import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Crown, CreditCard, CalendarX, Receipt, Loader2, TriangleAlert, Info, Mail, X, CircleCheck, RotateCcw, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { DISPLAY } from '../../lib/exportStyles'
import { formatWeekly, formatBillingDate, invokeBilling } from '../../lib/billing'
import { SettingsCard, SettingsChip } from './AgentUI'

// ── Manage billing (Prompt 734) ─────────────────────────────────────────────
// The second view of /agent/billing (?manage=1), like Book a call's New
// booking / Change a booking: a back arrow returns to the plan page. Plan
// (switch up now / down at the end of the paid week), payment method (Update
// card in Stripe's own field), cancel / renew and the last 12 invoices, all
// without leaving the portal. Payment method shows whatever is really on file
// (card, wallet, Link, bank); paid invoices are emailed by Stripe, so the list
// has no receipt link and nothing here opens a Stripe page (P736). Every number comes from agent-billing's
// `overview`, which reads Stripe for the signed-in agent only.
// ?subscribe=<tier> is the third view: Stripe Embedded Checkout in the page.

const StripeForms = () => import('./StripeForms')
const CardForm = lazy(() => StripeForms().then(m => ({ default: m.CardForm })))
const CheckoutEmbed = lazy(() => StripeForms().then(m => ({ default: m.CheckoutEmbed })))

const LIVE = ['active', 'trialing', 'past_due']
const H1 = { margin: 0, fontFamily: DISPLAY, fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1, color: 'var(--ov-hi)' }
const BRANDS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay' }
const brandName = b => BRANDS[b] || (b ? b[0].toUpperCase() + b.slice(1) : 'Card')
// One line for the method on file; `label` comes from agent-billing (P736), the
// brand + last 4 fallback covers a page that is ahead of the function.
const methodLabel = c => c?.label || (c?.last4 ? `${brandName(c.brand)} ending ${c.last4}` : 'Your new card')
const capText = cap => (cap == null ? 'no weekly limit' : `${cap} bookings a week`)
const money = cents => formatWeekly(cents)

export function BackBar({ onBack, title, sub }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button type="button" className="ov-mb-back" onClick={onBack}>
        <ArrowLeft size={17} strokeWidth={2.1} aria-hidden="true" /> Billing
      </button>
      <div>
        <h1 style={H1}>{title}</h1>
        {sub && <p style={{ margin: '6px 0 0', fontSize: 14.5, color: 'var(--ov-mute)' }}>{sub}</p>}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading billing" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[120, 96, 84, 180].map((h, i) => (
        <div key={i} className="ov-card ov-mb-skel" style={{ height: h }} />
      ))}
    </div>
  )
}

function Notice({ tone = 'ok', children, onClose }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'warn' ? TriangleAlert : Info
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`ov-mb-notice is-${tone}`}>
      <Icon size={18} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {onClose && (
        <button type="button" className="ov-invite-x" onClick={onClose} aria-label="Dismiss"><X size={16} strokeWidth={2} /></button>
      )}
    </div>
  )
}

// A small centred confirm window, the Invite an agent pop-up's frame.
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', busy, error, onConfirm, onClose, disabled }) {
  const first = useRef(null)
  useEffect(() => {
    first.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])
  return createPortal(
    <>
      <div className="ov-scrim" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div className="ov-invite-wrap" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
        <div className="ov-card ov-invite" role="dialog" aria-modal="true" aria-labelledby="ov-mb-dialog-title">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <h2 id="ov-mb-dialog-title" className="ov-invite-title">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="ov-invite-x" disabled={busy}><X size={18} strokeWidth={2} /></button>
          </div>
          <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--ov-soft)' }}>{children}</div>
          {error && <p className="ov-invite-error" role="alert">{error}</p>}
          <div className="ov-invite-actions">
            <button type="button" ref={first} className="ov-ghost ov-invite-btn" onClick={onClose} disabled={busy}>{cancelLabel}</button>
            <button type="button" className="ov-solid ov-invite-btn" onClick={onConfirm} disabled={busy || disabled}>
              {busy ? <><Loader2 size={16} className="animate-spin" /> Working…</> : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

// Upgrade / switch confirm, with Stripe's own preview of today's charge.
// Used from Manage billing and from the plan cards on the Billing view.
export function PlanSwitchDialog({ tier, onClose, onDone }) {
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    invokeBilling('preview_change', { tier: tier.key })
      .then(d => { if (live) setPreview(d) })
      .catch(e => { if (live) setError(e.message) })
    return () => { live = false }
  }, [tier.key])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      const d = await invokeBilling('change_plan', { tier: tier.key, proration_date: preview?.proration_date })
      onDone(d.direction === 'up'
        ? `You're on ${tier.name} now. Your limit is ${capText(tier.weekly_cap)}.`
        : `You'll move to ${tier.name} on ${formatBillingDate(d.at)}.`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const up = preview?.direction === 'up'
  let body = <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--ov-mute)' }}><Loader2 size={16} className="animate-spin" /> Working out the cost…</span>
  if (preview && up) {
    body = <>You'll be charged <b className="ov-mb-money">{money(preview.amount_cents)}</b> today for the rest of this week, and your limit goes to {capText(tier.weekly_cap)} right away. After that it's <b className="ov-mb-money">{money(tier.weekly_cents)}</b> a week.</>
  } else if (preview) {
    body = <>You'll move to {tier.name} on <b>{formatBillingDate(preview.at)}</b>, when your paid week ends. You keep your current limit until then. After that it's <b className="ov-mb-money">{money(tier.weekly_cents)}</b> a week.</>
  } else if (error) {
    body = null
  }

  return (
    <ConfirmDialog
      title={up || !preview ? `Upgrade to ${tier.name}?` : `Switch to ${tier.name}?`}
      confirmLabel={!preview ? 'Confirm' : up ? `Pay ${money(preview.amount_cents)} and upgrade` : `Switch to ${tier.name}`}
      cancelLabel="Not now"
      disabled={!preview}
      busy={busy} error={error} onConfirm={confirm} onClose={onClose}
    >
      {body}
    </ConfirmDialog>
  )
}

// ── the Manage billing view ────────────────────────────────────────────────

// Prompt 741 — a comped account (billing_exempt) opens the real page, read-only:
// built from the profile's tier, never calls agent-billing (it answers 409),
// and every button that would change or charge something is disabled.
export function ManageBilling({ comped, tier, tiers, onBack, onNoPlan, refreshProfile }) {
  if (comped) return <CompedManage tier={tier} tiers={tiers} onBack={onBack} />
  return <PaidManage tiers={tiers} onBack={onBack} onNoPlan={onNoPlan} refreshProfile={refreshProfile} />
}

const COMPED_TIP = "Comped accounts aren't billed"

function CompedManage({ tier, tiers, onBack }) {
  const others = tiers.filter(t => t.key !== tier?.key)
  const curCents = tier?.weekly_cents ?? 0
  return (
    <>
      <BackBar onBack={onBack} title="Manage billing" sub="Your plan, card and invoices. Everything here is handled by Stripe, without leaving Ohvara." />
      <Notice tone="info">You're comped, so this page is read-only.</Notice>

      <SettingsCard icon={Crown} title="Plan" label="Plan" right={<SettingsChip tone="on">Active</SettingsChip>} gap={16}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)' }}>{tier?.name || 'Your plan'}</span>
          {tier && <span className="ov-mb-money" style={{ fontSize: 17, color: 'var(--ov-soft)' }}>{money(tier.weekly_cents)} / week</span>}
          {tier && <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>{capText(tier.weekly_cap)}</span>}
        </div>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ov-soft)' }}>Comped by Ohvara. You're not charged.</p>
        {others.length > 0 && (
          <div className="ov-mb-row">
            {others.map(t => (
              <button key={t.key} type="button" className="ov-ghost ov-mb-btn" disabled title={COMPED_TIP}>
                {t.weekly_cents > curCents ? `Upgrade to ${t.name}` : `Switch to ${t.name}`}
                <span className="ov-mb-money" style={{ color: 'var(--ov-mute)', fontWeight: 500 }}>{money(t.weekly_cents)}/wk</span>
              </button>
            ))}
          </div>
        )}
      </SettingsCard>

      <SettingsCard icon={CreditCard} title="Payment method" label="Payment method" gap={16}>
        <div className="ov-mb-row">
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ov-hi)' }}>None needed</span>
            <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ov-mute)' }}>Nothing is charged on this account.</div>
          </div>
          <button type="button" className="ov-ghost ov-mb-btn" disabled title={COMPED_TIP}>
            <CreditCard size={16} strokeWidth={2.1} aria-hidden="true" /> Change payment method
          </button>
        </div>
      </SettingsCard>

      <SettingsCard icon={CalendarX} title="Subscription" label="Subscription" gap={14}>
        <div className="ov-mb-row">
          <p style={{ flex: '1 1 260px', margin: 0, fontSize: 14.5, color: 'var(--ov-soft)' }}>This account is comped, so there's nothing to cancel.</p>
          <button type="button" className="ov-ghost ov-mb-btn is-danger" disabled title={COMPED_TIP}>Cancel subscription</button>
        </div>
      </SettingsCard>

      <SettingsCard icon={Receipt} title="Invoices" label="Invoices" gap={14}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ov-mute)' }}>No charges. Comped accounts aren't billed.</p>
      </SettingsCard>
    </>
  )
}

function PaidManage({ tiers, onBack, onNoPlan, refreshProfile }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null) // { tone, text }
  const [cardOpen, setCardOpen] = useState(false)
  const [dialog, setDialog] = useState(null) // 'cancel' | { tier }
  const [busy, setBusy] = useState(null)
  const [dialogError, setDialogError] = useState('')
  const updateBtn = useRef(null)
  const { profile } = useAuth()

  const load = useCallback(() => invokeBilling('overview')
    .then(d => {
      setError('')
      setData(d)
      if (!d.subscription || !LIVE.includes(d.subscription.status)) onNoPlan()
    })
    .catch(e => setError(e.message)), [onNoPlan])

  useEffect(() => { load() }, [load])

  // After any change: fresh numbers here, and the profile row for the gate
  // and the Billing view's hero.
  async function changed(n) {
    if (n) setNotice(n)
    await load()
    refreshProfile()
  }

  const sub = data?.subscription
  const pastDue = sub?.status === 'past_due'
  useEffect(() => {
    if (pastDue) updateBtn.current?.focus({ preventScroll: true })
  }, [pastDue])

  async function runSimple(action, message) {
    setBusy(action)
    setDialogError('')
    try {
      await invokeBilling(action)
      setDialog(null)
      await changed({ tone: 'ok', text: message })
    } catch (e) {
      if (action === 'cancel') setDialogError(e.message)
      else setNotice({ tone: 'error', text: e.message })
    } finally {
      setBusy(null)
    }
  }

  const head = <BackBar onBack={onBack} title="Manage billing" sub="Your plan, card and invoices. Everything here is handled by Stripe, without leaving Ohvara." />

  if (error && !data) {
    return (
      <>
        {head}
        <div className="ov-card ov-set-card" style={{ gap: 14 }}>
          <Notice tone="error">{error}</Notice>
          <div><button type="button" className="ov-ghost ov-mb-btn" onClick={load}><RotateCcw size={15} strokeWidth={2.1} /> Try again</button></div>
        </div>
      </>
    )
  }
  if (!data || !sub) return <>{head}<Skeleton /></>

  const plan = sub.plan || {}
  const end = formatBillingDate(sub.current_period_end)
  const canceling = sub.cancel_at_period_end
  const others = tiers.filter(t => t.key !== plan.tier)
  const curCents = plan.weekly_cents ?? 0
  const chip = pastDue ? <SettingsChip tone="warn">Payment failed</SettingsChip>
    : canceling ? <SettingsChip tone="off">Cancels {end}</SettingsChip>
    : <SettingsChip tone="on">Active</SettingsChip>
  const pk = !!data.publishable_key

  return (
    <>
      {head}
      {notice && <Notice tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Notice>}

      {/* 1. Plan */}
      <SettingsCard icon={Crown} title="Plan" label="Plan" right={chip} gap={16}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)' }}>{plan.name || 'Your plan'}</span>
          <span className="ov-mb-money" style={{ fontSize: 17, color: 'var(--ov-soft)' }}>{money(plan.weekly_cents)} / week</span>
          <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>{capText(plan.weekly_cap)}</span>
        </div>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ov-soft)' }}>
          {pastDue ? 'Your last payment didn\'t go through. Update your card below and we\'ll try again.'
            : canceling ? <>Cancels on <b>{end}</b>. You keep access until then and won't be charged again.</>
            : <>Next charge of <b className="ov-mb-money">{money(sub.scheduled?.weekly_cents ?? plan.weekly_cents)}</b> on <b>{end}</b>.</>}
        </p>
        {sub.scheduled && !canceling && (
          <div className="ov-note ov-mb-row" style={{ padding: '12px 14px', borderRadius: 12 }}>
            <span style={{ flex: '1 1 220px', fontSize: 14, color: 'var(--ov-hi)' }}>
              Moves to <b>{sub.scheduled.name}</b> on <b>{formatBillingDate(sub.scheduled.at)}</b>. You keep {capText(plan.weekly_cap)} until then.
            </span>
            <button type="button" className="ov-ghost ov-mb-btn is-small" disabled={!!busy}
              onClick={() => runSimple('cancel_change', `You'll stay on ${plan.name}.`)}>
              {busy === 'cancel_change' ? <Loader2 size={15} className="animate-spin" /> : 'Undo'}
            </button>
          </div>
        )}
        {others.length > 0 && (
          canceling
            ? <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ov-mute)' }}>Renew your plan to switch to another one.</p>
            : (
              <div className="ov-mb-row">
                {others.filter(t => t.key !== sub.scheduled?.tier).map(t => {
                  const up = t.weekly_cents > curCents
                  return (
                    <button key={t.key} type="button" className="ov-ghost ov-mb-btn" disabled={!!busy} onClick={() => setDialog({ tier: t })}>
                      {up ? `Upgrade to ${t.name}` : `Switch to ${t.name}`}
                      <span className="ov-mb-money" style={{ color: 'var(--ov-mute)', fontWeight: 500 }}>{money(t.weekly_cents)}/wk</span>
                    </button>
                  )
                })}
                <span style={{ flexBasis: '100%', fontSize: 12.5, color: 'var(--ov-mute)' }}>
                  Upgrading charges the difference for this week now. Switching down waits until your paid week ends.
                </span>
              </div>
            )
        )}
      </SettingsCard>

      {/* 2. Payment method */}
      <SettingsCard icon={CreditCard} title="Payment method" label="Payment method" gap={16}>
        {pastDue && (
          <div className="ov-note is-warn ov-mb-row" style={{ padding: '12px 14px', borderRadius: 12, color: 'var(--ov-warn)', fontSize: 14 }}>
            <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" style={{ flexShrink: 0, alignSelf: 'flex-start', marginTop: 3 }} />
            <span style={{ flex: '1 1 0', minWidth: 0 }}>Your last payment didn't go through. Update your payment method and we'll try again.</span>
          </div>
        )}
        <div className="ov-mb-row">
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            {data.card ? (
              <>
                <div className="ov-mb-method">
                  <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ov-hi)', overflowWrap: 'anywhere' }}>{methodLabel(data.card)}</span>
                  {!pastDue && <span className="ov-mb-onfile"><Check size={12} strokeWidth={3} aria-hidden="true" /> On file</span>}
                </div>
                <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ov-mute)' }}>
                  {pastDue ? "We'll try this again once you change it." : 'Charged here every week.'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 14.5, color: 'var(--ov-mute)' }}>No card on file.</div>
            )}
          </div>
          {!cardOpen && (
            <button ref={updateBtn} type="button" className={`${pastDue ? 'ov-solid' : 'ov-ghost'} ov-mb-btn`} disabled={!pk}
              onClick={() => { setCardOpen(true); setNotice(null) }}>
              <CreditCard size={16} strokeWidth={2.1} aria-hidden="true" /> {data.card ? 'Change payment method' : 'Add card'}
            </button>
          )}
        </div>
        {!pk && <Notice tone="info">Billing isn't fully set up yet, so cards can't be changed here right now.</Notice>}
        {cardOpen && (
          <div className="ov-mb-cardbox">
            {data.card && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ov-hi)' }}>
                  {data.card.kind === 'link' ? 'Pay with a card instead' : 'Use a different card'}
                </div>
                <div style={{ marginTop: 3, fontSize: 13.5, color: 'var(--ov-mute)', overflowWrap: 'anywhere' }}>
                  This replaces {data.card.kind === 'link' ? 'Link' : methodLabel(data.card)}.
                </div>
              </div>
            )}
            <Suspense fallback={<div style={{ fontSize: 14, color: 'var(--ov-mute)' }}>Loading…</div>}>
              <CardForm
                onCancel={() => setCardOpen(false)}
                onSaved={d => {
                  setCardOpen(false)
                  const name = d.card ? methodLabel(d.card) : 'Your new card'
                  if (d.retry && !d.retry.ok) changed({ tone: 'warn', text: `${name} is saved, but the payment didn't go through: ${d.retry.message}` })
                  else changed({ tone: 'ok', text: d.retry?.ok ? `${name} is now your card, and your payment went through.` : `${name} is now your card.` })
                }}
              />
            </Suspense>
          </div>
        )}
      </SettingsCard>

      {/* 3. Subscription */}
      <SettingsCard icon={CalendarX} title="Subscription" label="Subscription" gap={14}>
        <div className="ov-mb-row">
          <p style={{ flex: '1 1 260px', margin: 0, fontSize: 14.5, color: 'var(--ov-soft)' }}>
            {canceling
              ? <>Your plan ends on <b>{end}</b>. Renew to keep booking after that.</>
              : 'Cancel anytime. You keep access through the end of the week you\'ve paid for.'}
          </p>
          {canceling ? (
            <button type="button" className="ov-solid ov-mb-btn" disabled={!!busy}
              onClick={() => runSimple('resume', `Renewed. Your next charge is on ${end}.`)}>
              {busy === 'resume' ? <><Loader2 size={16} className="animate-spin" /> Renewing…</> : 'Renew'}
            </button>
          ) : (
            <button type="button" className="ov-ghost ov-mb-btn is-danger" disabled={!!busy} onClick={() => { setDialogError(''); setDialog('cancel') }}>
              Cancel subscription
            </button>
          )}
        </div>
      </SettingsCard>

      {/* 4. Invoices */}
      <SettingsCard icon={Receipt} title="Invoices" label="Invoices" sub={data.invoices.length ? 'Your last 12 charges, newest first.' : null} gap={14}>
        {data.invoices.length ? <Invoices rows={data.invoices} email={profile?.email} /> : <p style={{ margin: 0, fontSize: 14, color: 'var(--ov-mute)' }}>No invoices yet.</p>}
      </SettingsCard>

      {dialog === 'cancel' && (
        <ConfirmDialog
          title="Cancel your subscription?"
          confirmLabel="Cancel subscription" cancelLabel="Keep my plan"
          busy={busy === 'cancel'} error={dialogError}
          onConfirm={() => runSimple('cancel', `Cancelled. You keep access until ${end}.`)}
          onClose={() => setDialog(null)}
        >
          You'll keep access until <b>{end}</b>. You won't be charged again.
        </ConfirmDialog>
      )}
      {dialog?.tier && (
        <PlanSwitchDialog
          tier={dialog.tier}
          onClose={() => setDialog(null)}
          onDone={text => { setDialog(null); changed({ tone: 'ok', text }) }}
        />
      )}
    </>
  )
}

const STATUS_CHIP = { paid: ['on', 'Paid'], open: ['off', 'Open'], failed: ['warn', 'Failed'], void: ['off', 'Void'] }

function Invoices({ rows, email }) {
  // Stripe emails the receipt when a payment goes through; no link to a Stripe page.
  const receipt = r => r.status === 'paid' && (
    <span className="ov-mb-emailed" title={email ? `Sent to ${email}` : undefined}>
      <Mail size={14} strokeWidth={2} aria-hidden="true" /> Receipt emailed
    </span>
  )
  return (
    <>
      <table className="ov-mb-table hidden sm:table">
        <thead>
          <tr><th>Date</th><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th><span className="sr-only">Receipt</span></th></tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const [tone, label] = STATUS_CHIP[r.status] || STATUS_CHIP.open
            return (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatBillingDate(r.created)}</td>
                <td>{r.description}</td>
                <td className="ov-mb-money" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{money(r.amount_cents)}</td>
                <td><SettingsChip tone={tone}>{label}</SettingsChip></td>
                <td style={{ textAlign: 'right' }}>{receipt(r)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="ov-mb-invcards sm:hidden">
        {rows.map(r => {
          const [tone, label] = STATUS_CHIP[r.status] || STATUS_CHIP.open
          return (
            <li key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ov-hi)' }}>{formatBillingDate(r.created)}</span>
                <span className="ov-mb-money" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>{money(r.amount_cents)}</span>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>{r.description}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <SettingsChip tone={tone}>{label}</SettingsChip>
                {receipt(r)}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ── the Subscribe view (?subscribe=<tier>) ─────────────────────────────────

export function SubscribeView({ tier, onBack, onManage }) {
  const [error, setError] = useState(null)
  if (!tier) {
    return (
      <>
        <BackBar onBack={onBack} title="Subscribe" />
        <Notice tone="error">That plan isn't available. Go back and pick one.</Notice>
      </>
    )
  }
  return (
    <>
      <BackBar
        onBack={onBack}
        title={`Subscribe to ${tier.name}`}
        sub={<><span className="ov-mb-money">{money(tier.weekly_cents)}</span> a week · {capText(tier.weekly_cap)} · cancel anytime</>}
      />
      {error ? (
        <div className="ov-card ov-set-card" style={{ gap: 14 }}>
          <Notice tone="error">{error.message}</Notice>
          {error.code === 'already_subscribed' && (
            <div><button type="button" className="ov-solid ov-mb-btn" onClick={onManage}>Go to Manage billing</button></div>
          )}
        </div>
      ) : (
        <div className="ov-card ov-mb-checkout">
          <Suspense fallback={<div style={{ fontSize: 14, color: 'var(--ov-mute)' }}>Loading…</div>}>
            <CheckoutEmbed tier={tier.key} onError={setError} />
          </Suspense>
        </div>
      )}
    </>
  )
}
