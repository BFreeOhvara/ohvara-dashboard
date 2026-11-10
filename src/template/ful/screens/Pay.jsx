import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, CircleCheck, ArrowUpRight, FileText, Info, Clock3, Wallet, CalendarOff, CalendarCheck } from 'lucide-react'
import { useFulPay, useFulSource } from '../data'
import { FirstRun } from '../../DataState'
import { Chip, Drawer, PillTabs, SampleTag, useNote } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { TimesheetRows } from '../Clock879'
import { MY_SHEET, MY_RATE, weekPay } from '../p879'
import { hourGrid, hourLabel } from '../pay931'
import { useTimeOff } from '../useTimeOff'
import { dateLabel } from '../../../lib/vaShifts'
import './pay931.css'

// P845 — Pay, built with the care of the agent's Billing. P879 (Q75/Q76): VA pay is hourly only. P945: it's your set
// scheduled hours minus days off (nothing to correct). The hero is this week's hours × the rate with a bar per day,
// the detail is your shifts, then payouts and tax forms. The next payout is the one filled tile (sage).
// Sample amounts only; the per-cancellation pay is gone.
export default function Pay() {
  return useFulSource() === 'real' ? <PayReal /> : <PaySample />
}

// P852 — Pay on real data: payouts, the bank on file and the next payday are real (fulfillment_payouts, the payout
// account). P945: pay comes from the rota (scheduled hours, minus days off); until real shifts are read the hours part says so instead of
// showing sample hours. Bank details are only ever entered in the payout service's own form.
// P946 — under Next payout, the pay period at a glance, filling the column so it ends level with the left one: hours
// so far, earned so far, time off left, the next pay date, then the period day by day. Real: the hours part says it
// fills in from the rota.
function PayPeriod({ real = false, payday, i = 3 }) {
  const off = useTimeOff()
  const cents = usd(true)
  const w = weekPay()
  const g = hourGrid(MY_SHEET)
  const top = Math.max(1, ...g.rows.map(r => r.hours))
  const stats = [
    [Clock3, 'Hours so far', real ? '0' : w.hours.toFixed(1), 'hours'],
    [Wallet, 'Earned so far', cents(real ? 0 : w.pay), ''],
    [CalendarOff, 'Time off left', String(off.left), off.left === 1 ? 'day' : 'days'],
    [CalendarCheck, 'Next pay date', payday, ''],
  ]
  return (
    <section className="fx-tile pp946" style={{ '--i': i }} aria-label="This pay period">
      <header className="fx-tile-h"><span className="tp-grow"><h2>This pay period</h2><p>{real ? 'Mon to Sun · paid the Monday after' : `Nov 2 to 8 · ${cents(MY_RATE)} an hour`}</p></span></header>
      <dl className="pp946-stats">
        {stats.map(([Icon, k, v, unit]) => (
          <div key={k}><dt><Icon size={14} aria-hidden="true" />{k}</dt><dd className={k === 'Next pay date' ? '' : 'tp-num'}>{v}{unit && <small> {unit}</small>}</dd></div>
        ))}
      </dl>
      {real ? <p className="tp-sub pp946-note">Your hours fill in day by day once your rota is set.</p> : (
        <ul className="pp946-days" aria-label="The pay period, day by day">
          {g.rows.map(r => (
            <li key={r.day} className={`${r.off ? 'is-off' : ''}${r.live ? ' is-live' : ''}`}>
              <b>{r.name}</b>
              <span className="pp946-bar" aria-hidden="true"><i style={{ '--f': r.hours / top }} /></span>
              <span className="tp-num">{r.off ? 'Off' : `${r.hours.toFixed(1)} h`}</span>
              <span className="tp-num pp946-amt">{r.off ? '' : cents(r.hours * MY_RATE)}</span>
            </li>
          ))}
        </ul>
      )}
      <small className="pp946-foot">{off.next ? `Next day off ${dateLabel(off.next.date)}. ` : ''}Days off aren’t paid. Pay comes from your rota.</small>
    </section>
  )
}

