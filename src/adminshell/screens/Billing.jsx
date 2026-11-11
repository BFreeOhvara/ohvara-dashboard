import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, ChevronUp, CircleCheck, Landmark, ArrowUpRight, CreditCard, MessageSquare, RotateCw, Wallet, Megaphone, Headset, Receipt, BadgeDollarSign, PiggyBank, Lock, Bot } from 'lucide-react'
import { useAdmMoney, useAdmAgents, useAdmActions, useAdmPeriod, useAdmDraws, useAdmSettings, useAdmSource, useAdmAgentResults, useAdmRevTrend, ownerOf, OWNERS, PLANS, PERIODS, SETUP_FEE, CARD_FEE, AI_RATE } from '../data'
import { PRICES } from '../../lib/priceBook.js'
import { deskAdminLabel } from '../../lib/bookingDesk'
import { RecentCharges } from './Billing933'
import { Avatar, Chip, Drawer, PillTabs, SampleTag, Seg, Switch, useNote } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile } from '../kit'
import RevenueStock from '../RevenueStock'
import ProductSplit from '../ProductSplit'
import { ap } from '../paths'
import { BILL_WORD, BANK_WORD } from '../words'
import { OWNER_LIMIT } from '../p879'
import { planLineOf, planPriceOf } from '../products955'
import '../p879.css'
import '../p964.css'
import { useAuth } from '../../hooks/useAuth'
import { invokeConnect, usePayoutAccounts, useRefreshPayouts } from '../../hooks/useFulfillmentPayouts'
import { bankText } from '../../lib/adminPayouts'

// P919: Stripe's own bank form (the old Payouts page's), loaded only when an admin opens it.
const ConnectEmbed = lazy(() => import('../../components/fulfillment/ConnectEmbeds'))

// P866 — the tab and page read Revenue (Brayden didn't like Money). P864 — Money (it was Billing & revenue): at the top, for This week / This month / Last month, what came in (what agents
// paid), what it cost (ad spend, VA payouts, card fees, tools), the profit, and the owners' split (Brayden and Jordan,
// P934: fixed at 50/50, read-only). Both admins see everything, each other's payouts too. Below it, kept:
// P849 — Billing & revenue: money in (agents' plans and lead spend, by week, each agent's bill and the failed
// payments) and money out (the Monday VA pay run: scheduled hours minus days off x the hourly rate, P890: no per-cancel pay;
// past runs, the Stripe balance and the pause switch). Sample amounts and prices.
const money = usd()
const money2 = usd(true)

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

// P913 — By week: the one main chart. P943: a stock-style line (RevenueStock): rolling 7-day revenue, what was kept
// after costs, the gap between them is costs. Agent lead spend is never in it: it's the agents' money passed to Meta,
// named on its own line under the chart.
function Revenue() {
  const src = useAdmSource()
  const { data: m } = useAdmMoney()
  const { data: t } = useAdmRevTrend()
  return (
    <div className="adm-rev-view">
      <RevenueStock roll={t.roll} />
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
    <Tile className="adm-split" i={1} title="Profit split" sub={`${p.split.map(o => `${o.name} ${o.pct}%`).join(' · ')} · adds up to ${money(sum)}`}
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
// P955: plus the split by product (Leads · Servicing · Reactivation · Setup) beside where revenue came from.
function Breakdown({ p, period }) {
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
      <ProductSplit period={period} i={3} />
      <Tile i={3} title="Costs and profit" sub="Revenue minus VA pay, AI minutes and card fees">
        <ul className="adm-sum">
          <Line icon={Headset} label="VA pay" sub={p.runs.length ? `${p.runs.length} pay ${p.runs.length === 1 ? 'run' : 'runs'} paid` : 'No run paid yet'} n={p.vaPay} neg />
          <Line icon={Bot} label="AI minutes" sub={p.aiMins ? `${p.aiMins} minutes at about ${money2(AI_RATE)} a minute` : 'From the AI caller once it is live'} n={p.ai} neg />
          <Line icon={CreditCard} label="Card fees" sub={`About ${Math.round(CARD_FEE * 100)}% of everything charged`} n={p.fees} neg />
          <li className="is-total"><Wallet size={14} aria-hidden="true" /><span className="tp-grow">Profit</span><b className="tp-money">{money(p.profit)}</b></li>
        </ul>
      </Tile>
    </div>
  )
}

// P964: the cap's stepper moves in $50 steps. It can't go below what the agent spends a day now.
const CAP_STEP = 50
function UndoToast({ toast, onGone }) {
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(onGone, 6000)
    return () => clearTimeout(t)
  }, [toast, onGone])
  if (!toast) return null
  return createPortal(
    <div className="tp tp-note-toast adm-undo-toast" role="status" key={toast.k}>
      <Check size={16} aria-hidden="true" />{toast.text}
      <span aria-hidden="true">·</span>
      <button type="button" className="adm-undo" onClick={() => { toast.undo(); onGone() }}>Undo</button>
    </div>, document.body)
}

