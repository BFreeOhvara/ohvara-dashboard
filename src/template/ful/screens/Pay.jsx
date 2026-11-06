import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Landmark, CircleCheck, ArrowUpRight, FileText, Info } from 'lucide-react'
import { useFulPay } from '../data'
import { Avatar, Chip, Drawer, PillTabs, SampleTag, useNote } from '../../kit'
import { CountUp, usd } from '../../motion'
import { fp } from '../paths'
import { PAY_WORD } from '../words'

// P845 — Pay, built with the care of the agent's Billing: this week's earnings as the hero with a bar per day
// (verified solid, still checking light), the week's cancellations with a coloured status each, the payout history
// behind the same stretch tabs, and the next payout as the one filled tile (sage). Sample amounts only; no logic
// change to how pay works (a flat amount per cancellation the carrier confirms, paid every Monday).
export default function Pay() {
  const { data: pay } = useFulPay()
  const note = useNote()
  const money = usd()
  const [tab, setTab] = useState('week')
  const [how, setHow] = useState(false)
  const top = Math.max(3, ...pay.byDay.map(d => d.verified + d.checking))
  return (
    <div className="tp-page fx-page fx-ovl fs-pay">
      <div className="fx-ovl-main">
        {/* P867: the hero fills the window (data-fold) so the pay detail below peeks about a third; its bars stretch. */}
        <section className="fx-tile fs-pay-hero" style={{ '--i': 0 }} aria-label="This week" data-fold>
          <header className="fx-tile-h">
            <span className="tp-grow"><h2>This week</h2><p>Nov 2 to 8 · {money(pay.rate)} for each cancellation the carrier confirms</p></span>
            <button type="button" className="fx-open" aria-label="How pay works" onClick={() => setHow(true)}><Info size={16} /></button>
          </header>
          <div className="fx-chart-head fx-bk-head">
            <b className="tp-money fx-bk-num"><CountUp value={pay.earned} format={money} /></b>
            <span className="fx-bk-side"><b>earned</b><small>{money(pay.lastWeek)} last week</small><i className="fx-delta is-up">{pay.rows.length} cancellations</i></span>
          </div>
          <div className="fx-key"><span><i className="is-line" />Verified</span><span><i className="is-dash" />Checking</span><SampleTag>Sample amounts</SampleTag></div>
          <div className="fs-bars" role="img" aria-label={pay.byDay.map(d => `${d.name}: ${d.verified} verified, ${d.checking} checking`).join('. ')}>
            {pay.byDay.map((d, i) => (
              <span key={d.day} className={d.later ? 'is-later' : ''} style={{ '--i': i }}>
                <b className="tp-num">{d.verified + d.checking ? money((d.verified + d.checking) * pay.rate) : ''}</b>
                <i style={{ '--h': (d.verified + d.checking) / top }}><em style={{ '--h': d.verified / Math.max(1, d.verified + d.checking) }} /></i>
                <small>{d.name}</small>
              </span>
            ))}
          </div>
        </section>

        <section className="fx-tile fs-pay-list" style={{ '--i': 1 }} aria-label="Pay detail">
          <PillTabs label="Pay detail" className="fx-ptabs" itemClass="fx-ptab" value={tab} onChange={setTab}
            items={[{ key: 'week', label: 'This week', count: pay.rows.length }, { key: 'payouts', label: 'Payouts', count: pay.payouts.length }, { key: 'tax', label: 'Tax forms' }]} />
          <div className="fx-form" key={tab} role="tabpanel">
            {tab === 'week' && (
              <ul className="tp-list fs-rows">
                {pay.rows.map(r => {
                  const [word, tone, why] = PAY_WORD[r.status]
                  return (
                    <li key={r.id}>
                      <Link to={fp('schedule', r.call.id)} className="fx-mrow">
                        <Avatar name={r.call.name} tone={tone} />
                        <span className="tp-grow"><b>{r.call.name}</b><small>{r.call.old_carrier} · {r.call.confirmation} · {why}</small></span>
                        <Chip tone={tone}>{word}</Chip>
                        <b className="tp-money">{r.status === 'needs_listen' ? '–' : money(r.amount)}</b>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
            {tab === 'payouts' && (
              <ul className="tp-list fs-rows">
                {pay.payouts.map(p => (
                  <li key={p.id} className="fx-mrow">
                    <CircleCheck size={17} aria-hidden="true" className="fs-ok" />
                    <span className="tp-grow"><b>{p.week}</b><small>{p.count} cancellations · paid {p.paid}</small></span>
                    <Chip tone="green">Paid</Chip>
                    <b className="tp-money">{money(p.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'tax' && (
              <ul className="tp-list fs-rows">
                <li className="fx-mrow"><FileText size={17} aria-hidden="true" /><span className="tp-grow"><b>1099-NEC for 2026</b><small>Ready by Jan 31, 2027, sent to {pay.account.taxEmail}</small></span><Chip tone="mute">Not ready</Chip></li>
                <li className="fx-mrow"><FileText size={17} aria-hidden="true" /><span className="tp-grow"><b>Tax details</b><small>Name and tax ID are kept by the payout service</small></span><button type="button" className="fx-pillbtn" onClick={() => note('Opens the payout service once you sign in for real')}>Review</button></li>
              </ul>
            )}
          </div>
        </section>
      </div>

      <div className="fx-ovl-side fs-pay-side">
        <section className="fx-tile is-fill is-green fs-payout" style={{ '--i': 2 }} aria-label="Next payout">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Next payout</h2><p>{pay.payday}, automatically</p></span></header>
          <b className="fx-huge tp-money"><CountUp value={pay.verified} format={money} /></b>
          <small>Verified so far. Checking ({money(pay.checking)}) joins once it is confirmed.</small>
          <span className="fx-next-who"><Landmark size={16} aria-hidden="true" /><span><b>{pay.account.bank} •••• {pay.account.last4}</b><small>{pay.account.status}</small></span></span>
          <Link to={fp('settings')} className="fx-pillbtn fx-self">Pay details<ArrowUpRight size={14} /></Link>
        </section>
        <section className="fx-tile fs-pay-sum" style={{ '--i': 3 }} aria-label="This week by status">
          <header className="fx-tile-h"><span className="tp-grow"><h2>By status</h2><p>This week</p></span></header>
          <ul className="fs-sum">
            {Object.entries(PAY_WORD).map(([k, [word, tone]]) => <li key={k} className={`is-${tone}`}><i aria-hidden="true" /><span className="tp-grow">{word}</span><b className="tp-num">{pay.rows.filter(r => r.status === k).length}</b></li>)}
          </ul>
          {pay.listen > 0 && <p className="tp-sub">{pay.listen} needs a listen: the team checks the recording and tells you by Monday.</p>}
        </section>
      </div>

      <Drawer open={how} onClose={() => setHow(false)} title="How pay works" sub="Sample amounts">
        <ol className="tp-tl fx-tl">
          {[['You mark a call Cancelled', 'With the carrier\'s confirmation number'], ['It is checked', 'Usually a few minutes after the call'], ['Verified', `${money(pay.rate)} added to this week`], ['Paid Monday', `To ${pay.account.bank} •••• ${pay.account.last4}`]].map(([a, b]) => <li key={a} className="done"><i /><div><b>{a}</b><span>{b}</span></div></li>)}
        </ol>
      </Drawer>
    </div>
  )
}
