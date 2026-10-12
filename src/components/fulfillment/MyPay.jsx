import { CalendarDays, Landmark, Settings as Gear, TriangleAlert, CreditCard } from 'lucide-react'
import { fmtCents, fmtHours, fmtPeriod } from '../../lib/payPeriod'
import {
  payWeek, dayHoursLabel, shortTime, rulerRange, hourFrac, rulerTicks, payDayOf, destination, requirementText,
  payoutRow, paidThisMonth,
} from '../../lib/myPay'

// Prompt 753 — "My pay" (was Getting Paid): this week's pay in a hero (what
// you've earned so far, hours × rate, the pay day and where it goes, hours by
// day), your shifts on an 8a–8p ruler, where pay goes (Stripe Connect), and
// the payouts list. Presentational: pages/fulfillment/MyPay.jsx feeds it.
// Mockup: media/fulfillment-my-calls/my-pay.dc.html.

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]
const longDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const compactHours = h => {
  const mins = Math.round(h * 60)
  return mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60}h`
}

function Money({ cents }) {
  const [whole, frac] = fmtCents(cents).split('.')
  return <>{whole}<span className="mp-cents">.{frac}</span></>
}

function Hero({ which, onWhich, period, w, account }) {
  const dest = destination(account)
  const max = Math.max(8, ...w.days.map(d => d.full))
  const scale = h => Math.round(h / max * 130)
  return (
    <section className="ov-hero mp-hero" aria-label="This week's pay">
      <div className="mp-hero-main">
        <div className="mp-hero-top">
          <span className="ov-hero-chip"><span className="mp-dot" />{which === 'this' ? 'This week' : 'Last week'} · {fmtPeriod(period)}</span>
          <span className="mp-seg" role="group" aria-label="Pay week">
            {PERIODS.map(p => (
              <button key={p.value} type="button" aria-pressed={which === p.value} className={which === p.value ? 'is-on' : ''} onClick={() => onWhich(p.value)}>{p.label}</button>
            ))}
          </span>
        </div>
        {w.unset ? (
          <>
            <div className="mp-earn-label">Your pay</div>
            <div className="mp-unset">Brayden hasn't set your schedule yet</div>
            <div className="mp-calc">Once your hours and rate are in, what you've earned shows here.</div>
          </>
        ) : (
          <>
            <div className="mp-earn-label">{which === 'this' ? "You've earned so far" : 'You earned'}</div>
            <div className="mp-amount" data-testid="mp-amount"><Money cents={w.earned} /></div>
            <div className="mp-calc">
              <span className="mp-mono">{fmtHours(w.worked)}</span><span className="mp-x">×</span>
              <span className="mp-mono">{fmtCents(w.rate)}/hr</span><span className="mp-x">·</span>
              <span>{w.left > 0 ? `${compactHours(w.left)} left on your schedule` : 'your whole schedule'}</span>
            </div>
          </>
        )}
        <div className="mp-strip">
          <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />
          <span>Paid <b>{longDay(payDayOf(period))}</b> to {dest || 'your bank (add it below)'}</span>
        </div>
      </div>
      <div className="mp-chart" aria-label="Hours by day">
        <div className="mp-chart-head"><span>Hours by day</span><span>{w.scheduled != null ? `${compactHours(w.scheduled)} scheduled` : 'No schedule yet'}</span></div>
        <div className="mp-cols">
          {w.days.map(d => (
            <div key={d.date.getTime()} className={`mp-col${d.isToday ? ' is-today' : ''}`} title={d.off ? `${d.short}: off` : `${d.short}: ${compactHours(d.done)} of ${compactHours(d.full)}`}>
              <span className="mp-col-n">{dayHoursLabel(d)}</span>
              <span className="mp-col-plan" style={{ height: d.off ? 6 : scale(d.full) }}>
                <span className="mp-col-done" style={{ height: scale(d.done) }} />
              </span>
              <span className="mp-col-l">{d.letter}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Shifts({ w }) {
  const range = rulerRange(w.days)
  return (
    <section className="ov-card mp-card mp-shifts" aria-label="Your shifts">
      <div className="mp-card-head"><h2>Your shifts</h2><span>Hours come from your schedule. Nothing to clock.</span></div>
      <div className="mp-ticks">
        {rulerTicks(range).map(t => <span key={t.x} style={{ left: `${t.x}%` }}>{t.label}</span>)}
      </div>
      <div>
        {w.days.map(d => {
          const state = d.off ? 'off' : d.isToday ? 'now' : d.past ? 'done' : 'later'
          return (
            <div key={d.date.getTime()} className={`mp-shift is-${state}`}>
              <span className="mp-shift-day">{d.isToday ? 'Today' : `${d.short} ${d.date.getDate()}`}</span>
              <span className="mp-shift-track">
                {!d.off && (
                  <span className="mp-shift-bar" style={{ left: `${hourFrac(d.start, range)}%`, width: `${hourFrac(d.end, range) - hourFrac(d.start, range)}%` }}>
                    {shortTime(d.start)} – {shortTime(d.end)}
                  </span>
                )}
              </span>
              <span className="mp-shift-h">{d.off ? 'Off' : compactHours(d.full)}</span>
            </div>
          )
        })}
      </div>
      <p className="mp-foot">Something off? Message Brayden and he'll fix the week before it's paid.</p>
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
          <span>Payouts by Stripe</span>
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
      <div className="mp-later">PayPal · coming later</div>
    </section>
  )
}

function Payouts({ payouts, now, account }) {
  const month = paidThisMonth(payouts, now)
  return (
    <section className="ov-card mp-card mp-payouts" aria-label="Payouts">
      <div className="mp-payouts-head"><h2>Payouts</h2><span><span className="mp-mono">{fmtCents(month)}</span> paid this month</span></div>
      {payouts.length === 0 ? <p className="mp-empty">Your first payout shows here after your first week.</p> : (
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

export function MyPayView({ which, onWhich, period, now, pay, segments, payouts = [], account = null, status = 'none', accountLoading = false, onConnect, onSettings }) {
  const w = payWeek(pay, period, now, segments)
  return (
    <div className="mp-page">
      <Hero which={which} onWhich={onWhich} period={period} w={w} account={status === 'ready' ? account : null} />
      <div className="mp-grid">
        <Shifts w={w} />
        <div className="mp-side">
          <GetPaidTo status={status} account={account} loading={accountLoading} onConnect={onConnect} onSettings={onSettings} />
          <Payouts payouts={payouts} now={now} account={account} />
        </div>
      </div>
    </div>
  )
}
