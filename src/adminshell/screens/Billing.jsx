import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleCheck, Landmark, ArrowUpRight, CreditCard, MessageSquare, RotateCw, Wallet, Megaphone, Headset, Receipt, BadgeDollarSign, PiggyBank, Lock, Bot } from 'lucide-react'
import { useAdmMoney, useAdmAgents, useAdmActions, useAdmPeriod, useAdmDraws, useAdmSettings, useAdmSource, useAdmAgentResults, PLANS, PERIODS, SETUP_FEE, CARD_FEE, AI_RATE } from '../data'
import { PRICES } from '../../lib/priceBook.js'
import { deskAdminLabel } from '../../lib/bookingDesk'
import { RecentCharges } from './Billing933'
import { Avatar, Chip, Drawer, PillTabs, SampleTag, Seg, Switch, useNote } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile } from '../kit'
import Chart from '../../template/Chart'
import { ap } from '../paths'
import { BILL_WORD, BANK_WORD } from '../words'
import { OWNER_LIMIT } from '../p879'
import '../p879.css'
import { useAuth } from '../../hooks/useAuth'
import { invokeConnect, usePayoutAccounts, useRefreshPayouts } from '../../hooks/useFulfillmentPayouts'
import { bankText } from '../../lib/adminPayouts'

// P919: Stripe's own bank form (the old Payouts page's), loaded only when an admin opens it.
const ConnectEmbed = lazy(() => import('../../components/fulfillment/ConnectEmbeds'))

// P866 — the tab and page read Revenue (Brayden didn't like Money). P864 — Money (it was Billing & revenue): at the top, for This week / This month / Last month, what came in (what agents
// paid), what it cost (ad spend, VA payouts, card fees, tools), the profit, and the owners' split (Brayden and Jordan,
// P934: fixed at 50/50, read-only). Both admins see everything, each other's payouts too. Below it, kept:
// P849 — Billing & revenue: money in (agents' plans and lead spend, by week, each agent's bill and the failed
// payments) and money out (the Monday VA pay run: hours from clock in and out x the hourly rate, P890: no per-cancel pay;
// past runs, the Stripe balance and the pause switch). Sample amounts and prices.
const money = usd()
const money2 = usd(true)
const kMoney = n => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : money(n))

// P914 — the stage grows to fit the view: its top stays put and its bottom eases to the new height, so nothing scrolls
// inside it and the mouse wheel always scrolls the page (the old fixed-height box trapped the wheel on By week).
function Grow({ children }) {
  const inner = useRef(null)
  const [h, setH] = useState(null)
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return undefined
    const set = () => setH(el.offsetHeight)
    set()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // And after every render (a view change swaps the content in the same commit), so it never waits on the observer.
  useLayoutEffect(() => { const el = inner.current; if (el && el.offsetHeight !== h) setH(el.offsetHeight) }, [children, h])
  return <div className="adm-rev-grow" style={h == null ? undefined : { height: h }}><div ref={inner}>{children}</div></div>
}

