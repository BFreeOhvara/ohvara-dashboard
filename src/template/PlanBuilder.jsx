import { LEAD_TYPES, SLIDER, TIERS, PAID_MIN_DAILY, RECOMMENDED, tierOf, dailyTotal, bandShare, expected, rangeWords, monthlyBill, slotsNeeded } from './spendPlan'
import { SampleTag } from './kit'
import { usd } from './motion'
import './p878.css'

// P878 — the lead spend builder: one daily-spend slider per lead type (booked appointments, live calls), any amount and
// any split in the pilot, a $50/day floor on a paid plan. Under each, what it buys in a week; on a paid plan, the tier
// bands and the membership tier, live as the sliders move. Used by Billing, the Leads spend drawer and Setup. Every
// number comes from spendPlan.js (drafts). Agents never read where leads come from: it's "lead spend".
const money = usd()

function TypeSlider({ type, value, onChange, id, ex }) {
  const out = type.key === 'appts'
    ? [['Booked a week', rangeWords(ex.appts.booked)], ['Sales a week', rangeWords(ex.appts.sold)]]
    : [['Live calls to you a week', rangeWords(ex.live.delivered)], ['Sales a week', rangeWords(ex.live.sold)]]
  return (
    <div className="pb sp-type">
      <div className="pb-amt">
        <label htmlFor={id}>{type.label}</label>
        <b className="tp-money" aria-live="polite">{money(value)}<small> / day</small></b>
      </div>
      <input id={id} className="pb-range" type="range" min={SLIDER.min} max={SLIDER.max} step={SLIDER.step} value={value}
        style={{ '--w': bandShare(value) }} aria-valuetext={`${money(value)} a day on ${type.label.toLowerCase()}`} onChange={e => onChange(Number(e.target.value))} />
      <div className="pb-outs">{out.map(([k, v]) => <div key={k}><small>{k}</small><b className="tp-num">{value ? v : 'Off'}</b></div>)}</div>
    </div>
  )
}

// The tier bands under the total: where today's total daily spend sits.
export function TierBands({ daily }) {
  const tier = tierOf(daily)
  return (
    <div className="sp-bands" aria-label={`Total ${money(daily)} a day: ${tier.label} tier`}>
      <div className="sp-bands-bar">
        {TIERS.map(t => <span key={t.key} className={t.key === tier.key ? 'is-on' : ''} style={{ '--from': bandShare(t.from), '--to': bandShare(t.to ?? SLIDER.max) }}><b>{t.label}</b><small>{t.to == null ? `$${t.from - 1}+` : `$${t.from}–${t.to}`}</small></span>)}
        <i style={{ '--at': bandShare(daily) }} aria-hidden="true" />
      </div>
    </div>
  )
}

// spend = { appts, live } dollars a day. plan = 'pilot' | 'paid'. openSlots = the agent's open 30-minute slots a week.
export function SpendSliders({ spend, onSpend, plan, id = 'sp', openSlots = null }) {
  const ex = expected(spend)
  const daily = dailyTotal(spend)
  const low = plan === 'paid' && daily < PAID_MIN_DAILY
  const need = slotsNeeded(spend)
  const tight = openSlots != null && spend.appts > 0 && openSlots < need
  return (
    <div className="sp">
      {LEAD_TYPES.map(t => <TypeSlider key={t.key} type={t} id={`${id}-${t.key}`} value={spend[t.key]} ex={ex} onChange={v => onSpend({ ...spend, [t.key]: v })} />)}
      <div className="sp-total">
        <span className="tp-grow"><small>Total lead spend</small><b className="tp-money">{money(daily)} a day</b><small>{money(daily * 7)} a week · about {rangeWords(ex.soldMonth)} sales a month</small></span>
        {plan === 'paid' && <SampleTag>Draft prices</SampleTag>}
      </div>
      {plan === 'paid' && <TierBands daily={daily} />}
      {low && <p className="sp-warn" role="alert">Paid plans start at {money(PAID_MIN_DAILY)} a day in total. Set either type to $0 to turn it off.</p>}
      {tight && <p className="sp-warn" role="alert">Your calendar has {openSlots} open half-hours a week. This spend books up to {ex.appts.booked.high} appointments, so open about {need} to turn appointments on.</p>}
      <p className="pb-foot">{plan === 'pilot' ? 'Pilot: any amount, any split, change it any time. ' : ''}100% of your lead spend goes to finding your leads. A range, not a promise. {RECOMMENDED}</p>
    </div>
  )
}

// The monthly picture beside the sliders. Pilot: lead spend only, no fees. Paid: membership tier + lead spend.
export function SpendSummary({ spend, plan, products = 'both', children, vaAmount = 0 }) {
  const bill = monthlyBill({ plan, spend, products })
  return (
    <div className="pb-sum">
      <div className="pb-sum-h"><h3>{plan === 'pilot' ? 'Your pilot' : 'Your plan'}</h3><SampleTag>Draft prices</SampleTag></div>
      {products !== 'servicing' && <div className="pb-row"><span>Lead spend, about a month</span><b className="tp-money">{money(bill.leadSpend)}</b></div>}
      {plan === 'paid' && products !== 'servicing' && <div className="pb-row"><span>Membership · {bill.tier.label}</span><b className="tp-money">{bill.tier.monthly == null ? 'Priced with you' : `${money(bill.tier.monthly)} / month`}</b></div>}
      {products === 'servicing' && <div className="pb-row"><span>Servicing only</span><b className="tp-money">{money(bill.membership)} / month</b></div>}
      {vaAmount > 0 && <div className="pb-row"><span>Team time on your leads, at cost</span><b className="tp-money">{money(vaAmount)} / week</b></div>}
      <div className="pb-row sp-sum-total"><span>{plan === 'pilot' ? 'You pay only your lead spend' : 'About a month'}</span><b className="tp-money">{bill.total == null ? 'Priced with you' : money(bill.total)}</b></div>
      {children}
    </div>
  )
}

// How many were booked this week against the range the spend buys: the band is the range, the fill is the count.
export function BookedMeter({ booked, range }) {
  const top = Math.max(range.high, booked) * 1.15 || 1
  return (
    <span className="pb-meter" role="img" aria-label={`${booked} booked this week, about ${rangeWords(range)} expected`}>
      <em style={{ '--l': range.low / top, '--r': range.high / top }} />
      <i style={{ '--w': Math.min(1, booked / top) }} />
    </span>
  )
}