function AgentBills() {
  const { data: agents } = useAdmAgents()
  const { data: m } = useAdmMoney()
  const { data: st } = useAdmSettings()
  const { setMaxDaily } = useAdmActions()
  const real = useAdmSource() === 'real'
  const note = useNote()
  const [toast, setToast] = useState(null)
  const toasts = useRef(0)
  const clearToast = () => setToast(null)
  const base = st.billing.maxDaily
  const max = id => st.billing.maxOverride[id] ?? base
  const set = (a, value, word) => {
    const before = st.billing.maxOverride[a.id] ?? null
    setMaxDaily(a.id, value)
    if (real) return // real data: the setter says on its own whether it is wired yet
    setToast({ k: ++toasts.current, text: `Max ${word} to ${money(value ?? base)}`, undo: () => setMaxDaily(a.id, before) })
  }
  const step = (a, dir) => {
    const next = max(a.id) + dir * CAP_STEP
    if (next < a.spend) return
    set(a, next === base ? null : next, dir > 0 ? 'raised' : 'lowered')
  }
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
      {/* P964: columns Agent · Plan · Status · Next · Lead spend (last). The cap is a small stepper at the end of the Lead spend cell. */}
      <section className="fx-tile adm-table adm-bills" style={{ '--i': 1 }} aria-label="Agent bills">
        <div className="adm-tr adm-th" aria-hidden="true"><span>Agent</span><span>Plan</span><span>Status</span><span>Next</span><span>Lead spend</span></div>
        {agents.map((a, i) => {
          const [word, tone] = BILL_WORD[a.billing.status]
          const cap = max(a.id)
          const custom = st.billing.maxOverride[a.id] != null
          const first = a.name.split(' ')[0]
          const floor = `Can't go below ${money(a.spend)}, what ${first} spends a day now`
          const canDown = cap - CAP_STEP >= a.spend
          return (
            <div key={a.id} className="adm-tr" style={{ '--i': i }}>
              <Link to={ap('agents', a.id)} className="adm-who"><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.billing.method}</small></span></Link>
              <span className="adm-cell"><b>{planLineOf(a, PLANS).label}</b><small>{planPriceOf(a, PLANS) ? `${money(planPriceOf(a, PLANS))} a month` : 'Pays per list'}</small></span>
              <span className="adm-cell"><Chip tone={tone}>{word}</Chip></span>
              <span className="adm-cell"><small>{a.billing.next}</small></span>
              <span className="adm-cell adm-spendcell">
                <span className="adm-spend-txt"><b className="tp-money">{money(a.spend)} a day</b><small>· Max {money(cap)}</small></span>
                <span className="adm-capstep" role="group" aria-label={`Max daily lead spend for ${a.name}`}>
                  <button type="button" aria-label={`Raise ${a.name}'s max by ${money(CAP_STEP)}`} onClick={() => step(a, 1)}><ChevronUp size={13} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Lower ${a.name}'s max by ${money(CAP_STEP)}`} aria-disabled={!canDown} title={canDown ? undefined : floor} className={canDown ? undefined : 'is-off'} onClick={() => step(a, -1)}><ChevronDown size={13} aria-hidden="true" /></button>
                </span>
                {custom && <button type="button" className="adm-reset" aria-disabled={base < a.spend} title={base < a.spend ? floor : undefined} onClick={() => { if (base >= a.spend) set(a, null, 'reset') }}>Reset</button>}
              </span>
            </div>
          )
        })}
      </section>
      <UndoToast toast={toast} onGone={clearToast} />
    </div>
  )
}