function PayReal() {
  const { data: pay } = useFulPay()
  const money = usd()
  return (
    <div className="tp-page fx-page fx-ovl fs-pay">
      <div className="fx-ovl-main">
        <FirstRun icon={Info} title="Hours fill in from your rota" sub="Pay is hourly: your scheduled shifts, minus days off. Once your rota is set, this week's hours and pay show here." />
        <section className="fx-tile fs-pay-list" style={{ '--i': 1 }} aria-label="Payouts">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Payouts</h2><p>{pay.payouts.length ? 'Paid to your bank' : 'Nothing paid yet'}</p></span></header>
          {pay.payouts.length ? (
            <ul className="tp-list fs-rows">
              {pay.payouts.map(p => (
                <li key={p.id} className="fx-mrow">
                  <CircleCheck size={17} aria-hidden="true" className="fs-ok" />
                  <span className="tp-grow"><b>{p.week}</b><small>Paid {p.paid}</small></span>
                  <Chip tone="green">Paid</Chip>
                  <b className="tp-money">{money(p.amount)}</b>
                </li>
              ))}
            </ul>
          ) : <p className="fx-calm">Your first payout shows here after an admin checks your first week.</p>}
          {pay.pending.length > 0 && <ul className="tp-list fs-rows">{pay.pending.map(p => <li key={p.id} className="fx-mrow"><FileText size={17} aria-hidden="true" /><span className="tp-grow"><b>{p.week}</b><small>Being checked</small></span><b className="tp-money">{money(p.amount)}</b></li>)}</ul>}
        </section>
      </div>
      <div className="fx-ovl-side fs-pay-side">
        <section className="fx-tile is-fill is-green fs-payout" style={{ '--i': 2 }} aria-label="Next payout">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Next payday</h2><p>{pay.payday}, after an admin checks the week</p></span></header>
          <span className="fx-next-who"><Landmark size={16} aria-hidden="true" /><span><b>{pay.account.last4 ? `${pay.account.bank} •••• ${pay.account.last4}` : pay.account.bank}</b><small>{pay.account.status}</small></span></span>
          <Link to={fp('settings')} className="fx-pillbtn fx-self">Pay details<ArrowUpRight size={14} /></Link>
        </section>
        <PayPeriod real payday={pay.payday} />
      </div>
    </div>
  )
}

