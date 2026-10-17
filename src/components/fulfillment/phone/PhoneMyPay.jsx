import { useState } from 'react'
import { Landmark, CreditCard, TriangleAlert, Plus } from 'lucide-react'
import { fmtCents, fmtPeriod } from '../../../lib/payPeriod'
import { cancelTotals, cancelView, dayLabel, destination, initials, paidThisMonth, payDayOf, payoutRow, timeLabel } from '../../../lib/myPay'

// Prompt 773 — My pay on a rep's phone (mockup FulPay.dc.html): the week's
// earnings (verified + being checked, "N cancels × $rate"), when and where
// it's paid (or "Add a bank to get paid" with Connect a bank), the
// three-part filter card (Verified / Checking / Needs a listen; tap again
// clears) over Your cancels, then Payouts. Fed by pages/fulfillment/MyPay.jsx
// with the same data as the desktop view; a rep sees statuses only.

const FILTERS = [
  { kind: 'verified', label: 'Verified', color: 'var(--ph-pay-verified)' },
  { kind: 'checking', label: 'Checking', color: 'var(--ph-pay-checking)' },
  { kind: 'listen', label: 'Needs a listen', color: 'var(--ph-pay-listen)' },
]
const COLOR = { ...Object.fromEntries(FILTERS.map(f => [f.kind, f.color])), off: 'var(--ov-mute)' }
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
          <span>Your verified cancels wait here until you do</span>
        </span>
      </div>
      <button type="button" className="ph-pay-connect" onClick={fix ? onSettings : onConnect}>
        {!fix && <Plus size={17} strokeWidth={2.2} aria-hidden="true" />}
        {fix ? 'Fix it in Payout settings' : status === 'incomplete' ? 'Finish connecting your bank' : 'Connect a bank · 3 min'}
      </button>
    </>
  )
}

export function PhoneMyPay({ period, now, weekCancels = [], rate = 1000, payouts = [], account = null, status = 'none', accountLoading = false, onConnect, onSettings }) {
  const [filter, setFilter] = useState(null)
  const t = cancelTotals(weekCancels)
  const counted = t.verified + t.checking
  const [dollars, cents] = fmtCents(t.earnedCents).split('.')
  const rows = weekCancels
    .map(c => ({ c, v: cancelView(c) }))
    .sort((a, b) => b.c.logged_at.localeCompare(a.c.logged_at))
  const shown = filter ? rows.filter(r => r.v.kind === filter) : rows
  const count = { verified: t.verified, checking: t.checking, listen: t.listen }
  const month = paidThisMonth(payouts, now)

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ph-h1">My pay</h1>
        <span style={{ fontSize: 14, color: 'var(--ov-mute)' }}>This week · {fmtPeriod(period)}</span>
      </div>

      <section className="ov-hero ph-pay-hero" aria-label="This week's pay">
        <div className="ph-pay-k">You've earned this week</div>
        <div className="ph-pay-amt" data-testid="ph-pay-amount"><span>{dollars}</span><small>.{cents}</small></div>
        <div className="ph-pay-calc">{counted} cancel{counted === 1 ? '' : 's'} × {whole(rate)}</div>
        <div className="ph-pay-rule" />
        <BankLine status={status} account={account} loading={accountLoading} period={period} onConnect={onConnect} onSettings={onSettings} />
      </section>

      <div className="ov-card ph-seg ph-seg-3" role="group" aria-label="Filter cancels">
        {FILTERS.map(f => {
          const on = filter === f.kind
          return (
            <button key={f.kind} type="button" className={`ph-seg-btn${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setFilter(on ? null : f.kind)}>
              <span className="ph-seg-label" style={{ color: f.color }}>{f.label}</span>
              <span className="ph-seg-num">{count[f.kind]}</span>
              <span className="ph-seg-bar" style={{ background: f.color }} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <section aria-labelledby="ph-cancels">
        <div className="ph-sechead">
          <h2 id="ph-cancels" className="ph-h2">Your cancels</h2>
          <span style={{ flex: 1 }} />
          <span className="ph-mute">{whole(rate)} each</span>
        </div>
        <div className="ov-card ph-card">
          {shown.length === 0 ? (
            <div className="ph-empty">{rows.length ? 'Nothing here this week.' : 'No cancels this week yet. Each one you log shows here.'}</div>
          ) : shown.map(({ c, v }) => {
            const at = new Date(c.logged_at)
            const listen = v.kind === 'listen'
            return (
              <div key={c.id} className={`ph-row ph-pay-row${listen ? ' is-listen' : ''}`} style={{ cursor: 'default', minHeight: 68 }}>
                <span className="ph-ini" style={{ background: 'var(--ov-data-a-tint)', color: 'var(--ov-data-a)' }} aria-hidden="true">{initials(c.client_name)}</span>
                <span className="ph-row-main">
                  <span className="ph-row-title" style={{ fontSize: 15 }}>{c.client_name || 'Client'}</span>
                  <span className="ph-row-sub">{c.carrier_name || 'Carrier'} · {dayLabel(at, now)} {timeLabel(at)}</span>
                </span>
                <span className="ph-row-end">
                  <b style={{ color: COLOR[v.kind] }}>{v.label}</b>
                  <span className={`ph-pay-amt-sm${v.kind === 'verified' ? ' is-on' : ''}`}>{listen ? 'On hold' : v.kind === 'off' ? 'Not paid' : fmtCents(c.amount_cents)}</span>
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="ph-payouts">
        <div className="ph-sechead">
          <h2 id="ph-payouts" className="ph-h2">Payouts</h2>
          <span style={{ flex: 1 }} />
          <span className="ph-mute"><span className="ph-mono">{whole(month)}</span> this month</span>
        </div>
        <div className="ov-card ph-card">
          {payouts.length === 0 ? <div className="ph-empty">Your first payout shows here after your first verified cancel.</div> : payouts.slice(0, 6).map(p => {
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
