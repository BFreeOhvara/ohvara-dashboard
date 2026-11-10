import { Landmark, CreditCard, TriangleAlert, Plus } from 'lucide-react'
import { fmtCents, fmtPeriod } from '../../../lib/payPeriod'
import { destination, paidThisMonth, payDayOf, payoutRow } from '../../../lib/myPay'

// My pay on a rep's phone. P890: pay is hourly, from clock in and out, paid
// every Monday; no per-cancel amounts or statuses. Shows the pay line (and the
// rep's hourly rate when known), when and where it's paid (or "Add a bank to
// get paid" with Connect a bank), then Payouts. Fed by pages/fulfillment/MyPay.jsx.

const whole = cents => (cents % 100 ? fmtCents(cents) : fmtCents(cents).replace(/\.00$/, ''))
const payDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const STATUS_WORD = { 'On hold': 'Held' }

function BankLine({ status, account, loading, period, onConnect, onSettings }) {
  if (loading) return <div className="ph-pay-bank"><span className="ph-pay-bank-ic" /><span className="ph-mute">Checking your bank…</span></div>
  if (status === 'ready') {
    const Icon = account?.external_kind === 'card' ? CreditCard : Landmark
    return (
      <div className="ph-pay-bank">
        <span className="ph-pay-bank-ic is-ok"><Icon size={19} strokeWidth={2} aria-hidden="true" /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b>Paid {payDay(payDayOf(period))}</b>
          <span>Automatically · to {destination(account)}</span>
        </span>
      </div>
    )
  }
  const fix = status === 'action_needed'
  return (
    <>
      <div className="ph-pay-bank">
        <span className="ph-pay-bank-ic is-warn"><TriangleAlert size={19} strokeWidth={2} aria-hidden="true" /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b>{fix ? 'Stripe needs something from you' : 'Add a bank to get paid'}</b>
          <span>Your pay waits here until you do</span>
        </span>
      </div>
      <button type="button" className="ph-pay-connect" onClick={fix ? onSettings : onConnect}>
        {!fix && <Plus size={17} strokeWidth={2.2} aria-hidden="true" />}
        {fix ? 'Fix it in Payout settings' : status === 'incomplete' ? 'Finish connecting your bank' : 'Connect a bank · 3 min'}
      </button>
    </>
  )
}

export function PhoneMyPay({ period, now, hourlyCents = null, payouts = [], account = null, status = 'none', accountLoading = false, onConnect, onSettings }) {
  const month = paidThisMonth(payouts, now)

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">My pay</h1>
        <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>This week · {fmtPeriod(period)}</span>
      </div>

      <section className="ov-hero ph-pay-hero" aria-label="How you're paid">
        <div className="ph-pay-k">You're paid by the hour on your scheduled shifts, minus days off. Pay goes out every Monday.</div>
        {hourlyCents != null && <div className="ph-pay-calc" data-testid="ph-pay-amount"><span className="ph-mono">{whole(hourlyCents)}</span> an hour</div>}
        <div className="ph-pay-rule" />
        <BankLine status={status} account={account} loading={accountLoading} period={period} onConnect={onConnect} onSettings={onSettings} />
      </section>

      <section aria-labelledby="ph-payouts">
        <div className="ph-sechead">
          <h2 id="ph-payouts" className="ph-h2">Payouts</h2>
          <span style={{ flex: 1 }} />
          <span className="ph-mute"><span className="ph-mono">{whole(month)}</span> this month</span>
        </div>
        <div className="ov-card ph-card">
          {payouts.length === 0 ? <div className="ph-empty">Your first payout shows here after your first pay day.</div> : payouts.slice(0, 6).map(p => {
            const r = payoutRow(p, now, account)
            return (
              <div key={r.id} className="ph-row" style={{ cursor: 'default', minHeight: 64 }}>
                <span className="ph-daytile" style={{ width: 42, height: 44 }}><small>{r.mon}</small><b>{r.day}</b></span>
                <span className="ph-row-main">
                  <span className="ph-row-title">{r.week}</span>
                  <span className="ph-row-sub">{r.sub}</span>
                </span>
                <span className="ph-row-end">
                  <b className="ph-mono" style={{ color: 'var(--ov-hi)' }}>{fmtCents(r.amount)}</b>
                  <span className={`ph-pay-st is-${r.status.tone}`}>{STATUS_WORD[r.status.label] || r.status.label}</span>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