// P914 — Agent results (was Pilot results): per agent, what they paid Ohvara, the VA and AI cost of working their leads
// and clients, card fees and what Ohvara kept. Lead spend passed to Meta is shown apart and is in no total.
function AgentResults({ period }) {
  const { data: r } = useAdmAgentResults(period)
  const src = useAdmSource()
  const t = r.total
  const ok = t.paid > 0 && t.va / t.paid <= OWNER_LIMIT
  const top = Math.max(1, ...r.rows.map(x => x.paid))
  const pct = n => `${(Math.max(0, n) / top) * 100}%`
  // P934: a bar per agent instead of the plain table. The bar is what they paid Ohvara: kept (green), then VA pay,
  // AI minutes and card fees. Lead spend passed to Meta is named apart and is in no total.
  return (
    <div className="adm-rev-view">
      <div className="adm-res-head">
        <span className="tp-grow"><b>Per agent, {PERIODS.find(x => x[0] === period)[1].toLowerCase()}</b><small>Paid = plan fee + {deskAdminLabel(PRICES.leadFee)} + setup. Kept = paid − VA − AI − card fees.</small></span>
        <Chip tone={ok ? 'green' : 'warn'}>{t.vaPct == null ? 'No revenue yet' : `VA ${t.vaPct}% of revenue · rule ${Math.round(OWNER_LIMIT * 100)}% or less`}</Chip>
        {src !== 'real' && <SampleTag>Sample</SampleTag>}
      </div>
      <div className="adm-rev-key"><span><i className="adm-rev-sw is-kept" />Ohvara kept</span><span><i className="adm-rev-sw is-va" />VA pay</span><span><i className="adm-rev-sw is-ai" />AI minutes</span><span><i className="adm-rev-sw is-fees" />Card fees</span></div>
      <ul className="adm-res-bars" aria-label="Agent results">
        {r.rows.map(x => (
          <li key={x.id}>
            <span className="adm-res-who"><Link to={ap('agents', x.id)}>{x.name}</Link><small>{x.comped ? 'Comped' : x.plan}</small></span>
            <span className="adm-res-bar" role="img" aria-label={`${x.name}: paid ${money(x.paid)}, kept ${money(x.kept)}, VA ${money(x.va)}, AI ${money(x.ai)}, card fees ${money(x.fees)}`}>
              <i className="is-kept" style={{ width: pct(x.kept) }} /><i className="is-va" style={{ width: pct(x.va) }} /><i className="is-ai" style={{ width: pct(x.ai) }} /><i className="is-fees" style={{ width: pct(x.fees) }} />
            </span>
            <span className="adm-res-n"><b className={`tp-money${x.kept < 0 ? ' is-loss' : ''}`}>{money(x.kept)}</b><small>kept of {money(x.paid)}</small></span>
            <span className="adm-res-out"><small>Lead spend</small><b className="tp-money">{money(x.leadSpend)}</b></span>
          </li>
        ))}
        <li className="is-total">
          <span className="adm-res-who"><b>All agents</b><small>{r.rows.length} agents</small></span>
          <span className="adm-res-sum"><span>VA −{money(t.va)}</span><span>AI −{money(t.ai)}</span><span>Card fees −{money(t.fees)}</span></span>
          <span className="adm-res-n"><b className={`tp-money${t.kept < 0 ? ' is-loss' : ''}`}>{money(t.kept)}</b><small>kept of {money(t.paid)}</small></span>
          <span className="adm-res-out"><small>Lead spend</small><b className="tp-money">{money(t.leadSpend)}</b></span>
        </li>
      </ul>
      <p className="adm-rev-out"><Headset size={14} aria-hidden="true" />VA pay and AI minutes are shared out by each agent's leads and clients worked until team time is recorded per agent. Lead spend is passed to Meta and is in no total.</p>
    </div>
  )
}

// P913 — By week: the one main chart. Revenue = plan fees + the 12% fee + setup fees, stacked per week. Agent lead
// spend is never in it: it's the agents' money passed to Meta, named on its own line under the chart.
function Revenue() {
  const src = useAdmSource()
  const { data: m } = useAdmMoney()
  return (
    <div className="adm-rev-view">
      <div className="fx-chart-head fx-bk-head">
        <b className="tp-money fx-bk-num"><CountUp value={m.total} format={money} /></b>
        <span className="fx-bk-side"><b>revenue this week so far</b><small>{money(m.lastWeek)} last week</small>{m.lastWeek > 0 && <i className={`fx-delta is-${m.total >= m.lastWeek ? 'up' : 'warn'}`}>{m.total >= m.lastWeek ? 'Up' : 'Behind'} {Math.abs(Math.round(((m.total - m.lastWeek) / m.lastWeek) * 100))}%</i>}</span>
      </div>
      {/* P936: the one chart (template/Chart.jsx), stacked plan fees, booking desk and setup fees, legend as chips. */}
      <Chart stacked height={240} format={kMoney} className="adm-revweeks"
        label={m.weeks.map(w => `Week of ${w.wk}: ${money(w.revenue)}`).join('. ')}
        data={m.weeks.map(w => ({ name: w.now ? 'This week' : w.wk, full: w.now ? 'This week' : `Week of ${w.wk}`, today: w.now, plans: w.plans, fee: w.fee, setup: w.setup || 0, total: w.revenue }))}
        series={[{ key: 'plans', label: 'Plan fees', color: 'var(--ox-1)' }, { key: 'fee', label: deskAdminLabel(PRICES.leadFee), color: 'var(--ox-3)' }, { key: 'setup', label: 'Setup fees', color: 'var(--ox-4)' }]}
        tip={r => [['Plan fees', money(r.plans), 'var(--ox-1)'], [deskAdminLabel(PRICES.leadFee), money(r.fee), 'var(--ox-3)'], ['Setup fees', money(r.setup), 'var(--ox-4)'], ['Total', money(r.total)]]} />
      {src !== 'real' && <div className="adm-rev-key"><SampleTag>Sample</SampleTag></div>}
      <p className="adm-rev-out"><Megaphone size={14} aria-hidden="true" />Agent lead spend (passed to Meta): <b className="tp-money">{money(m.leadSpend)}</b> this week. Not Ohvara's money, so it's in no total.</p>
    </div>
  )
}

