import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Layers, CreditCard, Check, PauseCircle, PlayCircle, LogOut, Phone, PlusCircle, CalendarClock } from 'lucide-react'
import { useSampleBilling, useSampleActions, useSampleSettings, useSampleAppointments } from '../data'
import { Chip, Drawer, Field, Money, SampleTag, Seg, Pending, useNote } from '../kit'
import { Select } from '../Select'
import { CountUp, usd } from '../motion'
import { SpendSliders, SpendSummary, BookedMeter, TakeLeads } from '../PlanBuilder'
import { bought, vaCost, tierOf, dailyTotal, rangeWords, spendOk, openSlotsPerWeek } from '../spendPlan'
import { LEAD_MODES, liveHoursText, takeOk } from '../../lib/leadSplit'
import { TalkDrawer } from '../Talk'
import '../p878.css'
import '../p893.css'
import { Results } from '../Results'

// P878 — Billing, from the hole check (N-G-02, N-G-09, N-H-28, N-A-23, N-A-30, N-I-03, N-I-05). Sample only: nothing is
// charged. P901: the prices are final (price book version 2). P889: one daily spend and How you take leads (Appointments only, or Appointments +
// live transfers with live-call hours); the form/call split behind it is never shown. Two ways to be billed:
//   Pilot: only lead spend, prepaid each week (unspent money rolls over; leads stop when it runs out). No membership,
//          setup or fee lines. Shows exactly what each lead type bought. An optional team-time line (admin switches it).
//   Paid:  a membership tiered by total daily spend + the lead spend. The tier shows live as the sliders move and
//          changes from the next bill.
// Preview the paid plan with ?plan=paid, a low balance with ?billing=low, a failed card with ?billing=failed.
const money = usd()
const pct = v => (v == null ? '–' : `${Math.round(v * 100)}%`)
const cost = v => (v == null ? '–' : money(Math.round(v)))

// P889: one line for the agent (they never see a split). Booked and transferred are separate numbers, then shows
// and sales.
function BoughtTable({ rows }) {
  const r = bought(rows)
  const lines = [
    ['Spent', money(r.spent)], ['Leads', r.leads], ['Reached', r.reached], ['Booked on your calendar', r.booked],
    ['Live transfers you took', `${r.transferred} of ${r.offered} offered`], ['Showed', r.showed], ['Sold', r.sold],
    ['Cost per lead', cost(r.perLead)], ['Cost per booked or transferred lead', cost(r.perHandled)],
    ['Show rate', pct(r.showRate)], ['Pickup rate', pct(r.pickup)], ['Cost per sale', cost(r.perSale)],
  ]
  return (
    <div className="sp-table is-one" role="table" aria-label="What your spend bought">
      {lines.map(([k, x]) => <div role="row" key={k} className="sp-tr"><span role="rowheader">{k}</span><b role="cell" className="tp-num">{x}</b></div>)}
    </div>
  )
}

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
      {b.plan === 'pilot'
        ? <p className="tp-sub">Your prepaid balance ({money(b.walletNow.left)}) waits for you and rolls into the week you come back.</p>
        : <p className="tp-sub">Your membership keeps charging while you{'’'}re paused, so servicing never stops. Any lead spend left rolls into the week you come back.</p>}
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
        <div className="pb-row"><span>Final bill</span><b className="tp-money">{b.plan === 'pilot' ? 'Nothing more: you prepaid this week' : 'This month, as usual'}</b></div>
        {b.plan === 'pilot' && <Pending>Unspent prepaid lead spend at cancel: policy not final</Pending>}
        <label className="tp-check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} /><span>I understand my leads and servicing stop on Sun, Nov 8.</span></label>
        <p className="tp-sub">We email you a confirmation. You can come back any time.</p>
      </>}
    </Drawer>
  )
}

