import { useState } from 'react'
import { CalendarCheck2, PhoneIncoming, ShieldCheck, Bell, ChevronDown } from 'lucide-react'
import { useSampleBilling } from './data'
import { Seg } from './kit'
import { bought, rangeWords, weekVsUsual } from './spendPlan'
import './p878.css'
import './p889.css'

// P878 — Results (N-K-07, N-I-02, N-K-13): what the agent's lead spend bought (P889: one line, booked and transferred
// apart, then shows and sales), for the week or the month;
// their week against their usual week (with the Monday push it becomes); and the policies servicing saved. Plain words
// only: nothing about how leads are found.
const money = v => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const cost = v => (v == null ? 'None yet' : money(Math.round(v)))
const pct = v => (v == null ? 'None yet' : `${Math.round(v * 100)}%`)

// P889: one lead product, so one set of numbers. Booked and Transferred are separate, then shows and sales.
function Funnel({ r }) {
  const steps = [
    ['Booked on your calendar', r.booked, CalendarCheck2], ['Live transfers you took', r.transferred, PhoneIncoming],
    ['Showed', r.showed, null], ['Sold', r.sold, null],
  ]
  return (
    <section className="fx-tile fx-s6 rs-type" aria-label="What your leads became">
      <header className="fx-tile-h"><span className="tp-grow"><h2>What your leads became</h2><p>{r.leads} leads, every one called within seconds</p></span></header>
      <div className="rs-four">{steps.map(([k, v, Icon]) => <div key={k}>{Icon ? <Icon size={15} aria-hidden="true" /> : null}<small>{k}</small><b className="tp-num">{v}</b></div>)}</div>
      <dl className="rs-dl">{[['Pickup rate', `${pct(r.pickup)} (${r.transferred} of ${r.offered} offered)`], ['Show rate', pct(r.showRate)], ['Close rate', pct(r.closeRate)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-num">{v}</dd></div>)}</dl>
    </section>
  )
}
function Costs({ r }) {
  const lines = [['Spent', money(r.spent)], ['Cost per lead', cost(r.perLead)], ['Cost per booked or transferred lead', cost(r.perHandled)], ['Monthly premium sold', money(r.premium)], ['Cost per sale', cost(r.perSale)]]
  return (
    <section className="fx-tile fx-s6 rs-type" aria-label="What it cost">
      <header className="fx-tile-h"><span className="tp-grow"><h2>What it cost</h2><p>Your lead spend, start to sale</p></span></header>
      <dl className="rs-dl">{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-num">{v}</dd></div>)}</dl>
    </section>
  )
}

export function Results() {
  const { data: b } = useSampleBilling()
  const [range, setRange] = useState('week')
  const [openSaved, setOpenSaved] = useState(null)
  const r = bought(b.bought[range])
  const { spent, sold, premium } = r
  const range4 = b.expected.appts.booked
  const vs = weekVsUsual({ booked: b.booked, usual: b.usual, expectedRange: range4 })
  const savedPremium = b.saved.reduce((t, s) => t + s.premium, 0)
  return (
    <>
      <div className="fx-tools">
        <Seg label="Results range" value={range} onChange={setRange} options={[{ key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }]} />
        <span className="tp-grow" />
        <p className="tp-sub">{range === 'week' ? 'Mon, Nov 2 to today' : 'November so far, with October for the month view'}</p>
      </div>
      <div className="fx-grid">
        <section className="fx-tile fx-s12 rs-sum" aria-label="Totals">
          <div><small>Lead spend</small><b className="tp-num">{money(spent)}</b></div>
          <div><small>Booked</small><b className="tp-num">{r.booked}</b></div>
          <div><small>Transferred</small><b className="tp-num">{r.transferred}</b></div>
          <div><small>Showed</small><b className="tp-num">{r.showed}</b></div>
          <div><small>Policies sold</small><b className="tp-num">{sold}</b></div>
          <div><small>Monthly premium sold</small><b className="tp-num">{money(premium)}</b></div>
          <div><small>Cost per sale</small><b className="tp-num">{cost(sold ? spent / sold : null)}</b></div>
        </section>
        <Funnel r={r} />
        <Costs r={r} />
        <section className="fx-tile fx-s6 rs-vs" aria-label="Your week vs your usual week">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Your week vs your usual week</h2><p>Booked appointments, Monday to Sunday</p></span></header>
          <div className="rs-vs-n"><b className="tp-num">{b.booked}</b><small>this week</small><b className="tp-num">{b.usual}</b><small>your usual week</small></div>
          <p className="rs-vs-l">{vs.line} At your spend we expect {rangeWords(range4)} a week.</p>
          {vs.slow && <p className="rs-slow">A slow week happens: fewer people asked for a quote, or more of them didn{'’'}t pick up. Your spend only pays for what came in, and anything left over rolls into next week.</p>}
          <div className="rs-push" aria-label="Monday summary preview"><Bell size={14} aria-hidden="true" /><span><b>Every Monday, 8:00 AM</b>Last week: {b.booked} booked ({vs.line.replace(/\.$/, '').toLowerCase()}), {r.transferred} transferred. {sold} sold, {money(premium)} in monthly premium.</span></div>
        </section>
        <section className="fx-tile fx-s6 rs-saved" aria-label="Saved by servicing">
          <header className="fx-tile-h"><span className="rs-ic"><ShieldCheck size={16} aria-hidden="true" /></span><span className="tp-grow"><h2>Saved by servicing</h2><p>{b.saved.length} policies kept, {money(savedPremium)} a month in premium</p></span></header>
          <ul className="rs-sl">
            {b.saved.map(s => (
              <li key={s.id}>
                <button type="button" aria-expanded={openSaved === s.id} onClick={() => setOpenSaved(openSaved === s.id ? null : s.id)}>
                  <b className="tp-grow">{s.who}</b><span className="tp-num">{money(s.premium)}/mo</span><ChevronDown size={14} aria-hidden="true" />
                </button>
                {openSaved === s.id && <p>{s.what} · {s.at}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
