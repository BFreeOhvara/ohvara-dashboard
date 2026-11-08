import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Layers, CreditCard, Check, PauseCircle, PlayCircle, LogOut, Phone, CalendarClock, Clock, CircleAlert, Wallet, CalendarCheck2, Users, BadgeCheck, Target } from 'lucide-react'
import { useSampleBilling, useSampleActions, useSampleSettings, useSampleAppointments } from '../data'
import { Chip, Drawer, Field, Money, SampleTag, Seg, useNote } from '../kit'
import { Select } from '../Select'
import { usd } from '../motion'
import { SpendSliders, SpendSummary, TakeLeads } from '../PlanBuilder'
import { bought, vaCost, tierOf, dailyTotal, spendOk, openSlotsPerWeek, nightlyFor, feeWords, FEE_WHY, SETUP_FEE, MAX_DAILY } from '../spendPlan'
import { LEAD_MODES, liveHoursText, takeOk } from '../../lib/leadSplit'
import { TalkDrawer } from '../Talk'
import '../p878.css'
import '../p893.css'
import '../bill910.css'

// P878 — Billing, from the hole check (N-G-02, N-G-09, N-H-28, N-A-23, N-A-30, N-I-03, N-I-05). Sample only: nothing is
// charged. P909: the prices are final (price book version 3). P889: one daily spend and How you take leads (Appointments only, or Appointments +
// live transfers with live-call hours); the form/call split behind it is never shown. Lead spend is charged to the
// card each night for the next day; what the ads didn't spend comes off the next night's charge. Two ways to be billed:
//   Pilot: only lead spend. No plan, setup or 12% lines. An optional team-time line (admin switches it).
//   Paid:  a plan by daily spend band + the lead spend + 12% of it. The plan shows live as the slider moves and
//          changes from the next bill. Founding agents see their price lock and its end date.
// Preview the paid plan with ?plan=paid, a declined card with ?billing=failed, no card with ?card=none.
// P910: rebuilt simple for the final model: plan, daily spend + 12%, the paid-ahead days, card on file, next charge,
// setup fee, founding lock; the results (spent, booked, shows, sold, cost per sale) as colour-coded tiles. One paid day
// is always in hand: each evening the day after tomorrow is charged (spendPlan.js nightly).
const money = usd()
const MAX = MAX_DAILY
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
function PauseDrawer({ open, onClose, b, appts }) {
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
        <div><h3>Keeps going</h3><ul><li>Appointments already booked ({inPause.length}). Keep them, or move them from Calendar</li><li>Leads the team is already reaching</li><li>Servicing for every client</li>{b.plan !== 'pilot' && <li>Your membership: it keeps charging as usual</li>}</ul></div>
      </div>
      {inPause.length > 0 && <ul className="fx-rows">{inPause.map(a => <li key={a.id} className="fx-row is-flat"><span className="fx-row-ic"><CalendarClock size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{a.who}</b><small>{a.day}, Nov {a.date}, {a.time}</small></span><Chip tone="blue">Still on</Chip></li>)}</ul>}
      <p className="tp-sub">{b.plan === 'pilot' ? 'Nothing is charged for the days you’re paused.' : 'No lead spend is charged while you’re paused. Your plan keeps charging, so servicing never stops.'} Any credit waits and comes off your first charge when you{'’'}re back.</p>
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
        <div className="pb-row"><span>Final bill</span><b className="tp-money">{b.plan === 'pilot' ? 'Nothing more' : 'This month, as usual'}</b></div>
        <div className="pb-row"><span>Unspent lead spend credit, refunded</span><b className="tp-money">{money(b.nightNow.credit * (1 + b.nightNow.tonight.rate))}</b></div>
        {b.plan !== 'pilot' && <p className="tp-sub">The {money(SETUP_FEE)} setup fee isn{'’'}t refunded.</p>}
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

export default function Billing() {
  const { data: b } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { data: appts } = useSampleAppointments()
  const { setSpend, setTake, resume, keepPlan, addCard, fixCard } = useSampleActions()
  const note = useNote()
  const { hash } = useLocation()
  // P893: Results lives here now; /activity?view=results lands on it (#results)
  useEffect(() => { if (hash === '#results') document.getElementById('results')?.scrollIntoView({ block: 'start' }) }, [hash])
  const [spend, setDraft] = useState({ daily: dailyTotal(b.spend) })
  const [take, setTakeDraft] = useState(b.take)
  const [range, setRange] = useState('week')
  const [panel, setPanel] = useState(null)
  const dirty = dailyTotal(spend) !== dailyTotal(b.spend) || JSON.stringify(take) !== JSON.stringify(b.take)
  const pilot = b.plan === 'pilot'
  const n = b.nightNow
  const noCard = b.card && !b.card.onFile && b.products !== 'servicing'
  const va = pilot ? vaCost(b.va) : 0
  const tierNow = tierOf(dailyTotal(b.spend))
  const tierNew = tierOf(dailyTotal(spend))
  const open = openSlotsPerWeek(settings.week)
  const daily = dailyTotal(b.spend)
  const perDay = nightlyFor(b.plan, daily).total
  const unpaid = n.ahead.find(d => d.status === 'failed')
  const running = !b.paused && !b.cancel && !noCard
  const save = () => {
    if (!spendOk(b.plan, spend) || !takeOk(take)) return
    setSpend(spend)
    setTake(take)
    note(`Lead spend set to ${money(dailyTotal(spend))} a day, ${LEAD_MODES.find(m => m.key === take.mode).label.toLowerCase()}. Starts with the next unpaid day. Sample only, nothing was charged`)
  }
  const rows = [
    ['Plan', pilot ? 'Pilot · no plan fee' : `${tierNow.label} · ${money(tierNow.monthly)} a month`, pilot ? 'You pay only your lead spend' : `Next bill ${b.nextBill}. Covers the team, servicing, portal and app`],
    ['Daily lead spend', pilot ? `${money(daily)} a day` : `${money(daily)} + ${feeWords} = ${money(perDay)} a day`, pilot ? 'Charged one day ahead' : `${feeWords} ${FEE_WHY}`],
    unpaid
      ? ['Next charge', `${unpaid.day} first`, `We try ${unpaid.day} again at 8 AM. ${n.forDay} is charged once it goes through`]
      : ['Next charge', `${money(n.tonight.total)} · ${b.nightly.at}`, `For ${n.forDay}${n.tonight.credit > 0 ? ` · ${money(n.tonight.credit)} credit used` : ''}`],
    ['Card on file', b.card?.onFile ? b.card.label : 'No card yet', b.card?.onFile ? 'Shows on your statement as OHVARA LEADS' : 'Leads start once a card is on file'],
    ...(pilot ? [] : [['Setup fee', `${money(SETUP_FEE)} one time`, b.setupPaid ? `Paid ${b.setupPaid}. Not refunded` : 'Paid when your plan starts. Not refunded']]),
    ...(b.founding ? [['Founding price lock', `Until ${b.founding.until}`, `Founding agent #${b.founding.no}: your prices don’t change until then`]] : []),
  ]
  return (
    <div className="tp-page fx-page fx-grid bl910">
      {unpaid && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert">
          <span className="tp-grow"><b>Your card didn{'’'}t go through</b><small>{unpaid.day} isn{'’'}t paid, so it brings no new leads unless it{'’'}s paid before it starts. Today is paid and runs. We try again at 8 AM. Servicing keeps going.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { fixCard(); note(`Card updated and charged. ${unpaid.day} is paid. Sample only`) }}><CreditCard size={15} />Fix card</button>
        </section>
      )}
      {noCard && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert">
          <span className="tp-grow"><b>Add a card to start your leads</b><small>We charge your first two days when it{'’'}s on, then one day ahead each evening. It shows as OHVARA LEADS.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { addCard(); note('Card added. Your first two days are charged tonight. Sample only') }}><CreditCard size={15} />Add card</button>
        </section>
      )}

      <section className="fx-tile is-fill is-blue fx-s7 bl-plan" style={{ '--i': 0 }} aria-label={pilot ? 'Your pilot' : 'Your plan'} data-fold>
        <header className="fx-tile-h"><span className="tp-grow"><h2>{pilot ? 'Pilot · lead spend only' : `Plan · ${tierNow.label}`}</h2><p>Month to month. Cancel anytime</p></span><SampleTag /></header>
        <dl className="bl-rows">{rows.map(([k, v, sub]) => <div key={k}><dt>{k}</dt><dd><b>{v}</b><small>{sub}</small></dd></div>)}</dl>
      </section>

      <section className="fx-tile fx-s5 bl-paid" style={{ '--i': 1 }} aria-label="Paid ahead">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Paid ahead</h2><p>One paid day always in hand</p></span><Chip tone={running && !unpaid ? 'green' : 'mute'}>{b.cancel ? `Ending ${b.cancel.on}` : b.paused ? 'Paused' : noCard ? 'No card' : unpaid ? 'Fix card' : 'Leads running'}</Chip></header>
        <PaidAhead days={n.ahead} />
        <p className="pb-note">Each evening at 8 PM we charge the day after tomorrow, so tomorrow is always paid. If a card is declined, tomorrow still runs; a day that isn{'’'}t paid by the time it starts brings no new leads. Spend a day didn{'’'}t use comes off the next charge.</p>
        {b.paused && <div className="sp-paused"><b>Paused {b.paused.until ? `until ${b.paused.until}` : 'until you resume'}</b><small>{b.paused.until ? 'It resumes by itself. We remind you 2 days before.' : 'New leads start the day after you resume.'}</small>
          <span className="tp-row tp-wrap">{b.paused.until && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('pause')}>Extend</button>}<button type="button" className="tp-primary fx-accent" onClick={() => { resume(); note('Resumed. New leads start tomorrow') }}><PlayCircle size={15} />Resume now</button></span></div>}
        {b.cancel && <div className="sp-paused"><b>Your plan ends {b.cancel.on}</b><small>Changed your mind? Nothing stops until then.</small><button type="button" className="tp-primary fx-accent fx-self" onClick={() => { keepPlan(); note('Welcome back. Nothing changes') }}>Keep my account</button></div>}
      </section>

      <section className="fx-tile fx-s12 bl-results" id="results" style={{ '--i': 2 }} aria-label="Results">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Results</h2><p>What your lead spend bought</p></span><Seg label="Range" value={range} onChange={setRange} options={[{ key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }]} /></header>
        <ResultTiles rows={b.bought[range]} />
        {pilot && b.va.on && <p className="sp-plain">Team time on your leads and clients this week: {b.va.hours} hours at {money(b.va.rate)} an hour, at cost: <b className="tp-money">{money(va)}</b></p>}
      </section>

      <section className="fx-tile fx-s12 pb-tile" style={{ '--i': 3 }} aria-label="Your daily lead spend">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your daily lead spend</h2><p>{pilot ? 'One daily amount, charged a day ahead.' : `One daily amount plus ${feeWords}, charged a day ahead. Your plan follows it.`} Up to {money(MAX)} a day.</p></span></header>
        <div className="pb-grid">
          <div className="sp-col">
            <SpendSliders spend={spend} onSpend={setDraft} plan={b.plan} mode={take.mode} id="bill" openSlots={open} />
            <TakeLeads take={take} onTake={setTakeDraft} id="bill-take" />
          </div>
          <SpendSummary spend={spend} plan={b.plan} products={b.products} vaAmount={va}>
            {!pilot && tierNew.key !== tierNow.key && <p className="pb-note">That moves you to {tierNew.label}. The new plan applies from your next bill, {b.nextBill}.</p>}
            <p className="pb-note">{dirty ? `Days already paid keep their spend. The new spend starts with ${n.forDay}, charged tonight.` : b.pending ? b.pending.starts : 'Change it any day. It starts with the next day not yet paid.'}</p>
            <button type="button" className="tp-primary fx-accent" disabled={!dirty || !spendOk(b.plan, spend) || !takeOk(take)} onClick={save}>Save lead spend</button>
          </SpendSummary>
        </div>
      </section>

      <section className="fx-tile fx-s4 sp-acts" style={{ '--i': 4 }} aria-label="Change your plan">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Change your plan</h2><p>{money(daily)} a day · {b.take.mode === 'both' ? `Live transfers ${liveHoursText(b.take.hours)}` : 'Appointments only'}</p></span></header>
        <ul className="tp-list">
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('pause')} disabled={!!b.cancel}><PauseCircle size={17} aria-hidden="true" /><span className="tp-grow"><b>{b.paused ? 'Change the pause' : 'Pause leads'}</b><small>Holidays, a full calendar, a break</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('talk')}><Phone size={17} aria-hidden="true" /><span className="tp-grow"><b>Talk to someone</b><small>About your spend, your plan, anything</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => note('Payment method changes are not open yet')}><CreditCard size={17} aria-hidden="true" /><span className="tp-grow"><b>Card</b><small>{b.card?.onFile ? `${b.card.label} · OHVARA LEADS` : 'No card yet'}</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('cancel')} disabled={!!b.cancel}><LogOut size={17} aria-hidden="true" /><span className="tp-grow"><b>Cancel your plan</b><small>Unspent credit is refunded{pilot ? '' : `; the ${money(SETUP_FEE)} setup fee isn’t`}</small></span></button></li>
        </ul>
      </section>

      <section className="fx-tile fx-s8 pb-hist" style={{ '--i': 5 }} aria-label="History">
        <header className="fx-tile-h"><span className="tp-grow"><h2>History</h2><p>Lead spend charged a day ahead, and your plan. Sample amounts.</p></span></header>
        <ul className="fx-rows fx-hist">{b.history.map(h => <li key={h.id} className="fx-row is-flat"><span className="fx-row-ic"><Layers size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{h.label}</b><small>{h.at}</small></span><Money v={h.amount} /></li>)}</ul>
      </section>

      <PauseDrawer open={panel === 'pause'} onClose={() => setPanel(null)} b={b} appts={appts} />
      <CancelDrawer open={panel === 'cancel'} onClose={() => setPanel(null)} b={b} onPause={() => setPanel('pause')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={() => setPanel(null)} topic="My plan or billing" />
    </div>
  )
}
