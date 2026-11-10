import { SLIDER, TIERS, PAID_MIN_DAILY, SETUP_FEE, RECOMMENDED, MAX_DAILY, feeWords, FEE_WHY, tierOf, dailyTotal, bandShare, expected, rangeWords, monthlyBill, slotsNeeded, nightlyFor } from './spendPlan'
import { LEAD_MODES, DAYS, liveHoursOk, liveHoursText, clockMin } from '../lib/leadSplit'
import { Seg, Switch } from './kit'
import { Select } from './Select'
import { zoneAbbr } from '../lib/callSlots'
import { usd } from './motion'
import './p878.css'
import './p889.css'

// P909: up to $500 a day (an admin can raise one agent); a paid plan adds 12% of the spend, charged with it each night.
// P878 + P889 — the lead spend builder: ONE daily spend ($50 a day minimum, P914: no pilot) and
// How you take leads (Appointments only, or Appointments + live transfers with live-call hours). Under it, what it buys
// in a week; the tier bands and the membership tier, live as the slider moves. Used by Billing, the
// Leads spend drawer and Setup. Every number comes from spendPlan.js (drafts). Agents never read where leads come from
// or how the spend is split: it's "lead spend".
const money = usd()
const CLOCKS = ['7:00 AM', '8:00 AM', '9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM']

