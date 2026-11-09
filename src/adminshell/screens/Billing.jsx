import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleCheck, Landmark, ArrowUpRight, CreditCard, MessageSquare, RotateCw, Wallet, Megaphone, Headset, Receipt, BadgeDollarSign, PiggyBank, Pencil, History, Bot } from 'lucide-react'
import { useAdmMoney, useAdmAgents, useAdmActions, useAdmPeriod, useAdmDraws, useAdmSettings, useAdmSource, useAdmAgentResults, PLANS, PERIODS, SETUP_FEE, CARD_FEE, AI_RATE } from '../data'
import { PRICES } from '../../lib/priceBook.js'
import { Avatar, Chip, PillTabs, SampleTag, Seg, Switch, useNote } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile } from '../kit'
import { ap } from '../paths'
import { BILL_WORD, BANK_WORD } from '../words'
import { OWNER_LIMIT } from '../p879'
import '../p879.css'

// P866 — the tab and page read Revenue (Brayden didn't like Money). P864 — Money (it was Billing & revenue): at the top, for This week / This month / Last month, what came in (what agents
// paid), what it cost (ad spend, VA payouts, card fees, tools), the profit, and the owners' split (Brayden and Jordan,
// 50/50 by default, a setting with an audit line). Both admins see everything, each other's payouts too. Below it, kept:
// P849 — Billing & revenue: money in (agents' plans and lead spend, by week, each agent's bill and the failed
// payments) and money out (the Monday VA pay run: hours from clock in and out x the hourly rate, P890: no per-cancel pay;
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
  return (
    <div className="adm-rev-view">
      <div className="adm-res-head">
        <span className="tp-grow"><b>Per agent, {PERIODS.find(x => x[0] === period)[1].toLowerCase()}</b><small>Paid = plan fee + {Math.round(PRICES.leadFee * 100)}% of lead spend + setup. Kept = paid − VA − AI − card fees.</small></span>
        <Chip tone={ok ? 'green' : 'warn'}>{t.vaPct == null ? 'No revenue yet' : `VA ${t.vaPct}% of revenue · rule ${Math.round(OWNER_LIMIT * 100)}% or less`}</Chip>
        {src !== 'real' && <SampleTag>Sample</SampleTag>}
      </div>
      <div className="p879-scroll" role="region" aria-label="Agent results" tabIndex={0}>
        <table className="p879-tbl adm-res-tbl">
          <thead><tr>{['Agent', 'Paid Ohvara', 'VA cost', 'AI cost', 'Card fees', 'Ohvara kept', 'Lead spend (to Meta)'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
          <tbody>{r.rows.map(x => (
            <tr key={x.id}>
              <th scope="row"><Link to={ap('agents', x.id)}>{x.name}</Link><small>{x.comped ? 'Comped' : x.plan}</small></th>
              <td>{money(x.paid)}</td><td>{x.va ? `−${money(x.va)}` : money(0)}</td><td>{x.ai ? `−${money(x.ai)}` : money(0)}</td><td>{x.fees ? `−${money(x.fees)}` : money(0)}</td>
              <td className={x.kept < 0 ? 'is-loss' : 'is-kept'}>{money(x.kept)}</td><td className="is-out">{money(x.leadSpend)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><th scope="row">All agents</th><td>{money(t.paid)}</td><td>−{money(t.va)}</td><td>−{money(t.ai)}</td><td>−{money(t.fees)}</td><td className={t.kept < 0 ? 'is-loss' : 'is-kept'}>{money(t.kept)}</td><td className="is-out">{money(t.leadSpend)}</td></tr></tfoot>
        </table>
      </div>
      <p className="adm-rev-out"><Headset size={14} aria-hidden="true" />VA pay and AI minutes are shared out by each agent's leads and clients worked until team time is recorded per agent.</p>
    </div>
  )
}

// P913 — By week: the one main chart. Revenue = plan fees + the 12% fee + setup fees, stacked per week. Agent lead
// spend is never in it: it's the agents' money passed to Meta, named on its own line under the chart.
function Revenue() {
  const src = useAdmSource()
  const { data: m } = useAdmMoney()
  const top = Math.max(1, ...m.weeks.map(w => w.revenue))
  const pct = n => `${Math.round(n * 100)}%`
  return (
    <div className="adm-rev-view">
      <div className="fx-chart-head fx-bk-head">
        <b className="tp-money fx-bk-num"><CountUp value={m.total} format={money} /></b>
        <span className="fx-bk-side"><b>revenue this week so far</b><small>{money(m.lastWeek)} last week</small>{m.lastWeek > 0 && <i className={`fx-delta is-${m.total >= m.lastWeek ? 'up' : 'warn'}`}>{m.total >= m.lastWeek ? 'Up' : 'Behind'} {Math.abs(Math.round(((m.total - m.lastWeek) / m.lastWeek) * 100))}%</i>}</span>
      </div>
      <div className="adm-rev-key"><span><i className="is-plans adm-rev-sw" />Plan fees</span><span><i className="is-fee adm-rev-sw" />{pct(PRICES.leadFee)} fee</span><span><i className="is-setup adm-rev-sw" />Setup fees</span>{src !== 'real' && <SampleTag>Sample</SampleTag>}</div>
      <ol className="adm-rev-chart" style={{ '--n': m.weeks.length }} role="img" aria-label={m.weeks.map(w => `Week of ${w.wk}: ${money(w.revenue)}`).join('. ')}>
        {m.weeks.map(w => (
          <li key={w.wk} className={w.now ? 'is-now' : ''}>
            <b>{money(w.revenue)}</b>
            <span className="adm-wg-bar" aria-hidden="true">
              <i className="is-plans" style={{ height: `${(w.plans / top) * 100}%` }} />
              <i className="is-fee" style={{ bottom: `${(w.plans / top) * 100}%`, height: `${(w.fee / top) * 100}%` }} />
              <i className="is-setup" style={{ bottom: `${((w.plans + w.fee) / top) * 100}%`, height: `${((w.setup || 0) / top) * 100}%` }} />
            </span>
            <small>{w.now ? 'This week' : w.wk}</small>
          </li>
        ))}
      </ol>
      <p className="adm-rev-out"><Megaphone size={14} aria-hidden="true" />Agent lead spend (passed to Meta): <b className="tp-money">{money(m.leadSpend)}</b> this week. Not Ohvara's money, so it's in no total.</p>
    </div>
  )
}

// A dollar line in a breakdown list.
const Line = ({ icon: Icon, label, sub, n, extra, neg }) => (
  <li><Icon size={14} aria-hidden="true" /><span className="tp-grow">{label}{sub && <small>{sub}</small>}{extra}</span><b className="tp-money">{neg && n > 0 ? '−' : ''}{money(n)}</b></li>
)

function Split({ p }) {
  const { setSplit } = useAdmActions()
  const note = useNote()
  const [edit, setEdit] = useState(false)
  const [b, setB] = useState(p.split[0].pct)
  const valid = Number.isFinite(b) && b >= 0 && b <= 100
  const save = () => { setSplit(b); setEdit(false); note(`Split saved: Brayden ${b}% · Jordan ${100 - b}%`) }
  const sum = p.split.reduce((t, o) => t + o.amount, 0)
  return (
    <Tile className="adm-split" i={3} title="Profit split" sub={`${p.split.map(o => `${o.name} ${o.pct}%`).join(' · ')} · adds up to ${money(sum)}`}
      aside={!edit && <button type="button" className="fx-pillbtn" onClick={() => { setB(p.split[0].pct); setEdit(true) }}><Pencil size={13} />Change split</button>}>
      {edit && (
        <div className="adm-split-edit">
          <label className="tp-field"><span>Brayden's share (%)</span><input className="tp-num" inputMode="numeric" value={Number.isFinite(b) ? b : ''} aria-invalid={!valid} onChange={e => setB(e.target.value === '' ? NaN : Number(e.target.value.replace(/[^0-9]/g, '')))} /></label>
          <p className="tp-sub">Jordan gets the rest: <b className="tp-num">{valid ? 100 - b : '–'}%</b></p>
          <footer className="fx-form-f"><button type="button" className="tp-btn ov-ghost" onClick={() => setEdit(false)}>Cancel</button><button type="button" className="tp-primary fx-accent" disabled={!valid || b === p.split[0].pct} onClick={save}>Save split</button></footer>
        </div>
      )}
      <ul className="tp-list adm-owners">{p.split.map(o => (
        <li key={o.id} className="adm-owner">
          <Avatar name={o.name} />
          <span className="tp-grow"><b>{o.name} · {o.pct}%</b><small>{money(o.paid)} paid out · {money(o.owed)} owed</small>
            <span className="fx-meter" role="img" aria-label={`${money(o.paid)} of ${money(Math.max(0, o.amount))} paid`}><i style={{ '--w': o.amount > 0 ? Math.min(1, o.paid / o.amount) : 0 }} /></span>
          </span>
          <b className="tp-money adm-owner-n">{money(o.amount)}</b>
        </li>
      ))}</ul>
      <p className="adm-audit-line"><History size={13} aria-hidden="true" />{p.splitChanged ? `Changed by ${p.splitChanged.who}, ${p.splitChanged.at}. In the audit log.` : '50/50 since the start. Any change goes in the audit log.'}</p>
    </Tile>
  )
}

// P913 — the headline numbers: Revenue, Costs, Profit, and Agent lead spend set apart (passed to Meta, not ours).
function Headline({ p }) {
  const margin = p.inTotal ? Math.round((p.profit / p.inTotal) * 100) : 0
  return (
    <div className="adm-rev-head" role="group" aria-label="Revenue for the period">
      <div className="is-main"><small>Revenue</small><b><CountUp value={p.inTotal} format={money} /></b><em>Plan fees + {Math.round(PRICES.leadFee * 100)}% fee + setup fees</em></div>
      <div><small>Costs</small><b>{money(p.costTotal)}</b><em>VA pay, AI minutes, card fees</em></div>
      <div className={p.profit < 0 ? 'is-loss' : ''}><small>Profit</small><b><CountUp value={p.profit} format={money} /></b><em>{margin}% of revenue kept</em></div>
      <div className="is-out"><small>Agent lead spend (passed to Meta)</small><b>{money(p.leadSpend)}</b><em>Not Ohvara's money · in no total</em></div>
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
          <Line icon={BadgeDollarSign} label={`${Math.round(PRICES.leadFee * 100)}% fee on lead spend`} sub="Covers the AI calls and the team working every lead" n={p.leadFee} />
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
      <Split p={p} key={p.split[0].pct} />
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

function Payouts() {
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
            <li><Landmark size={14} aria-hidden="true" /><span className="tp-grow">Your bank<small>Chase •••• 7781</small></span><button type="button" className="fx-pillbtn" onClick={() => note("Opens Stripe's form once you sign in for real")}>Change</button></li>
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
const VIEWS = [['revenue', 'By week'], ['results', 'Agent results'], ['agents', 'Agent billing'], ['payouts', 'Payouts']]
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
      <Headline p={p} />
      <section className="fx-tile adm-rev-stage" style={{ '--i': 1 }} aria-label="Revenue views">
        <PillTabs label="Revenue details" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={t => put('tab', t, 'revenue')}
          items={VIEWS.map(([k, label]) => ({ key: k, label, count: k === 'agents' && m.failed.length ? m.failed.length : undefined }))} />
        <Grow>
          <div className="adm-rev-body" key={tab} role="tabpanel">
            {tab === 'revenue' && <Revenue />}
            {tab === 'results' && <AgentResults period={period} />}
            {tab === 'agents' && <AgentBills />}
            {tab === 'payouts' && <Payouts />}
          </div>
        </Grow>
      </section>
      <Breakdown p={p} />
    </div>
  )
}