// A dollar line in a breakdown list.
const Line = ({ icon: Icon, label, sub, n, extra, neg }) => (
  <li><Icon size={14} aria-hidden="true" /><span className="tp-grow">{label}{sub && <small>{sub}</small>}{extra}</span><b className="tp-money">{neg && n > 0 ? '−' : ''}{money(n)}</b></li>
)

// P934: the profit split is fixed at 50 / 50 and read-only for both admins. Changing it is a code and migration change.
function Split({ p }) {
  const sum = p.split.reduce((t, o) => t + o.amount, 0)
  return (
    <Tile className="adm-split" i={3} title="Profit split" sub={`${p.split.map(o => `${o.name} ${o.pct}%`).join(' · ')} · adds up to ${money(sum)}`}
      aside={<Chip tone="blue">Split 50 / 50</Chip>}>
      <ul className="tp-list adm-owners">{p.split.map(o => (
        <li key={o.id} className="adm-owner">
          <Avatar name={o.name} />
          <span className="tp-grow"><b>{o.name} · {o.pct}%</b><small>{money(o.paid)} paid out · {money(o.owed)} owed</small>
            <span className="fx-meter" role="img" aria-label={`${money(o.paid)} of ${money(Math.max(0, o.amount))} paid`}><i style={{ '--w': o.amount > 0 ? Math.min(1, o.paid / o.amount) : 0 }} /></span>
          </span>
          <b className="tp-money adm-owner-n">{money(o.amount)}</b>
        </li>
      ))}</ul>
      <p className="adm-audit-line"><Lock size={13} aria-hidden="true" />Fixed at 50 / 50 for Brayden and Jordan. It isn't a setting.</p>
    </Tile>
  )
}

// P913 — the headline numbers. P934: on the agent side's look: two coloured tiles, a big number with a small label and
// inner panels below it (agent Billing's "Your plan"). Revenue (green) = plan fees + the booking desk + setup fees;
// Profit (blue) = revenue minus costs, with the fixed 50 / 50 split. Agent lead spend is set apart (not Ohvara's money).
function Headline({ p, label }) {
  const margin = p.inTotal ? Math.round((p.profit / p.inTotal) * 100) : 0
  return (
    <div className="fx-grid adm-rev-top" role="group" aria-label="Revenue for the period">
      <section className="fx-tile is-fill is-green fx-s7 adm-rev-hero" style={{ '--i': 0 }} aria-label="Revenue">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Revenue</h2><p>{label} · what agents paid Ohvara</p></span><span className="adm-hero-ic"><BadgeDollarSign size={18} aria-hidden="true" /></span></header>
        <div className="adm-hero-big"><b className="tp-money"><CountUp value={p.inTotal} format={money} /></b><small>brought in</small></div>
        <div className="adm-inner">
          <span><small>Plan fees</small><b className="tp-money">{money(p.servicing)}</b></span>
          <span><small>{deskAdminLabel(PRICES.leadFee)}</small><b className="tp-money">{money(p.leadFee)}</b></span>
          <span><small>Setup fees</small><b className="tp-money">{money(p.setup)}</b></span>
        </div>
        <p className="adm-hero-foot"><Megaphone size={13} aria-hidden="true" />Agent lead spend (passed to Meta): <b className="tp-money">{money(p.leadSpend)}</b> · not Ohvara's money, in no total</p>
      </section>
      <section className={`fx-tile is-fill ${p.profit < 0 ? 'is-warn' : 'is-blue'} fx-s5 adm-rev-hero`} style={{ '--i': 1 }} aria-label="Profit">
        <header className="fx-tile-h"><span className="tp-grow"><h2>Profit</h2><p>{margin}% of revenue kept</p></span><span className="adm-hero-ic"><Wallet size={18} aria-hidden="true" /></span></header>
        <div className="adm-hero-big"><b className="tp-money"><CountUp value={p.profit} format={money} /></b><small>after costs</small></div>
        <div className="adm-inner is-two">
          <span><small>Costs</small><b className="tp-money">−{money(p.costTotal)}</b></span>
          <span><small>Split 50 / 50</small><b className="tp-money">{money(p.split[0].amount)}<small> each</small></b></span>
        </div>
        <p className="adm-hero-foot"><Headset size={13} aria-hidden="true" />Costs: VA pay, AI minutes and card fees</p>
      </section>
    </div>
  )
}

