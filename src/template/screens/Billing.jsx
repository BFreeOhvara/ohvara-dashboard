import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { paths } from '../paths'
import { Layers, CreditCard, Check, PauseCircle, PlayCircle, LogOut, Phone, CalendarClock, Clock, CircleAlert, Wallet, CalendarCheck2, Users, BadgeCheck, Target, SlidersHorizontal, Clock3, MapPin, RotateCcw, ArrowUpCircle, ShieldCheck } from 'lucide-react'
import { useSampleBilling, useSampleActions, useSampleAppointments } from '../data'
import { Chip, Drawer, Field, SampleTag, Seg, useNote } from '../kit'
import { Select } from '../Select'
import { usd } from '../motion'
import { DeskInfo } from '../../components/agent/DeskInfo'
import { deskBreakdown, deskParts, monthlyEstimate, deskLines, deskOfSpend, toAds, deskMonth, DESK_CARD_WORDS } from '../../lib/bookingDesk'
import { bought, planOf, dailyTotal, spendOk, nightlyFor, monthlyBill, feeWords, LEAD_FEE, SETUP_FEE, PAID_MIN_DAILY, TIERS, bandOf, bandText, switchDaily } from '../spendPlan'
import { planChange, changeWords } from '../../lib/planChange'
import { liveHoursText } from '../../lib/leadSplit'
import { TalkDrawer } from '../Talk'
import { cardOf, chargesOf } from '../billing917'
import '../p878.css'
import '../p893.css'
import '../bill910.css'
import { StatesDrawer } from '../YourStates'
import { useAgentStates, statesText } from '../useStates'
import { dayWords } from '../adStates'
import { ProductDrawers, PlanProductRows, PlanProductActions } from '../Products955'
import { billState } from '../productsView'
import { billDay } from '../../lib/planChange'
import { useProductPanel } from '../useProductPanel'
import { useProducts } from '../useProducts'
import { PRICES } from '../../lib/priceBook.js'

// P959: every agent sees the full Billing layout. What they don't use shows $0 with one quiet line, not nothing.
function NotOn({ add = 'leads' }) {
  return <small className="bl-noton">Not on your plan · <Link to={`${paths.billing()}?add=${add}`} className="tp-link">Add</Link></small>
}