function PaySample() {
  const { data: pay } = useFulPay()
  const note = useNote()
  const money = usd()
  const cents = usd(true)
  const [tab, setTab] = useState('week')
  const [how, setHow] = useState(false)
  const w = weekPay()
  const g = hourGrid(MY_SHEET)
  return (
    <div className="tp-page fx-page fx-ovl fs-pay">
      <div className="fx-ovl-main">
        {/* P867: the hero fills the window (data-fold) so the pay detail below peeks about a third; its bars stretch. */}
        <section className="fx-tile fs-pay-hero" style={{ '--i': 0 }} aria-label="This week" data-fold>
          <header className="fx-tile-h">
            <span className="tp-grow"><h2>This week</h2><p>Nov 2 to 8 · {cents(MY_RATE)} an hour, on your scheduled hours</p></span>
            <button type="button" className="fx-open" aria-label="How pay works" onClick={() => setHow(true)}><Info size={16} /></button>
          </header>
          <div className="fx-chart-head fx-bk-head">
            <b className="tp-money fx-bk-num"><CountUp value={w.pay} format={cents} /></b>
            <span className="fx-bk-side"><b>so far</b><small>{money(pay.lastWeek)} last week</small><i className="fx-delta is-up">{w.hours.toFixed(1)} hours</i></span>
          </div>
          {/* P931: the hours as one clean grid: days of the week × the hours of the day, each day's total and the week's. */}
          <div className="pg931" role="table" aria-label="This week's hours by day">
            <div className="pg-row pg-head" role="row">
              <span role="columnheader" className="pg-day">Day</span>
              {g.hours.map(h => <span key={h} role="columnheader" className="pg-h">{h % 2 ? '' : hourLabel(h)}</span>)}
              <span role="columnheader" className="pg-tot">Hours</span>
            </div>
            {g.rows.map(r => (
              <div key={r.day} role="row" className={`pg-row${r.off ? ' is-off' : ''}${r.live ? ' is-live' : ''}`} title={r.off ? `${r.name}: off` : `${r.name}: ${r.in} to ${r.out || 'now'}, ${r.breakM} min break${r.flag ? `. ${r.flag}` : ''}`}>
                <span role="rowheader" className="pg-day"><b>{r.name}</b>{r.flag && <i className="pg-flag" aria-label={r.flag} />}</span>
                {r.cells.map((f, i) => <span key={g.hours[i]} role="cell" className="pg-c" aria-hidden="true"><i style={{ '--f': f }} /></span>)}
                <span role="cell" className="pg-tot tp-num">{r.off ? 'Off' : `${r.hours.toFixed(2)} h`}</span>
              </div>
            ))}
            <div className="pg-row pg-foot" role="row">
              <span role="rowheader" className="pg-day"><b>Week</b></span>
              <span role="cell" className="pg-sum">{g.breaks} min of breaks · {w.ot.toFixed(2)} h overtime · {MY_SHEET.filter(r => r.flag).length} flagged</span>
              <span role="cell" className="pg-tot tp-num"><b>{g.total.toFixed(2)} h</b></span>
            </div>
          </div>
          <div className="fx-key"><span><i className="is-line" />Scheduled hours</span><span><i className="is-dash" />Today, so far</span><SampleTag>Sample amounts</SampleTag></div>
        </section>

        <section className="fx-tile fs-pay-list" style={{ '--i': 1 }} aria-label="Pay detail">
          <PillTabs label="Pay detail" className="fx-ptabs" itemClass="fx-ptab" value={tab} onChange={setTab}
            items={[{ key: 'week', label: 'Your shifts', count: MY_SHEET.length }, { key: 'payouts', label: 'Payouts', count: pay.payouts.length }, { key: 'tax', label: 'Tax forms' }]} />
          <div className="fx-form" key={tab} role="tabpanel">
            {tab === 'week' && <TimesheetRows />}
            {tab === 'payouts' && (
              <ul className="tp-list fs-rows">
                {pay.payouts.map(p => (
                  <li key={p.id} className="fx-mrow">
                    <CircleCheck size={17} aria-hidden="true" className="fs-ok" />
                    <span className="tp-grow"><b>{p.week}</b><small>Paid {p.paid}</small></span>
                    <Chip tone="green">Paid</Chip>
                    <b className="tp-money">{money(p.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'tax' && (
              <ul className="tp-list fs-rows">
                <li className="fx-mrow"><FileText size={17} aria-hidden="true" /><span className="tp-grow"><b>Tax form for 2026</b><small>Ready by Jan 31, 2027, sent to {pay.account.taxEmail}</small></span><Chip tone="mute">Not ready</Chip></li>
                <li className="fx-mrow"><FileText size={17} aria-hidden="true" /><span className="tp-grow"><b>Tax details</b><small>Name and tax ID are kept by the payout service</small></span><button type="button" className="fx-pillbtn" onClick={() => note('Sample: opens the payout service')}>Update<ArrowUpRight size={13} /></button></li>
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="fx-ovl-side fs-pay-side">
        <section className="fx-tile is-fill is-green fs-payout" style={{ '--i': 2 }} aria-label="Next payout">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Next payout</h2><p>{pay.payday}, after an admin checks the week</p></span></header>
          <b className="fx-huge tp-money"><CountUp value={w.pay} format={cents} /></b>
          <small>Scheduled hours so far × {cents(MY_RATE)}. Days off aren't paid.</small>
          <span className="fx-next-who"><Landmark size={16} aria-hidden="true" /><span><b>{pay.account.bank} •••• {pay.account.last4}</b><small>{pay.account.status}</small></span></span>
          <Link to={fp('settings')} className="fx-pillbtn fx-self">Pay details<ArrowUpRight size={14} /></Link>
        </section>
        <PayPeriod payday={pay.payday} />
      </div>

      <Drawer open={how} onClose={() => setHow(false)} title="How pay works" sub="Sample amounts">
        <ol className="tp-tl fx-tl">
          {[['Your shifts', 'The hours set on your rota'], ['Days off', 'Taken out; you have a few a month'], ['Nothing to correct', 'Pay comes from the rota, not a timesheet'], ['Paid Monday', `Scheduled hours × ${cents(MY_RATE)} to ${pay.account.bank} •••• ${pay.account.last4}`]].map(([a, b]) => <li key={a} className="done"><i /><div><b>{a}</b><span>{b}</span></div></li>)}
        </ol>
      </Drawer>
    </div>
  )
}
