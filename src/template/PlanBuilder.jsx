import { PLAN, MODES, modeOf, planRange, rangeText, budgetShare } from '../lib/planPricing'
import { SampleTag } from './kit'
import { usd } from './motion'

// Prompt 835 — the plan builder: a weekly budget slider, booked appointments or live calls, and the range it
// buys. Used by Billing, the Leads budget drawer and the Welcome plan step. Every number comes from
// lib/planPricing (drafts); none is written here.
const money = usd()

export function ModePick({ mode, onMode, label = 'What you get' }) {
  return (
    <div className="tp-seg pb-mode" role="radiogroup" aria-label={label}>
      {MODES.map(m => (m.key === mode
        ? <span key={m.key} role="radio" aria-checked="true" className="on">{m.label}</span>
        : <button key={m.key} type="button" role="radio" aria-checked="false" onClick={() => onMode(m.key)}>{m.label}</button>))}
    </div>
  )
}

export function BudgetSlider({ weekly, mode, onWeekly, onMode, id = 'pb-budget' }) {
  const r = planRange(weekly, mode)
  const m = modeOf(mode)
  const { min, max, step, ticks } = PLAN.budget
  return (
    <div className="pb">
      <ModePick mode={mode} onMode={onMode} />
      <div className="pb-amt">
        <label htmlFor={id}>Your weekly budget</label>
        <b className="tp-money" aria-live="polite">{money(weekly)}<small> / week</small></b>
      </div>
      <input id={id} className="pb-range" type="range" min={min} max={max} step={step} value={weekly}
        style={{ '--w': budgetShare(weekly) }} aria-valuetext={`${money(weekly)} a week`} aria-describedby={`${id}-out`}
        onChange={e => onWeekly(Number(e.target.value))} />
      <div className="pb-ticks" aria-hidden="true">{ticks.map(t => <span key={t} style={{ '--at': budgetShare(t) }}>{money(t)}</span>)}</div>
      <div className="pb-outs" id={`${id}-out`}>
        <div><small>{m.label} a month</small><b className="tp-num">{rangeText(r.month)}</b></div>
        <div><small>Per week, on average</small><b className="tp-num">{rangeText(r.week)}</b></div>
      </div>
      <p className="pb-foot">A range, not a promise: results move with ad costs and how many people answer. Change your budget any week.</p>
    </div>
  )
}

export function ServicingLine() {
  return (
    <div className="pb-svc">
      <span className="tp-grow"><b>Policy servicing</b><small>Our team keeps your book on the books: packets, changes, lapse saves, chargeback watch.</small></span>
      <b className="tp-money">{money(PLAN.servicingMonthly)}<small> / month</small></b>
    </div>
  )
}

export function PlanSummary({ weekly, mode, children, setupDone }) {
  return (
    <div className="pb-sum">
      <div className="pb-sum-h"><h3>Your plan</h3><SampleTag>Draft prices</SampleTag></div>
      <div className="pb-row"><span>Weekly budget · {modeOf(mode).unit}</span><b className="tp-money">{money(weekly)} / week</b></div>
      <div className="pb-row"><span>Policy servicing</span><b className="tp-money">{money(PLAN.servicingMonthly)} / month</b></div>
      <div className="pb-row"><span>One-time setup{setupDone ? ' · paid' : ''}</span><b className="tp-money">{money(PLAN.setupFee)}</b></div>
      {children}
    </div>
  )
}

// How many were booked this week against the range the budget buys: the band is the range, the fill is the count.
export function BookedMeter({ booked, weekly, mode }) {
  const r = planRange(weekly, mode).week
  const top = Math.max(r.high, booked) * 1.15 || 1
  return (
    <span className="pb-meter" role="img" aria-label={`${booked} booked this week, range ${rangeText(r)}`}>
      <em style={{ '--l': r.low / top, '--r': r.high / top }} />
      <i style={{ '--w': Math.min(1, booked / top) }} />
    </span>
  )
}