// P945 — Your payouts: each admin sees only their own. Connect the bank their share goes to through Stripe Connect
// Express (Stripe's own form holds the bank details and identity checks; Ohvara stores nothing), the next payout (their
// 50% of this week's profit, in Monday's pay run) and their payout history. Nothing is paid until Ohvara turns on
// Owner payouts with Brayden's yes (P950: no switch in the portal).
function YourPayouts() {
  const src = useAdmSource()
  const { profile } = useAuth()
  const { data: owners } = useAdmDraws()
  const { data: week } = useAdmPeriod('week')
  const { data: m } = useAdmMoney()
  const { data: settings } = useAdmSettings()
  const note = useNote()
  // Sample: you see Brayden's side (the sample admin isn't an owner); real: the owner whose first name you sign in with.
  const me = ownerOf(profile?.full_name) || (src === 'real' ? null : OWNERS[0])
  const live = !!settings.switches?.owner_payouts_live
  if (!me) {
    return (
      <Tile i={4} title="Your payouts" sub="For the owners">
        <p className="fx-calm">Only the owners (Brayden and Jordan) are paid from the profit. Your login isn&apos;t one of them.</p>
      </Tile>
    )
  }
  const mine = owners.find(o => o.id === me.id) || { draws: [], total: 0 }
  const share = week.split.find(o => o.id === me.id)
  const next = Math.max(0, share?.amount || 0)
  return (
    <Tile i={4} className="adm-yourpay" title="Your payouts" sub={`${me.name} · ${share?.pct ?? 50}% of the profit, in the Monday pay run`} aside={src !== 'real' ? <SampleTag>Sample</SampleTag> : null}>
      <div className="adm-yp-top">
        <div className="adm-yp-next">
          <small>Next payout · {m.payday}</small>
          <b className="fx-huge tp-money"><CountUp value={next} format={money} /></b>
          <small>{share ? `Half of this week's ${money(week.profit)} profit` : 'Nothing kept this week yet'}</small>
        </div>
        <ul className="adm-sum adm-yp-bank">
          {src === 'real'
            ? <RealBank />
            : <li><Landmark size={14} aria-hidden="true" /><span className="tp-grow">Your bank<small>Chase •••• 7781 · through Stripe</small></span><button type="button" className="fx-pillbtn" onClick={() => note("Opens Stripe's own form (test mode) once you sign in for real")}>Change</button></li>}
          <li><Lock size={14} aria-hidden="true" /><span className="tp-grow">Owner payouts<small>{live ? 'On: paid in every Monday run' : 'Off: nothing is paid until Ohvara turns it on with Brayden’s yes'}</small></span>
            <Chip tone={live ? 'green' : 'mute'}>{live ? 'On' : 'Off'}</Chip></li>
        </ul>
      </div>
      <h3 className="fx-h3 adm-yp-h">Your payout history</h3>
      <ul className="tp-list adm-rows">{mine.draws.map(d => (
        <li key={d.id} className="fx-mrow"><PiggyBank size={17} aria-hidden="true" className="adm-ok" /><span className="tp-grow"><b>{d.paid}</b><small>{d.period === 'last' ? 'October profit' : 'This month'}</small></span><Chip tone="green">Paid</Chip><b className="tp-money">{money(d.amount)}</b></li>
      ))}{mine.draws.length === 0 && <li className="tp-sub">No payouts yet.</li>}</ul>
      <ul className="adm-sum adm-owner-sum"><li><PiggyBank size={14} aria-hidden="true" /><span className="tp-grow">Paid to you<small>Since the start</small></span><b className="tp-money">{money(mine.total)}</b></li></ul>
    </Tile>
  )
}

// P919: the admin's own payout bank on real data (Stripe Connect Express, the same form and refresh the old Payouts
// page used). P945: it sits in Your payouts; this is where an owner connects or changes the bank their share goes to.
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
  const { data: m } = useAdmMoney()
  const { setPaused } = useAdmActions()
  const note = useNote()
  return (
    <div className="fx-ovl">
      <div className="fx-ovl-main">
        <Tile i={2} title="Who is in Monday's run" sub={`${m.payday} · scheduled hours minus days off · ${money(m.rate)} an hour`}>
          <ul className="tp-list adm-rows">{m.run.map(r => {
            const [bw, bt] = BANK_WORD[r.bank]
            return <li key={r.va_id} className="fx-mrow"><Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small>{r.hours} hours</small></span><Chip tone={bt}>{bw}</Chip><b className="tp-money">{r.bank === 'ready' ? money(r.amount) : '–'}</b></li>
          })}</ul>
        </Tile>
        <Tile i={3} title="Past pay runs" sub={`${money(m.runs.reduce((t, r) => t + r.amount, 0))} paid since the first run`}>
          <ul className="tp-list adm-rows">{m.runs.map(r => <li key={r.id} className="fx-mrow"><CircleCheck size={17} aria-hidden="true" className="adm-ok" /><span className="tp-grow"><b>{r.week}</b><small>{r.people} people · paid {r.paid}</small></span><Chip tone="green">Paid</Chip><b className="tp-money">{money(r.amount)}</b></li>)}</ul>
        </Tile>
        <YourPayouts />
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
            <li><CircleCheck size={14} aria-hidden="true" /><span className="tp-grow">Hourly rate<small>On each VA's scheduled hours, minus days off</small></span><Link to={`${ap('settings')}?tab=pay`} className="fx-pillbtn">{money(m.rate)}<ArrowUpRight size={13} /></Link></li>
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
      {/* P964: the profit split sits right under the revenue numbers, above the By week / Agent results box. */}
      <Split p={p} />
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
      <Breakdown p={p} period={period} />
    </div>
  )
}