// P878 — Billing, from the hole check (N-G-02, N-G-09, N-H-28, N-A-23, N-A-30, N-I-03, N-I-05). Sample only: nothing is
// charged. P909: the prices are final (price book version 3). P889: one daily spend and How you take leads (Appointments only, or Appointments +
// live transfers with live-call hours); the form/call split behind it is never shown. Lead spend is charged to the
// card each night for the next day; what the ads didn't spend comes off the next night's charge. One way to be billed
// (P914: no pilot, every agent pays from day one): a plan by daily spend band + the lead spend + 12% of it. Founding
// agents see their price lock and its end date. Preview a declined card with ?billing=failed, no card with ?card=none.
// P914: the plan section's daily lead spend is a slider ($50 to $500): the plan follows the band as it moves, with the
// nightly charge (spend + 12%) and the monthly plan live; Save applies it from the next charge.
// P910: rebuilt simple for the final model: plan, daily spend + 12%, the paid-ahead days, card on file, next charge,
// setup fee, founding lock; the results (spent, booked, shows, sold, cost per sale) as colour-coded tiles. One paid day
// is always in hand: each evening the day after tomorrow is charged (spendPlan.js nightly).
// P917: looks like real billing: Your plan (current plan, daily spend, Change plan opens the spend slider; P990: Edit plan), Payment
// method (brand, last 4, expiry, Update card) with the next charge, Charges (nightly lead spend, monthly plan, setup
// fee: date, amount, status), Paid ahead, Results, How you take leads, Pause or cancel. Founding lock in the plan.
// P921: plan changes are paid fairly. P990: moving up charges the price difference now, no day-counting (the band opens once it's paid;
// declined: nothing changes, Fix card); moving down starts on the next bill date, with Undo. The plan is saved
// (planOf), not worked out from the spend. ?upgrade=declined previews a declined upgrade, ?plan=down a scheduled move down.
const money = usd()
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`)
const cost = v => (v == null ? '–' : money(Math.round(v)))

// Pause (N-A-30, N-I-03): dates or until resumed; what stops and what keeps going; the billing effect; a reminder 2
// days before it ends; it resumes by itself.
// P890: the next four Mondays after tomorrow, as { label: 'Mon, Nov 16', iso: '2026-11-16' } (lead_pause_set takes the iso).
function pauseDays(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 2)
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
  return Array.from({ length: 4 }, (_, k) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * k)
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return { label: x.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), iso }
  })
}
function PauseDrawer({ open, onClose, appts }) {
  const { pause } = useSampleActions()
  const note = useNote()
  const [mode, setMode] = useState('dates')
  const [days] = useState(() => pauseDays())
  const [until, setUntil] = useState(days[1].label)
  const inPause = appts.filter(a => a.kind === 'lead' && a.date >= 3)
  const save = () => {
    const untilIso = mode === 'dates' ? days.find(x => x.label === until)?.iso || null : null
    pause({ from: 'Tue, Nov 3', until: mode === 'dates' ? until : null, untilIso })
    note(mode === 'dates' ? `Paused until ${until}. Lead spend and new leads stop` : 'Paused until you resume. Lead spend and new leads stop')
    onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title="Pause leads" sub="Your lead spend stops, and no new leads come in"
      footer={<><button type="button" className="tp-primary fx-accent" onClick={save}><PauseCircle size={15} />Pause</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Keep going</button></>}>
      <div className="lc-q"><b>For how long?</b><Seg role="radiogroup" label="For how long?" value={mode} onChange={setMode} options={[{ key: 'dates', label: 'Until a date' }, { key: 'open', label: 'Until I resume' }]} /></div>
      {mode === 'dates' && <Field label="Resume on" hint="Lead spend starts again by itself that morning. We remind you 2 days before."><Select label="Resume on" value={until} onChange={setUntil} options={days.map(x => x.label)} /></Field>}
      <div className="sp-effects">
        <div><h3>Stops</h3><ul><li>Your lead spend: none is used while you{'’'}re paused</li><li>New leads</li><li>Live calls ringing you</li></ul></div>
        <div><h3>Keeps going</h3><ul><li>Appointments already booked ({inPause.length}). Keep them, or move them from Calendar</li><li>Leads the team is already reaching</li><li>Servicing for every client</li><li>Your membership: it keeps charging as usual</li></ul></div>
      </div>
      {inPause.length > 0 && <ul className="fx-rows">{inPause.map(a => <li key={a.id} className="fx-row is-flat"><span className="fx-row-ic"><CalendarClock size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{a.who}</b><small>{a.day}, Nov {a.date}, {a.time}</small></span><Chip tone="blue">Still on</Chip></li>)}</ul>}
      <p className="tp-sub">No lead spend is charged while you’re paused. Your plan keeps charging, so servicing never stops. Any credit waits and comes off your first charge when you{'’'}re back.</p>
    </Drawer>
  )
}

// Cancel (N-I-05): why, an option that fits the reason, when it takes effect, the final bill, what happens, confirm.
const REASONS = ['It costs too much', 'Not enough appointments', 'Not closing enough', 'Taking a break', 'Leaving insurance', 'Something else']
function CancelDrawer({ open, onClose, b, onPause, onTalk }) {
  const { cancelPlan, setSpend, setProducts } = useSampleActions()
  const note = useNote()
  const [why, setWhy] = useState('')
  const [sure, setSure] = useState(false)
  const offer = {
    'It costs too much': ['Lower your daily spend', () => { setSpend({ daily: 25 }); note('Lead spend lowered to $25 a day. Starts tomorrow'); onClose() }],
    'Not enough appointments': ['Talk to someone first', () => { onClose(); onTalk() }],
    'Not closing enough': ['Talk to someone first', () => { onClose(); onTalk() }],
    'Taking a break': ['Pause instead', () => { onClose(); onPause() }],
    'Leaving insurance': null,
    'Something else': ['Talk to someone first', () => { onClose(); onTalk() }],
  }[why]
  const svcOnly = why === 'It costs too much' && b.products !== 'servicing'
  const done = () => { cancelPlan({ why, on: 'Sun, Nov 8' }); note('Cancelled. A confirmation email is on its way'); onClose() }
  return (
    <Drawer open={open} onClose={onClose} title="Cancel your plan" sub="We’re sorry to see you go"
      footer={<><button type="button" className="tp-btn ov-ghost tp-danger" disabled={!why || !sure} onClick={done}>Cancel my plan</button><button type="button" className="tp-primary fx-accent" onClick={onClose}>Keep my account</button></>}>
      <Field label="Why are you leaving?"><Select label="Why are you leaving?" placeholder="Pick a reason" value={why} onChange={v => { setWhy(v); setSure(false) }} options={REASONS} /></Field>
      {offer && <button type="button" className="lc-nudge" onClick={offer[1]}><span className="tp-grow"><b>{offer[0]}</b><small>Most agents who pick this stay.</small></span><span className="lc-nudge-go">Try it</span></button>}
      {svcOnly && <button type="button" className="lc-nudge" onClick={() => { setProducts('servicing'); note('Switched to servicing only. Leads stop on Sun, Nov 8'); onClose() }}><span className="tp-grow"><b>Keep servicing only</b><small>Your clients stay looked after. No new leads.</small></span><span className="lc-nudge-go">Switch</span></button>}
      {why && <>
        <div className="sp-effects">
          <div><h3>When</h3><ul><li>Ends Sun, Nov 8, the end of this week</li><li>New leads stop then; booked appointments stay on your calendar</li></ul></div>
          <div><h3>After that</h3><ul><li>The team stops servicing your clients</li><li>Your portal stays open for 30 days to download your book</li></ul></div>
        </div>
        <div className="pb-row"><span>Final bill</span><b className="tp-money">This month, as usual</b></div>
        <div className="pb-row"><span>Unspent lead spend credit, refunded</span><b className="tp-money">{money(b.nightNow.credit * (1 + b.nightNow.tonight.rate))}</b></div>
        <p className="tp-sub">The {money(SETUP_FEE)} setup fee isn{'’'}t refunded.</p>
        <label className="tp-check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} /><span>I understand my leads and servicing stop on Sun, Nov 8.</span></label>
        <p className="tp-sub">We email you a confirmation. You can come back any time.</p>
      </>}
    </Drawer>
  )
}

// P910 — the results metrics in a clean grid of colour-coded tiles, for the week or the month.
function ResultTiles({ rows }) {
  const r = bought(rows)
  const tiles = [
    ['spent', 'Spent', money(r.spent), 'blue', Wallet, `${r.leads} leads`],
    ['booked', 'Booked', r.booked + r.transferred, 'teal', CalendarCheck2, `${r.booked} on your calendar · ${r.transferred} live`],
    ['shows', 'Shows', r.showed, 'violet', Users, r.showRate == null ? 'No show rate yet' : `${pct(r.showRate)} show rate`],
    ['sold', 'Sold', r.sold, 'green', BadgeCheck, r.closeRate == null ? 'None yet' : `${pct(r.closeRate)} of calls you took`],
    ['per_sale', 'Cost per sale', cost(r.perSale), 'warn', Target, r.perSale == null ? 'After your first sale' : 'Spend ÷ sales'],
  ]
  return (
    <ul className="bl-tiles" aria-label="Your results">
      {tiles.map(([k, label, v, tone, Icon, sub], i) => (
        <li key={k} className={`bl-tile is-${tone}`} style={{ '--i': i }} data-metric={k}>
          <span className="bl-tile-k"><Icon size={15} aria-hidden="true" />{label}</span>
          <b className={k === 'spent' || k === 'per_sale' ? 'tp-money' : 'tp-num'}>{v}</b>
          <small>{sub}</small>
        </li>
      ))}
    </ul>
  )
}

// P914 — the plan section's spend slider: $50 to $500 a day. As it moves, the plan follows its band, and the nightly
// charge (spend + 12%) and the monthly plan update live. Nothing changes until Save; it applies from the next charge.
// P920: the slider only moves inside the current plan's band (`tier`), so dragging can never change the monthly price.
function PlanSpend({ tier, daily, onDaily, dirty, ok, onSave, onReset, forDay }) {
  const { lo, hi } = bandOf(tier)
  const v = Math.max(lo, Math.min(hi, daily))
  const night = nightlyFor('paid', v)
  const month = monthlyBill({ plan: 'paid', spend: { daily: v } })
  return (
    <div className="bl-spend">
      <div className="bl-spend-h">
        <label htmlFor="bl-daily">Daily lead spend</label>
        <b className="tp-money" aria-live="polite">{money(v)}<small> / day</small></b>
      </div>
      <input id="bl-daily" className="pb-range bl-range" type="range" min={lo} max={hi} step={5} value={v}
        style={{ '--w': hi > lo ? (v - lo) / (hi - lo) : 0 }} aria-valuetext={`${money(v)} a day, ${tier.label} plan`} onChange={e => onDaily(Number(e.target.value))} />
      <div className="bl-spend-scale" aria-hidden="true"><small>{money(lo)}</small><small>{money(hi)}</small></div>
      <p className="bl-band-note">The {tier.label} plan covers {bandText(tier)} a day. To spend outside that, switch plan below.</p>
      <dl className="bl-spend-live">
        <div className="bl-night"><dt>Charged each night</dt><dd><b className="tp-money">{money(night.total)} a night</b>{deskLines(night.net, night.fee).map(t => <small key={t}>{t}</small>)}</dd></div>
        <div><dt>Your plan</dt><dd><b>{tier.label}</b><small>{money(tier.monthly)} a month</small></dd></div>
        <div><dt>About a month</dt><dd><b className="tp-money">{money(month.total)}</b><small>Plan + spend + {feeWords}</small></dd></div>
      </dl>
      <p className="sc-est bl-est" data-testid="bl-estimate">{monthlyEstimate(v, LEAD_FEE).text} <DeskInfo rate={LEAD_FEE} label="" /></p>
      {dirty && (
        <div className="bl-spend-save">
          <small className="tp-grow">Applies from the next charge, for {forDay}. Days already paid keep their spend.</small>
          <button type="button" className="tp-btn ov-ghost" onClick={onReset}>Reset</button>
          <button type="button" className="tp-primary fx-accent" disabled={!ok} onClick={onSave}>Save</button>
        </div>
      )}
    </div>
  )
}

// P920 — Other plans: each other plan with its spend range and monthly price, and Switch to {plan}. Switching asks first.
// P921/P990: the confirm says what it costs and when: moving up, the price difference today and the full price every
// month on the same billing day (src/lib/planChange.js); moving down, from the bill date with no refund. A scheduled move down shows its date.
const money00 = v => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const centsTiers = () => TIERS.map(t => ({ ...t, monthly_cents: Math.round(t.monthly * 100) }))
const dayOf = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
function OtherPlans({ tierNow, daily, month, pending, onSwitch }) {
  const [ask, setAsk] = useState(null)
  const to = TIERS.find(t => t.key === ask)
  const others = TIERS.filter(t => t.key !== tierNow.key)
  if (to) {
    const start = switchDaily(daily, to)
    const c = planChange({ tiers: centsTiers(), fromKey: tierNow.key, toKey: to.key, today: month.today, nextBill: month.next, monthStart: month.start, pending })
    const up = c.direction === 'up'
    const capped = !up && daily > bandOf(to).hi
    return (
      <div className="bl-other is-confirm" role="alertdialog" aria-label={`Switch to ${to.label}`} data-direction={c.direction}>
        <p className="bl-other-ask"><b>{changeWords(c)}</b></p>
        <small className="bl-other-start">{up
          ? `Your daily spend moves to ${money(start)} a day once it’s paid. You can change it inside ${to.label} (${bandText(to)} a day).`
          : capped ? `On ${dayOf(c.nextBill)} your daily spend is set to ${money(bandOf(to).hi)} a day, the top of ${to.label}.` : `Daily spend ${bandText(to)} a day on ${to.label}.`}</small>
        <div className="bl-spend-save">
          <button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep {tierNow.label}</button>
          <button type="button" className="tp-primary fx-accent" data-confirm-switch={to.key} onClick={() => { onSwitch(to, start); setAsk(null) }}>
            {up ? `Pay ${money00(c.chargeCents / 100)} and switch` : `Switch on ${dayOf(c.nextBill)}`}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="bl-other">
      <h3>Other plans</h3>
      <ul className="bl-other-list">
        {others.map(t => (
          <li key={t.key} data-plan={t.key}>
            <span className="tp-grow"><b>{t.label}</b><small>{bandText(t)} a day · <span className="tp-money">{money(t.monthly)}</span> a month</small></span>
            {pending?.key === t.key
              ? <Chip tone="blue">From {pending.on}</Chip>
              : <button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(t.key)}>Switch to {t.label}</button>}
          </li>
        ))}
      </ul>
      <p className="pb-note">Moving up: you pay the difference between the two plans today, and the bigger range opens once it{'’'}s paid. Your billing day stays the same. Moving down: it starts with your next bill; no refund for this month.</p>
    </div>
  )
}

// P910 — one paid day in hand: today and tomorrow are paid; each evening the day after tomorrow is charged. A day that
// isn't paid when it starts brings no new leads (the ads never run on it).
function PaidAhead({ days }) {
  return (
    <ol className="bl-ahead" aria-label="Paid days">
      {days.map(d => (
        <li key={d.day} className={`is-${d.status}`} data-status={d.status}>
          <small>{d.label}</small>
          <b>{d.day}</b>
          <span>{d.status === 'paid' ? <><Check size={13} aria-hidden="true" />Paid</> : d.status === 'tonight' ? <><Clock size={13} aria-hidden="true" />Charged tonight</> : d.status === 'held' ? <><Clock size={13} aria-hidden="true" />After your card works</> : <><CircleAlert size={13} aria-hidden="true" />Not paid: no leads</>}</span>
        </li>
      ))}
    </ol>
  )
}

const CHARGE_STATUS = { paid: ['green', 'Paid'], scheduled: ['blue', 'Scheduled'], waiting: ['mute', 'Waiting'], declined: ['rose', 'Declined'], refunded: ['mute', 'Refunded'] }
const CHARGE_ICON = { lead: Wallet, plan: Layers, setup: BadgeCheck, reactivation: RotateCcw, reactivation_delivery: RotateCcw }
const money2 = v => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 })}`
function Charges({ rows }) {
  return (
    <ul className="bl-charges" aria-label="Charges">
      {rows.map((c, i) => {
        const [tone, word] = CHARGE_STATUS[c.status] || CHARGE_STATUS.paid
        const Icon = CHARGE_ICON[c.kind] || Wallet
        return (
          <li key={c.id} style={{ '--i': i }} data-status={c.status}>
            <span className={`bl-ch-ic is-${tone}`}><Icon size={15} aria-hidden="true" /></span>
            <span className="bl-ch-what"><b>{c.label}</b><small>{c.at}</small>{c.kind === 'lead' && c.spend != null && <small className="bl-ch-desk">{deskBreakdown(c.tonight ? 'Tonight' : '', c.spend, c.fee)}</small>}</span>
            <b className="tp-money bl-ch-amt">{money2(c.amount)}</b>
            <Chip tone={tone}>{word}</Chip>
          </li>
        )
      })}
      {rows.length === 0 && <li className="bl-ch-none">No charges yet. Your first ones show here.</li>}
    </ul>
  )
}

