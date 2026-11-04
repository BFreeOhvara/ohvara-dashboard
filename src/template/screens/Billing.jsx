import { useState } from 'react'
import { Layers, CreditCard, Check } from 'lucide-react'
import { PLAN, modeOf, planRange, rangeText } from '../../lib/planPricing'
import { useSampleBilling, useSampleActions } from '../data'
import { Chip, Money, SampleTag, useNote } from '../kit'
import { CountUp, usd } from '../motion'
import { BudgetSlider, ServicingLine, PlanSummary, BookedMeter } from '../PlanBuilder'

// Sample-only: no payment or sign-in code. Prompt 835 billing model: a weekly budget the agent sets with a
// slider (it buys a range of booked appointments or live calls), policy servicing billed monthly, a one-time
// setup fee. Every price comes from lib/planPricing and is a draft.
export default function Billing() {
  const { data: b } = useSampleBilling()
  const { setBudget, setPaused } = useSampleActions()
  const note = useNote()
  const [weekly, setWeekly] = useState(b.budget.weekly)
  const [mode, setMode] = useState(b.budget.mode)
  const dirty = weekly !== b.budget.weekly || mode !== b.budget.mode
  const r = planRange(b.budget.weekly, b.budget.mode)
  const m = modeOf(b.budget.mode)
  return (
    <div className="tp-page fx-page fx-grid">
      <section className="fx-tile is-hero fx-s7" style={{ '--i': 0 }} aria-label="Your plan">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your plan</h2><p>Next weekly charge {b.next_charge} · servicing {b.servicing.next}</p></span><SampleTag /></header>
        <div className="tp-row tp-wrap pb-hero"><b className="tp-money fx-huge"><CountUp value={b.budget.weekly} format={usd()} /></b><span>a week</span></div>
        <div className="fx-split">
          <span><i className="is-blue" />Weekly budget<b><Money v={b.budget.weekly} cents={false} /></b></span>
          <span><i className="is-teal" />Servicing a month<b><Money v={PLAN.servicingMonthly} cents={false} /></b></span>
          <span><Check size={13} aria-hidden="true" />Setup paid {b.setup.at}</span>
        </div>
      </section>

      <section className="fx-tile fx-s5" style={{ '--i': 1 }} aria-label="Booked this week">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Booked this week</h2><p>{m.label} · resets Monday</p></span><Chip tone={b.paused ? 'mute' : 'green'}>{b.paused ? 'Paused' : 'Running'}</Chip></header>
        <div className="tp-row tp-wrap"><b className="tp-num fx-huge2"><CountUp value={b.booked} /></b><span className="tp-sub">booked so far</span></div>
        <BookedMeter booked={b.booked} weekly={b.budget.weekly} mode={b.budget.mode} />
        <p className="pb-note">Range {rangeText(r.week)} a week · {rangeText(r.month)} a month</p>
      </section>

      <section className="fx-tile fx-s12 pb-tile" style={{ '--i': 2 }} aria-label="Build your plan">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Build your plan</h2><p>Your budget runs the ads and our team books them for you. Servicing is billed monthly.</p></span></header>
        <div className="pb-grid">
          <div className="pb-steps">
            <p className="pb-step">Step 1 · Weekly budget</p>
            <BudgetSlider weekly={weekly} mode={mode} onWeekly={setWeekly} onMode={setMode} id="bill-budget" />
            <p className="pb-step">Step 2 · Policy servicing (monthly)</p>
            <ServicingLine />
          </div>
          <PlanSummary weekly={weekly} mode={mode} setupDone={b.setup.paid}>
            <p className="pb-note">{dirty ? `Your new budget starts with the charge on ${b.next_charge}.` : 'Change your budget any week. It starts with the next Monday charge.'}</p>
            <button type="button" className="tp-primary fx-accent" disabled={!dirty} onClick={() => { setBudget(weekly, mode); note(`Budget set to ${usd()(weekly)} a week. Sample only, nothing was charged`) }}>Save budget</button>
            <button type="button" className="tp-btn ov-ghost" onClick={() => { setPaused(!b.paused); note(b.paused ? 'Ads resumed' : 'Ads paused. Servicing keeps going') }}>{b.paused ? 'Resume ads' : 'Pause ads'}</button>
          </PlanSummary>
        </div>
      </section>

      {b.cancellations && (
        <section className="fx-tile fx-s12" style={{ '--i': 3 }} aria-label="Cancellation plan">
          <header className="fx-tile-h"><span className="tp-grow"><h2>Cancellation plan</h2><p>You are on this plan from before. It keeps going as it is.</p></span><Chip tone="blue">Current</Chip></header>
          <div className="tp-row tp-wrap"><b className="tp-money fx-huge2"><Money v={b.cancellations.weekly} cents={false} /></b><span className="tp-sub">a week · {b.cancellations.label}</span></div>
        </section>
      )}

      <section className="fx-tile fx-s12" style={{ '--i': 4 }} aria-label="History">
        <header className="fx-tile-h"><span className="tp-grow"><h2>History</h2><p>Sample amounts. Pricing is not final.</p></span><button type="button" className="tp-btn ov-ghost" onClick={() => note('Payment method changes are not open yet')}><CreditCard size={14} />Payment method</button></header>
        <ul className="fx-rows fx-hist">{b.history.map(h => <li key={h.id} className="fx-row is-flat"><span className="fx-row-ic"><Layers size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{h.label}</b><small>{h.at}</small></span><Money v={h.amount} /></li>)}</ul>
      </section>
    </div>
  )
}
