import { CalendarDays, Landmark, Settings as Gear, TriangleAlert, CreditCard } from 'lucide-react'
import { fmtCents, fmtPeriod } from '../../lib/payPeriod'
import { payDayOf, destination, requirementText, payoutRow, paidThisMonth } from '../../lib/myPay'

// "My pay". P890: VA pay is hourly, from clock in and out, paid every Monday.
// No per-cancel amounts, statuses or AI checks. The hero says how pay works
// (with the rep's hourly rate when it is known), when and where it lands;
// Get paid to and Payouts sit below. Presentational: pages/fulfillment/MyPay.jsx
// feeds it.

const longDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const whole = cents => (cents % 100 ? fmtCents(cents) : fmtCents(cents).replace(/\.00$/, ''))

function Hero({ period, hourlyCents, account }) {
  const dest = destination(account)
  return (
    <section className="ov-hero mp-hero" aria-label="How you're paid">
      <div className="mp-hero-main">
        <div className="mp-hero-top">
          <span className="ov-hero-chip"><span className="mp-dot" />This week · {fmtPeriod(period)}</span>
        </div>
        <div className="mp-earn-label">You're paid by the hour on your scheduled shifts, minus days off. Pay goes out every Monday.</div>
        {hourlyCents != null && (
          <div className="mp-earn">
            <span className="mp-amount" data-testid="mp-amount">{whole(hourlyCents)}</span>
            <span className="mp-calc">an hour</span>
          </div>
        )}
        <div className="mp-strip">
          <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />
          <span>Next pay day <b>{longDay(payDayOf(period))}</b> to {dest || 'your bank (add it below)'}</span>
        </div>
      </div>
    </section>
  )
}

function GetPaidTo({ status, account, loading, onConnect, onSettings }) {
  if (loading) {
    return <section className="ov-card mp-card mp-method" aria-label="Get paid to" aria-busy="true"><div className="mp-method-k">Get paid to</div><div className="mp-skel" /></section>
  }
  if (status === 'ready') {
    const Icon = account.external_kind === 'card' ? CreditCard : Landmark
    return (
      <section className="ov-card mp-card mp-method is-ready" aria-label="Get paid to">
        <div className="mp-method-k">Get paid to</div>
        <div className="mp-bank">
          <span className="mp-bank-ico"><Icon size={22} strokeWidth={1.9} aria-hidden="true" /></span>
          <span className="mp-bank-name"><b>{account.bank_name}</b><span className="mp-mono">•••• {account.last4}</span></span>
          <span className="mp-pill is-up"><i />Ready</span>
        </div>
        <div className="mp-method-foot">
          <span>Paid every Monday by Stripe</span>
          <button type="button" className="mp-textbtn" onClick={onSettings}><Gear size={14} strokeWidth={2} aria-hidden="true" /> Payout settings</button>
        </div>
      </section>
    )
  }
  if (status === 'action_needed') {
    return (
      <section className="ov-card mp-card mp-method is-warn" aria-label="Get paid to">
        <div className="mp-method-row"><span className="mp-method-k">Get paid to</span><span className="mp-pill is-warn"><TriangleAlert size={12} strokeWidth={2.4} aria-hidden="true" />Action needed</span></div>
        {account?.last4 && <div className="mp-mono mp-method-dest">{destination(account)}</div>}
        <p className="mp-method-p">{requirementText(account?.requirements_due, account?.disabled_reason)}</p>
        <button type="button" className="ov-hero-btn mp-bigbtn" onClick={onSettings}>Fix it in Payout settings</button>
      </section>
    )
  }
  return (
    <section className="ov-card mp-card mp-method is-warn" aria-label="Get paid to">
      <div className="mp-method-k">Get paid to</div>
      <p className="mp-method-p">Add where your pay should go. It takes about 3 minutes, and your bank details stay with Stripe, never on Ohvara.</p>
      <button type="button" className="ov-hero-btn mp-bigbtn" onClick={onConnect}>
        <Landmark size={18} strokeWidth={2} aria-hidden="true" /> {status === 'incomplete' ? 'Finish connecting your bank' : 'Connect a bank account'}
      </button>
      <p className="mp-wait">Your pay waits here until a bank is added.</p>
    </section>
  )
}

function Payouts({ payouts, now, account }) {
  const month = paidThisMonth(payouts, now)
  return (
    <section className="ov-card mp-card mp-payouts" aria-label="Payouts">
      <div className="mp-payouts-head"><h2>Payouts</h2><span><span className="mp-mono">{fmtCents(month)}</span> paid this month</span></div>
      {payouts.length === 0 ? <p className="mp-empty">Your first payout shows here after your first pay day.</p> : (
        <ul className="mp-list">
          {payouts.slice(0, 6).map(p => {
            const r = payoutRow(p, now, account)
            return (
              <li key={r.id}>
                <span className="mp-tile"><small>{r.mon}</small><b>{r.day}</b></span>
                <span className="mp-li-main"><b>{r.week}</b><span>{r.sub}</span></span>
                <span className="mp-li-amt"><b className="mp-mono">{fmtCents(r.amount)}</b><span className={`mp-st is-${r.status.tone}`}>{r.status.label}</span></span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function MyPayView({
  period, now, hourlyCents = null,
  payouts = [], account = null, status = 'none', accountLoading = false, onConnect, onSettings,
}) {
  return (
    <div className="mp-page">
      <Hero period={period} hourlyCents={hourlyCents} account={status === 'ready' ? account : null} />
      <div className="mp-grid">
        <div className="mp-side">
          <GetPaidTo status={status} account={account} loading={accountLoading} onConnect={onConnect} onSettings={onSettings} />
        </div>
        <div className="mp-side">
          <Payouts payouts={payouts} now={now} account={account} />
        </div>
      </div>
    </div>
  )
}
