import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, CircleCheck, ArrowUpRight, FileText, Info } from 'lucide-react'
import { useFulPay } from '../data'
import { Chip, Drawer, PillTabs, SampleTag, useNote } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { TimesheetRows } from '../Clock879'
import { MY_SHEET, MY_RATE, hoursOf, weekPay } from '../p879'

// P845 — Pay, built with the care of the agent's Billing. P879 (Q75/Q76): VA pay is hourly only, from clock in and
// out. The hero is this week's hours × the rate with a bar per day, the detail is the timesheet (ask for a
// correction; it locks at the pay run), then payouts and tax forms. The next payout is the one filled tile (sage).
// Sample amounts only; the per-cancellation pay is gone.
export default function Pay() {
  const { data: pay } = useFulPay()
  const note = useNote()
  const money = usd()
  const cents = usd(true)
  const [tab, setTab] = useState('week')
  const [how, setHow] = useState(false)
  const w = weekPay()
  const days = [2, 3, 4, 5, 6].map(d => { const r = MY_SHEET.find(x => x.day === d); return { day: d, name: ['', '', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'][d], h: r ? hoursOf(r) : 0, live: !!r?.live } })
  const top = Math.max(10, ...days.map(d => d.h))
  const breakM = MY_SHEET.reduce((t, r) => t + (r.breakM || 0), 0)
  return (
    <div className="tp-page fx-page fx-ovl fs-pay">
      <div className="fx-ovl-main">
        {/* P867: the hero fills the window (data-fold) so the pay detail below peeks about a third; its bars stretch. */}
        <section className="fx-tile fs-pay-hero" style={{ '--i': 0 }} aria-label="This week" data-fold>
          <header className="fx-tile-h">
            <span className="tp-grow"><h2>This week</h2><p>Nov 2 to 8 · {cents(MY_RATE)} an hour, from your clock in and out</p></span>
            <button type="button" className="fx-open" aria-label="How pay works" onClick={() => setHow(true)}><Info size={16} /></button>
          </header>
          <div className="fx-chart-head fx-bk-head">
            <b className="tp-money fx-bk-num"><CountUp value={w.pay} format={cents} /></b>
            <span className="fx-bk-side"><b>so far</b><small>{money(pay.lastWeek)} last week</small><i className="fx-delta is-up">{w.hours.toFixed(1)} hours</i></span>
          </div>
          <div className="fx-key"><span><i className="is-line" />Hours worked</span><span><i className="is-dash" />Today, still on the clock</span><SampleTag>Sample amounts</SampleTag></div>
          <div className="fs-bars" role="img" aria-label={days.map(d => `${d.name}: ${d.h.toFixed(1)} hours`).join('. ')}>
            {days.map((d, i) => (
              <span key={d.day} style={{ '--i': i }}>
                <b className="tp-num">{d.h ? `${d.h.toFixed(1)} h` : ''}</b>
                <i style={{ '--h': d.h / top }}><em style={{ '--h': d.live ? 0 : 1 }} /></i>
                <small>{d.name}</small>
              </span>
            ))}
          </div>
        </section>

        <section className="fx-tile fs-pay-list" style={{ '--i': 1 }} aria-label="Pay detail">
          <PillTabs label="Pay detail" className="fx-ptabs" itemClass="fx-ptab" value={tab} onChange={setTab}
            items={[{ key: 'week', label: 'Timesheet', count: MY_SHEET.length }, { key: 'payouts', label: 'Payouts', count: pay.payouts.length }, { key: 'tax', label: 'Tax forms' }]} />
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
          <small>Hours so far × {cents(MY_RATE)}. Today's hours join when you clock out.</small>
          <span className="fx-next-who"><Landmark size={16} aria-hidden="true" /><span><b>{pay.account.bank} •••• {pay.account.last4}</b><small>{pay.account.status}</small></span></span>
          <Link to={fp('settings')} className="fx-pillbtn fx-self">Pay details<ArrowUpRight size={14} /></Link>
        </section>
        <section className="fx-tile fs-pay-sum" style={{ '--i': 3 }} aria-label="This week's hours">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Hours</h2><p>This week</p></span></header>
          <ul className="fs-sum">
            {[['Worked', `${w.hours.toFixed(2)} h`, 'green'], ['Overtime', `${w.ot.toFixed(2)} h`, 'blue'], ['Breaks', `${breakM} min`, 'mute'], ['Flagged days', String(MY_SHEET.filter(r => r.flag).length), 'warn']].map(([k, v, tone]) => <li key={k} className={`is-${tone}`}><i aria-hidden="true" /><span className="tp-grow">{k}</span><b className="tp-num">{v}</b></li>)}
          </ul>
        </section>
      </div>

      <Drawer open={how} onClose={() => setHow(false)} title="How pay works" sub="Sample amounts">
        <ol className="tp-tl fx-tl">
          {[['Clock in and out', 'Within 15 minutes of your shift'], ['Breaks', 'Breaks are paid, lunch is not'], ['An admin checks the week', 'Ask for a fix before Monday; it locks at the pay run'], ['Paid Monday', `Hours × ${cents(MY_RATE)} to ${pay.account.bank} •••• ${pay.account.last4}`]].map(([a, b]) => <li key={a} className="done"><i /><div><b>{a}</b><span>{b}</span></div></li>)}
        </ol>
      </Drawer>
    </div>
  )
}