// P913 — the breakdown, last: where revenue came from, what it cost, the profit, and the owners' split.
function Breakdown({ p }) {
  return (
    <div className="adm-rev-break">
      <Tile i={2} title="Revenue" sub="What Ohvara earned">
        <ul className="adm-sum">
          <Line icon={BadgeDollarSign} label="Plan fees" sub="Starter, Growth, Pro and servicing only, month to month" n={p.servicing} />
          <Line icon={BadgeDollarSign} label={deskAdminLabel(PRICES.leadFee)} sub="Of lead spend: the AI calling every lead, texts, booking, reminders and the team" n={p.leadFee} />
          <Line icon={Receipt} label="Setup fees" sub={p.setupCount ? `${p.setupCount} new ${p.setupCount === 1 ? 'agent' : 'agents'} · ${money(SETUP_FEE)} each` : 'No new agents'} n={p.setup} />
          <li className="is-total"><BadgeDollarSign size={14} aria-hidden="true" /><span className="tp-grow">Revenue</span><b className="tp-money">{money(p.inTotal)}</b></li>
        </ul>
      </Tile>
      <Tile i={3} title="Costs and profit" sub="Revenue minus VA pay, AI minutes and card fees">
        <ul className="adm-sum">
          <Line icon={Headset} label="VA pay" sub={p.runs.length ? `${p.runs.length} pay ${p.runs.length === 1 ? 'run' : 'runs'} paid` : 'No run paid yet'} n={p.vaPay} neg />
          <Line icon={Bot} label="AI minutes" sub={p.aiMins ? `${p.aiMins} minutes at about ${money2(AI_RATE)} a minute` : 'From the AI caller once it is live'} n={p.ai} neg />
          <Line icon={CreditCard} label="Card fees" sub={`About ${Math.round(CARD_FEE * 100)}% of everything charged`} n={p.fees} neg />
          <li className="is-total"><Wallet size={14} aria-hidden="true" /><span className="tp-grow">Profit</span><b className="tp-money">{money(p.profit)}</b></li>
        </ul>
      </Tile>
      <Split p={p} />
    </div>
  )
}

function AgentBills() {
  const { data: agents } = useAdmAgents()
  const { data: m } = useAdmMoney()
  const { data: st } = useAdmSettings()
  const { setMaxDaily } = useAdmActions()
  const note = useNote()
  const max = id => st.billing.maxOverride[id] ?? st.billing.maxDaily
  return (
    <div className="adm-stack">
      {m.failed.length > 0 && (
        <Tile className="is-fill is-warn" i={0} title="Failed payments" sub={`${m.failed.length} to follow up`}>
          <ul className="tp-list">{m.failed.map(f => (
            <li key={f.agent_id} className="fx-mrow"><CreditCard size={17} aria-hidden="true" /><span className="tp-grow"><b>{f.agent} · {money(f.amount)}</b><small>{f.what} · {f.why} {f.when}{f.status === 'past_due' ? ' · locks after 48 hours' : ''}</small></span>
              <Link to={`${ap('messages')}?to=${f.agent_id}`} className="fx-pillbtn"><MessageSquare size={13} />Message</Link>
              <button type="button" className="fx-pillbtn" onClick={() => note('Retry runs at Stripe once billing is live (sample)')}><RotateCw size={13} />Retry</button>
            </li>
          ))}</ul>
        </Tile>
      )}
      <section className="fx-tile adm-table adm-bills" style={{ '--i': 1 }} aria-label="Agent bills">
        <div className="adm-tr adm-th" aria-hidden="true"><span>Agent</span><span>Plan</span><span>Lead spend</span><span>Status</span><span>Next</span></div>
        {agents.map((a, i) => {
          const [word, tone] = BILL_WORD[a.billing.status]
          return (
            <div key={a.id} className="adm-tr" style={{ '--i': i }}>
              <Link to={ap('agents', a.id)} className="adm-who"><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.billing.method}</small></span></Link>
              <span className="adm-cell"><b>{PLANS[a.plan].label}</b><small>{money(PLANS[a.plan].price)} a month</small></span>
              <span className="adm-cell"><b className="tp-money">{money(a.spend)} a day</b>
                <small>Max {money(max(a.id))}{st.billing.maxOverride[a.id] ? ' (raised)' : ''}{' '}
                  <button type="button" className="fx-pillbtn" onClick={() => {
                    if (st.billing.maxOverride[a.id]) { setMaxDaily(a.id, null); note(`${a.name}: back to ${money(st.billing.maxDaily)} a day`) }
                    else { setMaxDaily(a.id, 750); note(`${a.name} can spend up to ${money(750)} a day (sample)`) }
                  }}>{st.billing.maxOverride[a.id] ? 'Reset' : 'Raise'}</button></small></span>
              <span className="adm-cell"><Chip tone={tone}>{word}</Chip></span>
              <span className="adm-cell"><small>{a.billing.next}</small></span>
            </div>
          )
        })}
      </section>
    </div>
  )
}