// take = { mode: 'appts' | 'both', hours: { Mon: { on, start, end } ... }, tz }
export function TakeLeads({ take, onTake, id = 'tk' }) {
  const set = (d, patch) => onTake({ ...take, hours: { ...take.hours, [d]: { ...take.hours[d], ...patch } } })
  const noHours = take.mode === 'both' && !liveHoursOk(take.hours)
  return (
    <div className="sp-take">
      <div className="lc-q"><b id={`${id}-mode`}>How you take leads</b>
        <Seg role="radiogroup" label="How you take leads" value={take.mode} onChange={mode => onTake({ ...take, mode })} options={LEAD_MODES.map(m => ({ key: m.key, label: m.label }))} /></div>
      <p className="tp-sub">{LEAD_MODES.find(m => m.key === take.mode)?.sub}</p>
      {take.mode === 'both' && (
        <div className="tp-field"><span>Your live-call hours{take.tz ? ` (your time, ${zoneAbbr(take.tz)})` : ''}</span>
          <div className="hr-week" role="group" aria-label="Live-call hours per weekday">
            {DAYS.map(d => {
              const day = take.hours[d]
              const bad = day.on && clockMin(day.end) <= clockMin(day.start)
              return (
                <div key={d} className="hr-day">
                  <b>{d}</b>
                  <Switch on={day.on} label={`Live calls on ${d}`} onChange={on => set(d, { on })} />
                  {day.on ? <>
                    <Select label={`${d} live calls start`} value={day.start} onChange={v => set(d, { start: v })} options={CLOCKS} />
                    <Select label={`${d} live calls end`} value={day.end} onChange={v => set(d, { end: v })} options={CLOCKS} invalid={bad} />
                  </> : <span className="is-off">Off. Leads that day are booked</span>}
                </div>
              )
            })}
          </div>
          <small>{noHours ? 'Turn on at least one day.' : `${liveHoursText(take.hours)}. Outside these hours every lead is booked on your calendar.`}</small>
        </div>
      )}
      {noHours && <p className="sp-warn" role="alert">Pick at least one day for live calls, or choose Appointments only.</p>}
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

// spend = { daily } dollars a day. plan = 'paid' (P914: the only plan). mode = how they take leads. openSlots = open 30-minute
// slots a week on their calendar. P921: band = { tier, lo, hi } keeps the slider inside the plan the agent is on (the
// server refuses a spend over the plan's band; moving up a plan is paid in Billing).
export function SpendSliders({ spend, onSpend, plan, mode = 'both', id = 'sp', openSlots = null, max = MAX_DAILY, band = null }) {
  const daily = dailyTotal(spend)
  const night = nightlyFor(plan, daily)
  const ex = expected({ daily }, mode)
  const low = daily < PAID_MIN_DAILY
  const need = slotsNeeded({ daily }, mode)
  const tight = openSlots != null && daily > 0 && openSlots < need
  const outs = [['Booked a week', rangeWords(ex.appts.booked)], ...(mode === 'both' ? [['Live transfers a week', rangeWords(ex.live.delivered)]] : []), ['Sales a month', rangeWords(ex.soldMonth)]]
  return (
    <div className="sp">
      <div className="pb sp-type">
        <div className="pb-amt">
          <label htmlFor={`${id}-daily`}>Daily lead spend</label>
          <b className="tp-money" aria-live="polite">{money(daily)}<small> / day</small></b>
        </div>
        <input id={`${id}-daily`} className="pb-range" type="range" min={band ? band.lo : SLIDER.min} max={band ? band.hi : max} step={SLIDER.step} value={band ? Math.max(band.lo, Math.min(daily, band.hi)) : Math.min(daily, max)}
          style={{ '--w': band ? (band.hi > band.lo ? (Math.max(band.lo, Math.min(daily, band.hi)) - band.lo) / (band.hi - band.lo) : 0) : bandShare(daily) }} aria-valuetext={`${money(daily)} a day`} onChange={e => onSpend({ daily: Number(e.target.value) })} />
        <div className="pb-outs">{outs.map(([k, v]) => <div key={k}><small>{k}</small><b className="tp-num">{daily ? v : 'Off'}</b></div>)}</div>
      </div>
      <div className="sp-total">
        <span className="tp-grow"><small>Charged each night for the next day</small><b className="tp-money">{money(night.total)}<small> = {money(daily)} + {feeWords}</small></b><small>About {rangeWords(ex.soldMonth)} sales a month · up to {money(max)} a day</small></span>
      </div>
      {band ? <p className="bl-band-note">Your {band.tier.label} plan covers ${band.tier.from}–{band.tier.to ?? max} a day. To spend more, switch plan in Billing.</p> : <TierBands daily={daily} />}
      {low && <p className="sp-warn" role="alert">Paid plans start at {money(PAID_MIN_DAILY)} a day. Pause instead if you need a break.</p>}
      {tight && <p className="sp-warn" role="alert">Your calendar has {openSlots} open half-hours a week. This spend books up to {ex.appts.booked.high} appointments, so open about {need}.</p>}
      <p className="pb-foot">100% of your lead spend goes to finding your leads. The {feeWords} on top {FEE_WHY}. Every lead gets a call within seconds. A range, not a promise. {RECOMMENDED}</p>
    </div>
  )
}

// The monthly picture beside the sliders: plan + lead spend + 12%, month to
// month. setup = show the one-time setup fee (sign-up / setup only), separate from the monthly total (P901, P909).
// clients = { added, total } for the extra-clients line.
export function SpendSummary({ spend, plan, products = 'both', children, setup = false, clients = null }) {
  const bill = monthlyBill({ plan, spend, products, clients })
  return (
    <div className="pb-sum">
      <div className="pb-sum-h"><h3>Your plan</h3></div>
      {products !== 'servicing' && <div className="pb-row"><span>Lead spend, about a month</span><b className="tp-money">{money(bill.leadSpend)}</b></div>}
      {products !== 'servicing' && <div className="pb-row"><span>{feeWords} of lead spend</span><b className="tp-money">{money(bill.fee)}</b></div>}
      {products !== 'servicing' && <div className="pb-row"><span>Plan · {bill.tier.label}</span><b className="tp-money">{money(bill.tier.monthly)} / month</b></div>}
      {products === 'servicing' && <div className="pb-row"><span>Servicing only, up to 100 clients</span><b className="tp-money">{money(bill.membership)} / month</b></div>}
      {bill.extra > 0 && <div className="pb-row"><span>Extra clients ({bill.over} over)</span><b className="tp-money">{money(bill.extra)} / month</b></div>}
      <div className="pb-row sp-sum-total"><span>About a month</span><b className="tp-money">{money(bill.total)}</b></div>
      {setup && <div className="pb-row"><span>Setup, one time</span><b className="tp-money">{money(SETUP_FEE)}</b></div>}
      <p className="pb-note">Month to month. Cancel anytime: unspent lead spend credit is refunded{setup ? ', the setup fee isn’t' : ''}.</p>
      {products !== 'servicing' && <p className="pb-note">Lead spend and its {feeWords} is charged to your card each night for the next day.</p>}
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
