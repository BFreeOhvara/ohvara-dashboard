import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Landmark, Pause, RefreshCw, X } from 'lucide-react'
import { Switch } from '../ui/Switch'
import { money, dayLong, monDay } from '../../lib/adminPayouts'

// Prompt 765 — Admin Payouts, simple version. P890: VAs are paid by the hour,
// from clock in and out, so this is the next pay day and its status (it pays by
// itself, no Approve or Pay button), past pay runs, and the payout settings
// (bank, Stripe balance, the pause switch). Pure view: the page
// (pages/admin/Payouts.jsx) wires the data, the harness wires fakes.

const LazyEmbed = lazy(() => import('../fulfillment/ConnectEmbeds'))

function Next({ model }) {
  const { mode } = model
  const badge = {
    auto: { cls: 'is-auto', label: 'Pays automatically', note: 'Monday 8 AM · nothing for you to do', icon: <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" /> },
    paused: { cls: 'is-off', label: 'Paused', note: 'Automatic payouts are paused. Nobody is paid until you turn them back on.', icon: <Pause size={16} strokeWidth={2.2} aria-hidden="true" /> },
    off: { cls: 'is-off', label: 'Not live yet', note: 'Payouts are off, so the Monday run moves no money.', icon: <Pause size={16} strokeWidth={2.2} aria-hidden="true" /> },
  }[mode]
  return (
    <div className="ap2-next-head">
      <div className="ap2-next-main">
        <span className="ap2-when"><i />Next pay day · {monDay(model.nextPayDate)}</span>
        <div className="ap2-amt"><span>VAs are paid by the hour from clock in and out.</span></div>
      </div>
      <div className="ap2-badge-wrap">
        <span className={`ap2-badge ${badge.cls}`}>{badge.icon}{badge.label}</span>
        <div className="ap2-badge-note">{badge.note}</div>
      </div>
    </div>
  )
}

export function BankModal({ account, hasAccount, Embed, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portaled to <body>: a fixed modal under DashboardLayout's animated wrapper
  // would be positioned against the page, not the screen (see Gotchas).
  return createPortal(
    <div className="ap2-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ov-card ap2-modal" role="dialog" aria-modal="true" aria-label="Your bank">
        <div className="ap2-modal-head">
          <div>
            <h2>{account ? 'Change your bank' : 'Connect your bank'}</h2>
            <p>Stripe’s own secure form. Bank numbers go straight to Stripe, never through Ohvara.</p>
          </div>
          <button type="button" className="ap2-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <Suspense fallback={<div className="ap2-wait">Loading…</div>}>
          <Embed kind={hasAccount ? 'bank' : 'onboarding'} onDone={onClose} />
        </Suspense>
      </div>
    </div>,
    document.body,
  )
}

export function PayoutsView({
  model, loading, error,
  balance, balanceLoading, bank, hasBankAccount, autoOn, savingAuto, onToggleAuto,
  onBankClosed, Embed = LazyEmbed,
}) {
  const [bankOpen, setBankOpen] = useState(false)
  const { past, mode } = model
  const closeBank = () => { setBankOpen(false); onBankClosed?.() }

  return (
    <div className="ap2-page">
      <div className="ap2-col">
        <section className="ap2-next" aria-label="Next pay day">
          <Next model={model} />
          <div className="ap2-reps">
            {loading && <div className="ap2-empty">Loading…</div>}
            {!loading && error && <div className="ap2-empty is-err">Couldn’t load pay: {error}</div>}
          </div>
        </section>

        <section className="ov-card ap2-runs" aria-label="Past pay runs">
          <div className="ap2-sec-head">
            <h2>Past pay runs</h2>
            {model.paidSince && <span>{money(model.paidTotal)} paid since {dayLong(model.paidSince)}</span>}
          </div>
          <div className="ap2-runs-list">
            {!past.length && <div className="ap2-empty">No pay runs yet.</div>}
            {past.map(r => (
              <div key={r.id} className="ap2-run">
                <span className="ap2-run-day">{r.day}</span>
                <span className="ap2-run-sub">{r.sub}</span>
                <span className="ap2-run-amt">{money(r.cents)}</span>
                <span className="ap2-run-paid">Paid</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="ap2-col">
        <section className="ov-card ap2-settings" aria-label="Payout settings">
          <div className="ap2-sec-head"><h2>Payout settings</h2><span>Stripe</span></div>
          <div className="ap2-bank">
            <span className="ap2-bank-ico"><Landmark size={20} strokeWidth={1.9} aria-hidden="true" /></span>
            <span className="ap2-bank-who">
              <span>Your bank</span>
              <b>{bank || 'No bank yet'}</b>
            </span>
            <button type="button" className="ap2-link" onClick={() => setBankOpen(true)}>{bank ? 'Change' : 'Connect'}</button>
          </div>
          <div className="ap2-set">
            <div className="ap2-set-row">
              <span><b>Stripe balance</b>
                <span>{balanceLoading ? 'Checking…' : balance == null ? 'Balance unavailable' : 'Available to pay out'}</span></span>
              <span className="ap2-set-v">{balance == null ? '—' : money(balance)}</span>
            </div>
            <div className="ap2-set-row">
              <span><b>Automatic payouts</b>
                <span>{mode === 'off' ? 'Not live yet · turn on in Settings' : autoOn ? 'Every Monday · tap to pause' : 'Paused · tap to resume'}</span></span>
              <span className="ap2-set-sw">
                <b className={autoOn ? 'is-on' : ''}>{autoOn ? 'On' : 'Off'}</b>
                <Switch checked={autoOn} disabled={savingAuto} onChange={onToggleAuto} />
              </span>
            </div>
          </div>
        </section>
      </div>
      {bankOpen && <BankModal account={bank} hasAccount={hasBankAccount} Embed={Embed} onClose={closeBank} />}
    </div>
  )
}