function CardFace({ face }) {
  return (
    <div className="bl-cardface" role="img" aria-label={`${face.brand}${face.last4 ? ` ending ${face.last4}` : ''}${face.exp ? `, expires ${face.exp}` : ''}`}>
      <span className="bl-cf-brand">{face.brand}</span>
      <span className="bl-cf-num tp-num">•••• •••• •••• {face.last4 || '••••'}</span>
      <span className="bl-cf-foot"><small>Expires</small><b className="tp-num">{face.exp || '––/––'}</b></span>
    </div>
  )
}

// Update card: sample only. The real form is the payment provider's own secure page; nothing is typed in here.
function CardDrawer({ open, onClose, face }) {
  const note = useNote()
  return (
    <Drawer open={open} onClose={onClose} title="Update card" sub="Your next charge uses the new card"
      footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { note('The secure card form opens here once billing is live. Sample only, nothing changed'); onClose() }}><CreditCard size={15} />Continue to the secure card form</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      {face && <div className="bl910"><CardFace face={face} /></div>}
      <p className="tp-sub">You type the new card on our payment provider{'’'}s secure page. We never see the full number. Days already paid stay paid; the new card is used from the next charge.</p>
    </Drawer>
  )
}

export default function Billing() {
  const { data: b } = useSampleBilling()
  const { data: appts } = useSampleAppointments()
  const { setSpend, resume, keepPlan, addCard, fixCard, changePlan, undoPlanChange } = useSampleActions()
  const note = useNote()
  const { hash } = useLocation()
  // P893: Results lives here now; /activity?view=results lands on it (#results)
  useEffect(() => { if (hash === '#results') document.getElementById('results')?.scrollIntoView({ block: 'start' }) }, [hash])
  const [spend, setDraft] = useState({ daily: Math.max(PAID_MIN_DAILY, dailyTotal(b.spend)) })
  const [range, setRange] = useState('week')
  const [panel, setPanel] = useState(null)
  const [prod, setProd, closeProd] = useProductPanel()
  const manage = k => setProd(`manage-${k}`)
  const st = useAgentStates()
  // P955: what they bought. Without Leads there's no plan by spend, no nightly charge, no paid-ahead days, no booking
  // desk, results or hours here: Servicing pays its month, Reactivation pays per delivered appointment (P957).
  const { has, picked } = useProducts()
  const leads = has('leads')
  // P959: what "Your own leads" has charged ($20 per delivered appointment or live call, once paid)
  const ownRows = chargesOf(b).filter(c => c.kind === 'reactivation' || c.kind === 'reactivation_delivery')
  const ownTotal = ownRows.reduce((t, c) => t + (Number(c.amount) || 0), 0)
  const ownCharged = ownRows.length ? ` · ${money2(ownTotal)} charged so far` : ''
  const n = b.nightNow
  const noCard = leads && b.card && !b.card.onFile && b.products !== 'servicing'
  const tierNow = planOf(b)
  const pendingTo = b.planNext ? TIERS.find(t => t.key === b.planNext.key) : null
  const daily = dailyTotal(b.spend)
  const unpaid = leads ? n.ahead.find(d => d.status === 'failed') : null
  const running = !b.paused && !b.cancel && !noCard
  const face = cardOf(b.card)
  // P990: which plan state (lead plan / Servicing only / none) and the boxes for it: no blank boxes.
  const state = billState(picked)
  // ?edit=1 (the phone's Edit plan) opens the edit drawer for the plan they have.
  const [sp] = useSearchParams()
  const wantEdit = sp.get('edit') === '1'
  useEffect(() => { if (!wantEdit) return; if (state === 'lead') setPanel('plan'); else if (state === 'servicing') setProd('manage-servicing') }, [wantEdit, state]) // eslint-disable-line react-hooks/exhaustive-deps
  const renew = b.planMonth?.next ? `Every month on the ${billDay(b.planMonth.next)}` : null
  const hero = state === 'lead'
    ? [{ k: 'plan', label: 'Current plan', big: tierNow.label, name: true },
       { k: 'price', label: 'Plan price', big: money(tierNow.monthly), unit: ' / month' },
       { k: 'renew', label: 'Renews', big: b.nextBill || 'With your first charge', name: true, sub: renew },
       { k: 'spend', label: 'Daily lead spend', big: money(daily), unit: ' / day', sub: `+ ${feeWords}` }]
    : state === 'servicing'
      ? [{ k: 'plan', label: 'Current plan', big: 'Servicing', name: true },
         { k: 'price', label: 'Plan price', big: money(PRICES.servicingOnly), unit: ' / month' },
         { k: 'renew', label: 'Renews', big: b.nextBill || 'With your first month', name: true, sub: renew }]
      : [{ k: 'plan', label: 'Current plan', big: has('reactivation') ? 'Reactivation only' : 'None', name: true },
         { k: 'price', label: has('reactivation') ? 'You pay' : 'Plan price', big: has('reactivation') ? '$20' : '$0', unit: has('reactivation') ? ' per booked' : ' / month' }]
  const save = () => {
    if (!spendOk('paid', spend)) return
    setSpend(spend)
    note(`Lead spend set to ${money(dailyTotal(spend))} a day. Starts with the next unpaid day. Sample only, nothing was charged`)
  }
  // P921: switching plan. Up: charged now, the plan changes once it's paid (declined: nothing changes). Down: from the
  // next bill. Back to the plan they're on: Undo.
  const switchPlan = (to, start) => {
    const r = changePlan(to.key, start)
    if (!r) return
    if (r.direction === 'up' && r.result === 'failed') { note(`Your card was declined. Nothing changed: you’re still on ${tierNow.label}. Sample only`); return }
    if (r.direction === 'up') {
      setDraft({ daily: start })
      note(`You’re on ${to.label}. Charged today ${money00(r.chargeCents / 100)}, the difference · then ${money(to.monthly)} every month on the ${billDay(r.nextBill)}. Sample only, nothing was charged`)
      return
    }
    if (r.direction === 'down') note(`Your plan changes to ${to.label} on ${b.nextBill}. You keep ${tierNow.label} until then. Sample only`)
    else note(`You stay on ${tierNow.label}. Sample only`)
  }
  const undo = () => { undoPlanChange(); note(`You stay on ${tierNow.label}. The change on ${b.planNext.on} is cancelled. Sample only`) }
  const next = unpaid
    ? { big: `${unpaid.day} first`, sub: `We try ${unpaid.day} again at 8 AM. ${n.forDay} is charged once it goes through` }
    : { big: money2(n.tonight.total), sub: `${b.nightly.at} · lead spend for ${n.forDay} · ${deskParts(n.tonight.net, n.tonight.fee)}${n.tonight.credit > 0 ? ` · ${money(n.tonight.credit)} credit used` : ''}` }
  return (
    <div className="tp-page fx-page fx-grid bl910">
      {unpaid && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert">
          <span className="tp-grow"><b>Your card didn{'’'}t go through</b><small>{unpaid.day} isn{'’'}t paid, so it brings no new leads unless it{'’'}s paid before it starts. Today is paid and runs. We try again at 8 AM. Servicing keeps going.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { fixCard(); note(`Card updated and charged. ${unpaid.day} is paid. Sample only`) }}><CreditCard size={15} />Fix card</button>
        </section>
      )}
      {leads && b.upgradeFailed && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert" data-alert="upgrade">
          <span className="tp-grow"><b>Your upgrade to {b.upgradeFailed.to} didn{'’'}t go through</b><small>Nothing changed: you{'’'}re still on {tierNow.label}, with its spend range. Fix your card, then switch again.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { fixCard(); note('Card updated. Switch plan again to upgrade. Sample only') }}><CreditCard size={15} />Fix card</button>
        </section>
      )}
      {noCard && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert">
          <span className="tp-grow"><b>Add a card to start your leads</b><small>We charge your first two days when it{'’'}s on, then one day ahead each evening. It shows as OHVARA LEADS.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { addCard(); note('Card added. Your first two days are charged tonight. Sample only') }}><CreditCard size={15} />Add card</button>
        </section>
      )}

      {/* P990: the plan card follows what the agent has. Lead plan: plan, price, renew date, daily spend; Edit plan.
          Servicing only: Servicing, $499, renew date; Upgrade plan + Edit plan. No plan: None (or Reactivation only);
          Upgrade plan + Add servicing. */}
      <section className="fx-tile is-fill is-blue fx-s7 bl-plan" style={{ '--i': 0 }} aria-label="Your plan" data-state={state}>
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your plan</h2><p>{state === 'none' ? 'Nothing monthly. Add a plan any time' : 'Month to month. Cancel anytime'}</p></span><SampleTag /></header>
        <div className={`bl-plan-hero is-${hero.length}`}>
          {hero.map(h => <span key={h.k} data-box={h.k}><small>{h.label}</small><b className={h.name ? 'bl-plan-name' : 'tp-money'}>{h.big}{h.unit && <small>{h.unit}</small>}</b>{h.sub && <em className="bl-plan-sub">{h.sub}</em>}</span>)}
        </div>
        <dl className="bl-rows">
          {leads && pendingTo && <div data-row="plan-next"><dt>Plan change</dt><dd><b>Changes to {pendingTo.label} on {b.planNext.on}</b><small>{money(pendingTo.monthly)} a month from then. You keep {tierNow.label} until then</small><button type="button" className="tp-btn ov-ghost bl-undo" onClick={undo}>Undo</button></dd></div>}
          {/* P949: the one campaign setting agents change themselves */}
          {leads && <div data-row="states"><dt>Your states</dt><dd><b>{statesText(st.states)}</b><small>{st.waiting ? `Changing ${dayWords(st.waiting.starts)}` : 'Your leads only come from these states'}</small></dd></div>}
          <PlanProductRows onManage={manage} charged={ownCharged} />
        </dl>
        <div className="tp-row tp-wrap bl-plan-acts">
          {state !== 'lead' && <button type="button" className="tp-primary fx-accent" data-act="upgrade" onClick={() => setProd('leads')}><ArrowUpCircle size={15} />Upgrade plan</button>}
          {state === 'lead' && <button type="button" className="tp-primary fx-accent" data-act="edit" onClick={() => setPanel('plan')}><SlidersHorizontal size={15} />Edit plan</button>}
          {state === 'servicing' && <button type="button" className="tp-btn ov-ghost" data-act="edit" onClick={() => manage('servicing')}><SlidersHorizontal size={15} />Edit plan</button>}
          {state === 'none' && <button type="button" className="tp-btn ov-ghost" data-act="add-servicing" onClick={() => setProd('servicing')}><ShieldCheck size={15} />Add servicing</button>}
          {leads && <button type="button" className="tp-btn ov-ghost" data-open="states" onClick={() => setPanel('states')}><MapPin size={15} />Your states</button>}
          <PlanProductActions onAdd={setProd} onManage={manage} noServicing />
          {leads && b.pending && <small className="bl-pending">{b.pending.starts}</small>}
        </div>
      </section>

      {/* Payment method and the next charge */}
      <section className="fx-tile fx-s5 bl-pay" style={{ '--i': 1 }} aria-label="Payment method">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Payment method</h2><p>{face ? 'Shows on your statement as OHVARA LEADS' : 'No card on file yet'}</p></span></header>
        {face ? <CardFace face={face} /> : <p className="fx-calm">{leads ? 'Leads start once a card is on file.' : 'Add a card before you add a product or send a list.'}</p>}
        <div className="tp-row tp-wrap">
          {face
            ? <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('card')}><CreditCard size={15} />Update card</button>
            : <button type="button" className="tp-primary fx-accent" onClick={() => { addCard(); note('Card added. Your first two days are charged tonight. Sample only') }}><CreditCard size={15} />Add card</button>}
        </div>
        {face && leads && <div className="bl-next" data-row="next"><small>Next charge</small><b className="tp-money">{next.big}</b><span>{next.sub}</span></div>}
        {face && !leads && has('servicing') && <div className="bl-next" data-row="next"><small>Next bill</small><b>{b.nextBill || 'With your first month'}</b><span>Servicing, every month</span></div>}
        {face && !leads && !has('servicing') && <div className="bl-next" data-row="next"><small>How you pay</small><b>Per appointment</b><span>Free to upload. $20 per appointment or live call we deliver. Nothing monthly</span></div>}
      </section>

      <section className="fx-tile fx-s7 bl-ch" style={{ '--i': 2 }} aria-label="Charges">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Charges</h2><p>{leads ? `Lead spend each night, your plan each month (and the difference when you move up), the ${money(SETUP_FEE)} setup fee once.` : has('servicing') ? `Servicing each month, the ${money(SETUP_FEE)} setup fee once, and each appointment or live call we deliver for your own leads.` : '$20 for each appointment or live call we deliver. Nothing monthly.'} Sample amounts.</p></span></header>
        <Charges rows={leads ? chargesOf(b) : chargesOf(b).filter(c => c.kind !== 'lead' && !c.tonight)} />
      </section>

      {!leads && <>
      <div className="fx-s5 bl-side">
      <section className="fx-tile bl-paid" style={{ '--i': 3 }} aria-label="Paid ahead">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Paid ahead</h2><p>Lead spend paid a day in hand</p></span></header>
        <p className="bl-zero"><b className="tp-money">$0</b></p>
        <NotOn />
      </section>
      <section className="fx-tile bl-desk" style={{ '--i': 4 }} aria-label="Booking desk">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Booking desk</h2><p>On top of your lead spend</p></span></header>
        <dl className="bl-desk-nums">
          <div><dt>Each night</dt><dd><b className="tp-money">$0</b></dd></div>
          <div><dt>About a month</dt><dd><b className="tp-money">$0</b></dd></div>
        </dl>
        <NotOn />
      </section>
      </div>
      <section className="fx-tile fx-s12 bl-results" id="results" style={{ '--i': 4 }} aria-label="Results">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Results</h2><p>What your lead spend bought</p></span><NotOn /></header>
        <ResultTiles rows={[]} />
      </section>
      </>}

      {leads && <>
      <div className="fx-s5 bl-side">
      <section className="fx-tile bl-paid" style={{ '--i': 3 }} aria-label="Paid ahead">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Paid ahead</h2><p>One paid day always in hand</p></span><Chip tone={running && !unpaid ? 'green' : 'mute'}>{b.cancel ? `Ending ${b.cancel.on}` : b.paused ? 'Paused' : noCard ? 'No card' : unpaid ? 'Fix card' : 'Leads running'}</Chip></header>
        <PaidAhead days={n.ahead} />
        <p className="pb-note">Each evening at 8 PM we charge the day after tomorrow, so tomorrow is always paid. If a card is declined, tomorrow still runs; a day that isn{'’'}t paid by the time it starts brings no new leads. Spend a day didn{'’'}t use comes off the next charge.</p>
        {b.paused && <div className="sp-paused"><b>Paused {b.paused.until ? `until ${b.paused.until}` : 'until you resume'}</b><small>{b.paused.until ? 'It resumes by itself. We remind you 2 days before.' : 'New leads start the day after you resume.'}</small>
          <span className="tp-row tp-wrap">{b.paused.until && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('pause')}>Extend</button>}<button type="button" className="tp-primary fx-accent" onClick={() => { resume(); note('Resumed. New leads start tomorrow') }}><PlayCircle size={15} />Resume now</button></span></div>}
        {b.cancel && <div className="sp-paused"><b>Your plan ends {b.cancel.on}</b><small>Changed your mind? Nothing stops until then.</small><button type="button" className="tp-primary fx-accent fx-self" onClick={() => { keepPlan(); note('Welcome back. Nothing changes') }}>Keep my account</button></div>}
      </section>

      {/* P949: what the booking desk is, in the room under Paid ahead (P933's words) */}
      <section className="fx-tile bl-desk" style={{ '--i': 4 }} aria-label="Booking desk">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Booking desk</h2><p>{deskOfSpend(LEAD_FEE)}</p></span></header>
        <p>{DESK_CARD_WORDS}</p>
        <dl className="bl-desk-nums">
          <div><dt>Each night</dt><dd><b className="tp-money">{money2(nightlyFor('paid', daily).fee)}</b><small>{toAds('on', daily, true)}</small></dd></div>
          <div><dt>About a month</dt><dd><b className="tp-money">{money(deskMonth(daily, LEAD_FEE).desk)}</b><small>{deskMonth(daily, LEAD_FEE).sub}</small></dd></div>
        </dl>
      </section>
      </div>

      <section className="fx-tile fx-s12 bl-results" id="results" style={{ '--i': 4 }} aria-label="Results">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Results</h2><p>What your lead spend bought</p></span><Seg label="Range" value={range} onChange={setRange} options={[{ key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }]} /></header>
        <ResultTiles rows={b.bought[range]} />
      </section>

      {/* P924: one set of hours. No Appointments only and no separate live-call hours: the hours in Settings are when
          booked calls land and live calls ring. */}
      <section className="fx-tile fx-s8 pb-tile" style={{ '--i': 5 }} aria-label="Your hours">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your hours</h2><p>Booked calls land and live calls ring inside these hours. Outside them, we book callers for your next open time.</p></span></header>
        <p className="bl-hours"><Clock3 size={16} aria-hidden="true" /><b>{liveHoursText(b.take.hours)}</b></p>
        <div className="tp-row tp-wrap bl-take-save">
          <p className="pb-note tp-grow">{money(dailyTotal(b.spend))} a day plus the {feeWords}, charged a day ahead. Change the spend with Edit plan.</p>
          <Link to={`${paths.settings()}?tab=calls`} className="tp-btn ov-ghost">Change your hours</Link>
        </div>
      </section>

      <section className="fx-tile fx-s4 sp-acts" style={{ '--i': 6 }} aria-label="Pause or cancel">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Pause or cancel</h2><p>{money(daily)} a day · {liveHoursText(b.take.hours)}</p></span></header>
        <ul className="tp-list">
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('pause')} disabled={!!b.cancel}><PauseCircle size={17} aria-hidden="true" /><span className="tp-grow"><b>{b.paused ? 'Change the pause' : 'Pause leads'}</b><small>Holidays, a full calendar, a break</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('talk')}><Phone size={17} aria-hidden="true" /><span className="tp-grow"><b>Talk to someone</b><small>About your spend, your plan, anything</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('cancel')} disabled={!!b.cancel}><LogOut size={17} aria-hidden="true" /><span className="tp-grow"><b>Cancel your plan</b><small>Unspent credit is refunded; the {money(SETUP_FEE)} setup fee isn’t</small></span></button></li>
        </ul>
      </section>
      </>}

      <Drawer open={panel === 'plan'} onClose={() => setPanel(null)} title="Edit plan" sub={`Now ${tierNow.label}, ${money(tierNow.monthly)} a month, ${money(daily)} a day. The slider stays inside this plan`}>
        <div className="bl910">
          <PlanSpend tier={tierNow} daily={dailyTotal(spend)} onDaily={d => setDraft({ daily: d })} dirty={dailyTotal(spend) !== daily} ok={spendOk('paid', spend)}
            onSave={() => { save(); setPanel(null) }} onReset={() => setDraft({ daily: Math.max(PAID_MIN_DAILY, daily) })} forDay={n.forDay} />
          <OtherPlans tierNow={tierNow} daily={daily} month={b.planMonth || { today: '2026-11-02', start: '2026-11-01', next: '2026-12-01' }} pending={b.planNext} onSwitch={switchPlan} />
          <p className="pb-note bl-edit-cancel">Want to stop? <button type="button" className="tp-link" data-act="cancel-plan" onClick={() => setPanel('cancel')} disabled={!!b.cancel}>Cancel your plan</button></p>
        </div>
      </Drawer>
      <ProductDrawers panel={prod} close={closeProd} />
      <StatesDrawer open={panel === 'states'} onClose={() => setPanel(null)} />
      <CardDrawer open={panel === 'card'} onClose={() => setPanel(null)} face={face} />
      <PauseDrawer open={panel === 'pause'} onClose={() => setPanel(null)} appts={appts} />
      <CancelDrawer open={panel === 'cancel'} onClose={() => setPanel(null)} b={b} onPause={() => setPanel('pause')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={() => setPanel(null)} topic="My plan or billing" />
    </div>
  )
}