// Brayden and Jordan as payees: every draw, newest first. Both admins see both.
function OwnerPayouts() {
  const { data: owners } = useAdmDraws()
  return (
    <Tile i={4} title="Owner payouts" sub="Brayden and Jordan, from the profit split">
      <ul className="tp-list adm-rows">{owners.flatMap(o => o.draws.map(d => ({ ...d, name: o.name }))).map(d => (
        <li key={d.id} className="fx-mrow"><Avatar name={d.name} /><span className="tp-grow"><b>{d.name}</b><small>Paid {d.paid} · October profit</small></span><Chip tone="green">Paid</Chip><b className="tp-money">{money(d.amount)}</b></li>
      ))}</ul>
      <ul className="adm-sum adm-owner-sum">{owners.map(o => <li key={o.id}><PiggyBank size={14} aria-hidden="true" /><span className="tp-grow">{o.name}<small>Paid out since the start</small></span><b className="tp-money">{money(o.total)}</b></li>)}</ul>
    </Tile>
  )
}

// P919: the admin's own payout bank on real data (Stripe Connect, the same form and refresh the old Payouts page used).
// With the old admin pages gone, this is where an owner connects or changes the bank their payouts go to.
function RealBank() {
  const { profile } = useAuth()
  const accounts = usePayoutAccounts(null)
  const refresh = useRefreshPayouts()
  const [open, setOpen] = useState(false)
  const mine = (accounts.data || []).find(a => a.rep_id === profile?.id) || null
  const bank = bankText(mine)
  const close = () => { setOpen(false); invokeConnect('overview').catch(() => {}).finally(refresh) }
  return (
    <li><Landmark size={14} aria-hidden="true" /><span className="tp-grow">Your bank<small>{accounts.isLoading ? 'Loading…' : accounts.error ? "Couldn't load" : bank || 'Not connected yet'}</small></span>
      <button type="button" className="fx-pillbtn" onClick={() => setOpen(true)}>{bank ? 'Change' : 'Connect'}</button>
      <Drawer open={open} onClose={close} center title={bank ? 'Change your bank' : 'Connect your bank'} sub="Stripe's own secure form. Bank numbers go straight to Stripe, never through Ohvara.">
        {open && <Suspense fallback={<p className="tp-sub">Loading…</p>}><ConnectEmbed kind={mine?.details_submitted ? 'bank' : 'onboarding'} onDone={close} /></Suspense>}
      </Drawer>
    </li>
  )
}

