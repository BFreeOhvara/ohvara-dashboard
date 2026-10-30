import { useState } from 'react'
import { CalendarDays, Landmark, Settings as Gear, TriangleAlert, CreditCard } from 'lucide-react'
import { fmtCents, fmtPeriod } from '../../lib/payPeriod'
import {
  payDayOf, destination, requirementText, payoutRow, paidThisMonth, cancelTotals, cancelsByDay, cancelView,
  dayLabel, timeLabel, initials,
} from '../../lib/myPay'

// Prompt 764 — "My pay", pay per verified cancel. A literal port of
// media/fulfillment-pay-per-cancel/my-pay-per-cancel.dc.html: the hero (what
// you've earned this week = verified + being checked, the chips, the pay day,
// the weekly minimum line, cancels by day), Your cancels (tabs + rows) and,
// on the right, Get paid to and Payouts. A rep only ever sees a status and a
// note, never transcripts, recordings or AI quotes. Presentational:
// pages/fulfillment/MyPay.jsx feeds it.

const PERIODS = [{ value: 'this', label: 'This week' }, { value: 'last', label: 'Last week' }]
const TABS = [{ value: 'all', label: 'All' }, { value: 'verified', label: 'Verified' }, { value: 'checking', label: 'Checking' }, { value: 'listen', label: 'Needs a listen' }]
const longDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const whole = cents => (cents % 100 ? fmtCents(cents) : fmtCents(cents).replace(/\.00$/, ''))
const AV_TONES = 6

function Money({ cents }) {
  const [w, frac] = fmtCents(cents).split('.')
  return <>{w}<span className="mp-cents">.{frac}</span></>
}