export default function Billing() {
  const { data: b } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { data: appts } = useSampleAppointments()
  const { setSpend, setTake, resume, keepPlan, topUp, fixCard } = useSampleActions()
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
  const w = b.walletNow
  const wk = b.expected.appts.booked
  const va = pilot ? vaCost(b.va) : 0
  const tierNow = tierOf(dailyTotal(b.spend))
  const tierNew = tierOf(dailyTotal(spend))
  const open = openSlotsPerWeek(settings.week)
  const running = !b.paused && !b.cancel && !b.payment.failed && !(pilot && w.out)
  const save = () => {
    if (!spendOk(b.plan, spend) || !takeOk(take)) return
    setSpend(spend)
    setTake(take)
    note(`Lead spend set to ${money(dailyTotal(spend))} a day, ${LEAD_MODES.find(m => m.key === take.mode).label.toLowerCase()}. Starts tomorrow at 12:00 AM. Sample only, nothing was charged`)
  }
  return (
    <div className="tp-page fx-page fx-grid">
      {b.payment.failed && (
        <section className="fx-tile fx-s12 sp-alert" style={{ '--i': 0 }} role="alert">
          <span className="tp-grow"><b>Your card didn{'’'}t go through</b><small>New leads are stopped until it does. Servicing keeps going for 3 days.</small></span>
          <button type="button" className="tp-primary fx-accent" onClick={() => { fixCard(); note('Card updated. Leads start again. Sample only') }}><CreditCard size={15} />Update card</button>
        </section>
      )}

      <section className="fx-tile is-fill is-blue fx-s7 pb-plan" style={{ '--i': 0 }} aria-label={pilot ? 'Your pilot' : 'Your plan'} data-fold>
        <header className="fx-tile-h"><span className="tp-grow"><h2>{pilot ? 'Pilot · lead spend only' : `Membership · ${tierNow.label}`}</h2><p>{pilot ? `Prepaid each week · tops up ${w.next}` : `Next bill ${b.nextBill}`}</p></span><SampleTag /></header>
        {pilot ? <>
          <div className="tp-row tp-wrap pb-hero"><b className="tp-money fx-huge"><CountUp value={w.left} format={money} /></b><span>left this week</span></div>
          <div className="fx-split">
            <span><i className="is-blue" />Loaded<b><Money v={w.loaded} cents={false} /></b></span>
            <span><i className="is-teal" />Rolled over<b><Money v={w.rolled} cents={false} /></b></span>
            <span><i className="is-blue" />Spent<b><Money v={w.spent} cents={false} /></b></span>
          </div>
          <p className="sp-plain">{w.out ? `Your balance ran out. New leads wait until ${w.next}, or top up now.` : `About ${w.daysLeft} days of leads left at ${money(dailyTotal(b.spend))} a day. Unspent money rolls into next week.`}</p>
          {(w.low || w.out) && <button type="button" className="tp-primary fx-accent fx-self" onClick={() => { topUp(dailyTotal(b.spend) * 3); note('Topped up 3 days. Sample only, nothing was charged') }}><PlusCircle size={15} />Top up 3 days</button>}
        </> : <>
          <div className="tp-row tp-wrap pb-hero"><b className="tp-money fx-huge"><CountUp value={tierNow.monthly} format={money} /></b><span>a month, plus your lead spend</span></div>
          <div className="fx-split">
            <span><i className="is-blue" />Lead spend<b>{money(dailyTotal(b.spend))} a day</b></span>
            <span><i className="is-teal" />Tier<b>{tierNow.label}</b></span>
            <span><Check size={13} aria-hidden="true" />Covers the team, servicing, portal and app</span>
          </div>
        </>}
      </section>

      <section className="fx-tile fx-s5 pb-booked" style={{ '--i': 1 }} aria-label="Booked this week">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Booked this week</h2><p>Resets Monday</p></span><Chip tone={running ? 'green' : 'mute'}>{b.cancel ? 'Ending Nov 8' : b.paused ? 'Paused' : running ? 'Leads running' : 'Leads stopped'}</Chip></header>
        <div className="tp-row tp-wrap"><b className="tp-num fx-huge2"><CountUp value={b.booked} /></b><span className="tp-sub">booked so far</span></div>
        <BookedMeter booked={b.booked} range={wk} />
        <p className="pb-note">About {rangeWords(wk)} a week at your spend{b.take.mode === 'both' ? ` · ${rangeWords(b.expected.live.delivered)} live transfers` : ''}</p>
        {b.paused && <div className="sp-paused"><b>Paused {b.paused.until ? `until ${b.paused.until}` : 'until you resume'}</b><small>{b.paused.until ? 'It resumes by itself. We remind you 2 days before.' : 'New leads start the day after you resume.'}</small>
          <span className="tp-row tp-wrap">{b.paused.until && <button type="button" className="tp-btn ov-ghost" onClick={() => setPanel('pause')}>Extend</button>}<button type="button" className="tp-primary fx-accent" onClick={() => { resume(); note('Resumed. New leads start tomorrow') }}><PlayCircle size={15} />Resume now</button></span></div>}
        {b.cancel && <div className="sp-paused"><b>Your plan ends {b.cancel.on}</b><small>Changed your mind? Nothing stops until then.</small><button type="button" className="tp-primary fx-accent fx-self" onClick={() => { keepPlan(); note('Welcome back. Nothing changes') }}>Keep my account</button></div>}
      </section>

      <section className="fx-tile fx-s12 pb-tile" style={{ '--i': 2 }} aria-label="Your daily lead spend">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your daily lead spend</h2><p>{pilot ? 'One daily amount. You pay only this, prepaid each week.' : 'One daily amount. Your membership tier follows it.'} Every lead gets a call within seconds.</p></span></header>
        <div className="pb-grid">
          <div className="sp-col">
            <SpendSliders spend={spend} onSpend={setDraft} plan={b.plan} mode={take.mode} id="bill" openSlots={open} />
            <TakeLeads take={take} onTake={setTakeDraft} id="bill-take" />
          </div>
          <SpendSummary spend={spend} plan={b.plan} products={b.products} vaAmount={va}>
            {!pilot && tierNew.key !== tierNow.key && <p className="pb-note">That moves you to {tierNew.label}. The new tier applies from your next bill, {b.nextBill}.</p>}
            <p className="pb-note">{dirty ? 'Your new spend starts tomorrow, Tue, Nov 3 at 12:00 AM your time.' : b.pending ? b.pending.starts : 'Change it any day. A change starts at midnight.'}</p>
            <button type="button" className="tp-primary fx-accent" disabled={!dirty || !spendOk(b.plan, spend) || !takeOk(take)} onClick={save}>Save lead spend</button>
          </SpendSummary>
        </div>
      </section>

      <section className="fx-tile fx-s8 sp-bought" style={{ '--i': 3 }} aria-label="What your spend bought">
        <header className="fx-tile-h"><span className="tp-grow"><h2>What your spend bought</h2><p>Booked and transferred, then shows and sales</p></span><Seg label="Range" value={range} onChange={setRange} options={[{ key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }]} /></header>
        <BoughtTable rows={b.bought[range]} />
        {pilot && b.va.on && <p className="sp-plain">Team time on your leads and clients this week: {b.va.hours} hours at {money(b.va.rate)} an hour, at cost: <b className="tp-money">{money(va)}</b></p>}
      </section>

      <section className="fx-tile fx-s4 sp-acts" style={{ '--i': 4 }} aria-label="Your plan">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Your plan</h2><p>{money(dailyTotal(b.spend))} a day · {b.take.mode === 'both' ? `Live transfers ${liveHoursText(b.take.hours)}` : 'Appointments only'}</p></span></header>
        <ul className="tp-list">
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('pause')} disabled={!!b.cancel}><PauseCircle size={17} aria-hidden="true" /><span className="tp-grow"><b>{b.paused ? 'Change the pause' : 'Pause leads'}</b><small>Holidays, a full calendar, a break</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('talk')}><Phone size={17} aria-hidden="true" /><span className="tp-grow"><b>Talk to someone</b><small>About your spend, your plan, anything</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => note('Payment method changes are not open yet')}><CreditCard size={17} aria-hidden="true" /><span className="tp-grow"><b>Payment method</b><small>{b.payment.card}</small></span></button></li>
          <li><button type="button" className="fx-mrow" onClick={() => setPanel('cancel')} disabled={!!b.cancel}><LogOut size={17} aria-hidden="true" /><span className="tp-grow"><b>Cancel your plan</b><small>Or pause instead</small></span></button></li>
        </ul>
      </section>

      {/* P893: Results moved here from Activity: what the spend bought, the week against the usual week, policies saved */}
      <section className="pb-results" id="results" aria-label="Results">
        <h2>Results</h2>
        <Results />
      </section>

      <section className="fx-tile fx-s12 pb-hist" style={{ '--i': 6 }} aria-label="History">
        <header className="fx-tile-h"><span className="tp-grow"><h2>History</h2><p>Sample amounts. Pricing is not final.</p></span><a href="#results" className="tp-btn ov-ghost">See your results</a></header>
        <ul className="fx-rows fx-hist">{b.history.map(h => <li key={h.id} className="fx-row is-flat"><span className="fx-row-ic"><Layers size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{h.label}</b><small>{h.at}</small></span><Money v={h.amount} /></li>)}</ul>
      </section>

      <PauseDrawer open={panel === 'pause'} onClose={() => setPanel(null)} b={b} appts={appts} />
      <CancelDrawer open={panel === 'cancel'} onClose={() => setPanel(null)} b={b} onPause={() => setPanel('pause')} onTalk={() => setPanel('talk')} />
      <TalkDrawer open={panel === 'talk'} onClose={() => setPanel(null)} topic="My plan or billing" />
    </div>
  )
}