function Payouts() {
  const src = useAdmSource()
  const { data: m } = useAdmMoney()
  const { setPaused } = useAdmActions()
  const note = useNote()
  return (
    <div className="fx-ovl">
      <div className="fx-ovl-main">
        <Tile i={2} title="Who is in Monday's run" sub={`${m.payday} · hours from clock in and out · ${money(m.rate)} an hour`}>
          <ul className="tp-list adm-rows">{m.run.map(r => {
            const [bw, bt] = BANK_WORD[r.bank]
            return <li key={r.va_id} className="fx-mrow"><Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small>{r.hours} hours</small></span><Chip tone={bt}>{bw}</Chip><b className="tp-money">{r.bank === 'ready' ? money(r.amount) : '–'}</b></li>
          })}</ul>
        </Tile>
        <Tile i={3} title="Past pay runs" sub={`${money(m.runs.reduce((t, r) => t + r.amount, 0))} paid since the first run`}>
          <ul className="tp-list adm-rows">{m.runs.map(r => <li key={r.id} className="fx-mrow"><CircleCheck size={17} aria-hidden="true" className="adm-ok" /><span className="tp-grow"><b>{r.week}</b><small>{r.people} people · paid {r.paid}</small></span><Chip tone="green">Paid</Chip><b className="tp-money">{money(r.amount)}</b></li>)}</ul>
        </Tile>
        <OwnerPayouts />
      </div>
      <div className="fx-ovl-side adm-side">
        <Tile className="is-fill is-green" i={0} title="Next pay run" sub={`${m.payday}, ${m.paused ? 'paused' : 'automatically'}`}>
          <b className="fx-huge tp-money"><CountUp value={m.runTotal} format={money} /></b>
          <small>{m.live ? 'Sends real money' : 'Not live yet: payouts send no money until the switch is on in Settings'}</small>
          <div className="fx-form-row fx-form-sw"><div className="tp-grow"><b>Automatic payouts</b><small>{m.paused ? 'Paused: Monday runs are skipped' : 'On: runs every Monday'}</small></div>
            <Switch on={!m.paused} label="Automatic payouts" onChange={v => { setPaused(!v); note(v ? 'Payouts resumed' : 'Payouts paused') }} /></div>
        </Tile>
        <Tile i={1} title="Stripe" sub="Where pay comes from">
          <ul className="adm-sum">
            <li><Wallet size={14} aria-hidden="true" /><span className="tp-grow">Balance<small>{m.stripeBalance >= m.runTotal ? "Covers Monday's run" : "Short for Monday's run"}</small></span><b className="tp-money">{money(m.stripeBalance)}</b></li>
            {src === 'real' ? <RealBank /> : <li><Landmark size={14} aria-hidden="true" /><span className="tp-grow">Your bank<small>Chase •••• 7781</small></span><button type="button" className="fx-pillbtn" onClick={() => note("Opens Stripe's form once you sign in for real")}>Change</button></li>}
            <li><CircleCheck size={14} aria-hidden="true" /><span className="tp-grow">Hourly rate<small>Overtime past 40 hours at 1.5×</small></span><Link to={`${ap('settings')}?tab=pay`} className="fx-pillbtn">{money(m.rate)}<ArrowUpRight size={13} /></Link></li>
          </ul>
        </Tile>
      </div>
    </div>
  )
}

// P913 — one page, top to bottom: the period, the headline numbers, one stage that holds the main chart (By week) or
// another view (Agent results, Agent billing, Payouts), then the breakdown. P914: the stage's top stays put and it grows
// to fit the view (Grow), so nothing scrolls inside it.
const VIEWS = [['revenue', 'By week'], ['results', 'Agent results'], ['agents', 'Agent billing'], ['charges', 'Charges'], ['payouts', 'Payouts']]
export default function Billing() {
  const [sp, setSp] = useSearchParams()
  const { data: m } = useAdmMoney()
  const src = useAdmSource()
  const raw = sp.get('tab')
  const tab = VIEWS.some(t => t[0] === raw) ? raw : 'revenue'
  const rawP = sp.get('period')
  const period = PERIODS.some(x => x[0] === rawP) ? rawP : 'week'
  const { data: p } = useAdmPeriod(period)
  const span = PERIODS.find(x => x[0] === period)
  const put = (k, v, dflt) => { const next = new URLSearchParams(sp); if (v === dflt) next.delete(k); else next.set(k, v); setSp(next, { replace: true }) }
  return (
    <div className="tp-page fx-page adm-billing adm-rev">
      <div className="adm-money-bar">
        <Seg label="Period" value={period} onChange={v => put('period', v, 'week')} options={PERIODS.map(([k, label]) => ({ key: k, label }))} />
        <small className="tp-sub">{span[2]} · {src === 'real' ? 'from billing' : 'sample numbers'}</small>
      </div>
      <Headline p={p} label={span[1]} />
      <section className="fx-tile adm-rev-stage" style={{ '--i': 1 }} aria-label="Revenue views">
        <PillTabs label="Revenue details" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={t => put('tab', t, 'revenue')}
          items={VIEWS.map(([k, label]) => ({ key: k, label, count: k === 'agents' && m.failed.length ? m.failed.length : undefined }))} />
        <Grow>
          <div className="adm-rev-body" key={tab} role="tabpanel">
            {tab === 'revenue' && <Revenue />}
            {tab === 'results' && <AgentResults period={period} />}
            {tab === 'agents' && <AgentBills />}
            {tab === 'charges' && <RecentCharges />}
            {tab === 'payouts' && <Payouts />}
          </div>
        </Grow>
      </section>
      <Breakdown p={p} />
    </div>
  )
}