function Hero({ which, onWhich, period, now, cancels, rate, minCents, account }) {
  const t = cancelTotals(cancels)
  const days = cancelsByDay(cancels, period, now)
  const max = Math.max(5, ...days.map(d => d.n))
  const unit = n => Math.round(n / max * 150)
  const dest = destination(account)
  const counted = t.verified + t.checking
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
        <div className="mp-earn-label">{which === 'this' ? "You've earned this week" : 'You earned last week'}</div>
        <div className="mp-earn">
          <span className="mp-amount" data-testid="mp-amount"><Money cents={t.earnedCents} /></span>
          <span className="mp-calc"><b className="mp-mono">{counted}</b> cancel{counted === 1 ? '' : 's'} <span className="mp-x">×</span> <b className="mp-mono">{whole(rate)}</b></span>
        </div>
        <div className="mp-chips">
          <span className="mp-chip is-verified"><i />{whole(t.verifiedCents)} verified</span>
          <span className="mp-chip is-checking"><i />{whole(t.checkingCents)} being checked</span>
          <span className="mp-chip is-listen"><i />{t.listen} needs a listen</span>
        </div>
        {minCents != null && (
          <div className="mp-floor">
            Weekly minimum <b className="mp-mono">{whole(minCents)}</b> · {t.verifiedCents >= minCents
              ? <span className="is-past">you're past it</span>
              : t.verified > 0 ? <span>you'll get at least this</span> : <span>with one verified cancel</span>}
          </div>
        )}
        <div className="mp-strip">
          <CalendarDays size={16} strokeWidth={2} aria-hidden="true" />
          <span>Paid <b>{longDay(payDayOf(period))}</b> to {dest || 'your bank (add it below)'}</span>
        </div>
      </div>
      <div className="mp-chart" aria-label="Cancels by day">
        <div className="mp-chart-head"><span>Cancels by day</span><span>{whole(rate)} each</span></div>
        <div className="mp-cols">
          {days.map(d => (
            <div key={d.date.getTime()} className={`mp-col${d.isToday ? ' is-today' : ''}${d.future ? ' is-future' : ''}`}
              title={d.future ? `${d.short}: later` : `${d.short}: ${d.verified} verified, ${d.checking} being checked, ${d.listen} needs a listen`}>
              <span className="mp-col-n">{d.future ? '–' : d.n}</span>
              <span className="mp-stack">
                {d.future ? <span className="mp-bar is-empty" style={{ height: 120 }} /> : (
                  <>
                    {d.listen > 0 && <span className="mp-bar is-listen" style={{ height: unit(d.listen) }} />}
                    {d.checking > 0 && <span className="mp-bar is-checking" style={{ height: unit(d.checking) }} />}
                    {d.verified > 0 && <span className="mp-bar is-verified" style={{ height: unit(d.verified) }} />}
                  </>
                )}
              </span>
              <span className="mp-col-l">{d.isToday ? 'Today' : d.short}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Cancels({ cancels, now, recording = true }) {
  const [tab, setTab] = useState('all')
  const rows = cancels.map(c => ({ c, v: cancelView(c) }))
  const count = k => (k === 'all' ? rows.filter(r => r.v.kind !== 'off').length : rows.filter(r => r.v.kind === k).length)
  const shown = rows.filter(r => (tab === 'all' ? true : r.v.kind === tab))
  return (
    <section className="ov-card mp-card mp-cancels" aria-label="Your cancels">
      <div className="mp-cancels-head">
        <h2>Your cancels</h2>
        <span className="mp-tabs" role="tablist" aria-label="Show">
          {TABS.map(t => (
            <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tab === t.value ? 'is-on' : ''} onClick={() => setTab(t.value)}>
              {t.label}<span className="mp-mono">{count(t.value)}</span>
            </button>
          ))}
        </span>
      </div>
      {/* P777: while recording is off, every cancel waits for Brayden by hand. */}
      <p className="mp-cancels-sub">{recording
        ? 'Every cancel call is recorded. AI listens for the carrier confirming the cancel. Verified cancels are paid Monday.'
        : 'Brayden checks each cancel before pay day. Verified cancels are paid Monday.'}</p>
      <div className="mp-thead" aria-hidden="true"><span>LOGGED</span><span>CLIENT · AGENT</span><span>STATUS</span><span>PAY</span></div>
      {shown.length === 0 ? <p className="mp-empty">{cancels.length ? 'Nothing here this week.' : 'No cancels this week yet. Each one you log shows here.'}</p> : (
        <ul className="mp-rows">
          {shown.map(({ c, v }, i) => {
            const at = new Date(c.logged_at)
            return (
              <li key={c.id} className={`mp-row is-${v.kind}`}>
                <span className="mp-when"><b>{dayLabel(at, now)}</b><span className="mp-mono">{timeLabel(at)}</span></span>
                <span className="mp-who">
                  <span className="mp-ini" data-tone={i % AV_TONES}>{initials(c.client_name)}</span>
                  <span className="mp-who-t"><b>{c.client_name || 'Client'}</b><span>{c.carrier_name || 'Carrier'} · for {c.agent_name || 'agent'}</span></span>
                </span>
                <span className="mp-status"><span className={`mp-spill is-${v.kind}`}><i />{v.label}</span><span className="mp-note">{v.note}</span></span>
                <span className={`mp-pay mp-mono is-${v.kind}`}>{fmtCents(c.amount_cents)}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mp-foot">If the call wasn’t clear, Brayden listens and decides before pay day.</p>
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
      <p className="mp-wait">Your confirmed cancels wait here until a bank is added.</p>
    </section>
  )
}

function Payouts({ payouts, now, account }) {
  const month = paidThisMonth(payouts, now)
  return (
    <section className="ov-card mp-card mp-payouts" aria-label="Payouts">
      <div className="mp-payouts-head"><h2>Payouts</h2><span><span className="mp-mono">{fmtCents(month)}</span> paid this month</span></div>
      {payouts.length === 0 ? <p className="mp-empty">Your first payout shows here after your first verified cancel.</p> : (
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
  which, onWhich, period, now, weekCancels = [], rate = 1000, minCents = null,
  payouts = [], account = null, status = 'none', accountLoading = false, onConnect, onSettings, recording = true,
}) {
  return (
    <div className="mp-page">
      <Hero which={which} onWhich={onWhich} period={period} now={now} cancels={weekCancels} rate={rate} minCents={minCents} account={status === 'ready' ? account : null} />
      <div className="mp-grid">
        <Cancels cancels={weekCancels} now={now} recording={recording} />
        <div className="mp-side">
          <GetPaidTo status={status} account={account} loading={accountLoading} onConnect={onConnect} onSettings={onSettings} />
          <Payouts payouts={payouts} now={now} account={account} />
        </div>
      </div>
    </div>
  )
}
