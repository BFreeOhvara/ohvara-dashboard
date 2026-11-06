import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Play, Pause, CircleCheck, Landmark, ArrowUpRight, CreditCard, MessageSquare, RotateCw, Ban, Wallet, Megaphone, Headset, Receipt, Wrench, BadgeDollarSign, PiggyBank, Pencil, History } from 'lucide-react'
import { useAdmMoney, useAdmAgents, useAdmActions, useAdmPeriod, useAdmDraws, PLANS, PERIODS, SETUP_FEE, CARD_FEE } from '../data'
import { Avatar, Chip, PillTabs, SampleTag, Seg, Switch, useNote } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile, EngineSlot } from '../kit'
import { ap } from '../paths'
import { BILL_WORD, BANK_WORD } from '../words'

// P866 — the tab and page read Revenue (Brayden didn't like Money). P864 — Money (it was Billing & revenue): at the top, for This week / This month / Last month, what came in (what agents
// paid), what it cost (ad spend, VA payouts, card fees, tools), the profit, and the owners' split (Brayden and Jordan,
// 50/50 by default, a setting with an audit line). Both admins see everything, each other's payouts too. Below it, kept:
// P849 — Billing & revenue: money in (agents' plans and lead spend, by week, each agent's bill and the failed
// payments) and money out (the Monday VA pay run, cancellations that need a listen with Pay it / Don't pay as
// fulfillment_decide_cancel does today, past runs, the Stripe balance and the pause switch). Sample amounts and prices.
const money = usd()

// A sample player: no audio leaves or loads; it shows where the AI heard the problem.
function Player({ at }) {
  const [on, setOn] = useState(false)
  const [t, setT] = useState(0)
  const len = 420
  const mark = (() => { const [m, s] = at.split(':'); return (+m * 60 + +s) / len })()
  useEffect(() => {
    if (!on) return undefined
    const id = setInterval(() => setT(x => { if (x >= len) { setOn(false); return len } return x + 4 }), 100)
    return () => clearInterval(id)
  }, [on])
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <div className="adm-player">
      <button type="button" className="fx-ib" aria-label={on ? 'Pause' : 'Play the call'} onClick={() => setOn(o => !o)}>{on ? <Pause size={16} /> : <Play size={16} />}</button>
      <div className="adm-wave" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={len} aria-valuenow={t} tabIndex={0}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.round(((e.clientX - r.left) / r.width) * len)) }}
        onKeyDown={e => { if (e.key === 'ArrowRight') setT(x => Math.min(len, x + 15)); if (e.key === 'ArrowLeft') setT(x => Math.max(0, x - 15)) }}>
        <i style={{ '--w': t / len }} /><em style={{ left: `${mark * 100}%` }} aria-hidden="true" />
      </div>
      <small className="tp-num">{fmt(t)}</small>
      <button type="button" className="fx-pillbtn" onClick={() => setT(Math.round(mark * len))}>Jump to {at}</button>
    </div>
  )
}

function Listen({ c, i }) {
  const { decideCancel } = useAdmActions()
  const note = useNote()
  const [text, setText] = useState('')
  return (
    <article className="fx-tile adm-listen" style={{ '--i': i }}>
      <header className="fx-tile-h"><span className="tp-grow"><h2>{c.client} · {c.carrier}</h2><p>{c.va} · {c.why}</p></span><b className="tp-money">{money(c.amount)}</b></header>
      <Player at={c.at} />
      <label className="tp-field"><span>Note</span><input value={text} onChange={e => setText(e.target.value)} placeholder="What you heard (needed for Don't pay)" /></label>
      <div className="tp-row tp-wrap">
        <button type="button" className="tp-primary sm fx-accent" onClick={() => { decideCancel(c.id, true, text.trim()); note(`Marked paid: ${c.client}`) }}><CircleCheck size={14} />Pay it</button>
        <button type="button" className="tp-btn sm ov-ghost" disabled={text.trim().length < 3} title={text.trim().length < 3 ? 'Add a note first' : undefined} onClick={() => { decideCancel(c.id, false, text.trim()); note(`Not paid: ${c.client}`) }}><Ban size={14} />Don't pay</button>
      </div>
    </article>
  )
}

function Revenue() {
  const { data: m } = useAdmMoney()
  const { data: agents } = useAdmAgents()
  const top = Math.max(...m.weeks.map(w => w.plans + w.leads))
  const byPlan = Object.entries(PLANS).map(([k, p]) => ({ k, ...p, n: agents.filter(a => a.plan === k && !a.comped).length }))
  return (
    <div className="fx-ovl">
      <div className="fx-ovl-main">
        <Tile className="adm-rev-hero" i={0} title="Revenue by week" sub="Plans plus leads charged · sample prices">
          <div className="fx-chart-head fx-bk-head">
            <b className="tp-money fx-bk-num"><CountUp value={m.total} format={money} /></b>
            <span className="fx-bk-side"><b>this week so far</b><small>{money(m.lastWeek)} last week</small><i className={`fx-delta is-${m.total >= m.lastWeek ? 'up' : 'warn'}`}>{m.total >= m.lastWeek ? 'Up' : 'Behind'} {Math.abs(Math.round(((m.total - m.lastWeek) / m.lastWeek) * 100))}%</i></span>
          </div>
          <div className="fx-key"><span><i className="adm-k is-sold" />Plans</span><span><i className="adm-k is-mid" />Leads</span><SampleTag>Sample prices</SampleTag></div>
          <div className="adm-revbars" role="img" aria-label={m.weeks.map(w => `${w.wk}: ${money(w.plans + w.leads)}`).join('. ')}>
            {m.weeks.map((w, i) => (
              <span key={w.wk} className={w.now ? 'is-now' : ''} style={{ '--i': i }}>
                <b className="tp-num">{money(w.plans + w.leads)}</b>
                <i style={{ '--h': (w.plans + w.leads) / top }}><em className="is-leads" style={{ '--h': w.leads / (w.plans + w.leads) }} /><em className="is-plans" style={{ '--h': w.plans / (w.plans + w.leads) }} /></i>
                <small>{w.wk}</small>
              </span>
            ))}
          </div>
        </Tile>
      </div>
      <div className="fx-ovl-side adm-side">
        <Tile className="is-fill is-teal" i={1} title="Ad spend this week" sub={`Budget ${money(m.adBudget)} across both ad accounts`} to={ap('connect')} label="Open Connect">
          <b className="fx-huge tp-money"><CountUp value={m.adSpend} format={money} /></b>
          <div className="fx-meter" role="img" aria-label="Spent of budget"><i style={{ '--w': m.adBudget ? m.adSpend / m.adBudget : 0 }} /></div>
          <small>{money(m.leadsCharged)} charged to agents for leads</small>
        </Tile>
        <Tile i={2} title="By plan" sub="Paying agents">
          <ul className="adm-sum">{byPlan.map(p => <li key={p.k}><Megaphone size={14} aria-hidden="true" /><span className="tp-grow">{p.label}<small>{p.price ? `${money(p.price)} a week` : 'Leads only'}</small></span><b className="tp-num">{p.n}</b></li>)}</ul>
        </Tile>
      </div>
    </div>
  )
}

// A dollar line in a breakdown list.
const Line = ({ icon: Icon, label, sub, n, extra, neg }) => (
  <li><Icon size={14} aria-hidden="true" /><span className="tp-grow">{label}{sub && <small>{sub}</small>}{extra}</span><b className="tp-money">{neg && n > 0 ? '−' : ''}{money(n)}</b></li>
)

// Brought in → Costs → Profit as a small waterfall: costs float from the profit up to what came in.
function Waterfall({ p }) {
  const top = Math.max(p.inTotal, 1)
  const pos = Math.max(0, p.profit)
  const cols = [
    { k: 'in', label: 'Brought in', n: p.inTotal, b: 0, h: p.inTotal / top },
    { k: 'cost', label: 'Costs', n: p.costTotal, b: pos / top, h: p.costTotal / top, neg: true },
    { k: 'profit', label: 'Profit', n: p.profit, b: 0, h: pos / top },
  ]
  return (
    <div className="adm-fall" role="img" aria-label={`Brought in ${money(p.inTotal)}, costs ${money(p.costTotal)}, profit ${money(p.profit)}`}>
      {cols.map((c, i) => (
        <span key={c.k} className={`adm-fall-${c.k}`} style={{ '--i': i }}>
          <i style={{ '--b': c.b, '--h': Math.max(c.h, 0.004) }}><b className="tp-money">{c.neg ? '−' : ''}{money(c.n)}</b></i>
          <small>{c.label}</small>
        </span>
      ))}
    </div>
  )
}

// The owners' split: each one's share of the period's profit, paid out so far and still owed. The split is a setting.
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

function MoneyTop({ period, setPeriod }) {
  const { data: p } = useAdmPeriod(period)
  const span = PERIODS.find(x => x[0] === period)
  const margin = p.inTotal ? Math.round((p.profit / p.inTotal) * 100) : 0
  return (
    // P867: the four totals (Brought in, Costs, Profit, the split) are one band that fills the window (data-fold), so
    // the details below (By week, Agent billing, Payouts) clearly peek; before, the split sat alone at the fold.
    <section className="adm-money" aria-label="Revenue for the period" data-fold data-fold-next=".adm-tabpane .fx-tile">
      <div className="adm-money-bar">
        <Seg label="Period" value={period} onChange={setPeriod} options={PERIODS.map(([k, label]) => ({ key: k, label }))} />
        <small className="tp-sub">{span[2]} · sample numbers</small>
      </div>
      <div className="adm-money-grid has-split">
        <Tile className="adm-total is-in" i={0} title="Brought in" sub="Everything agents paid">
          <b className="fx-huge tp-money"><CountUp value={p.inTotal} format={money} /></b>
          <ul className="adm-sum">
            <Line icon={Megaphone} label="Lead budgets" sub="Leads charged to agents" n={p.budgets} />
            <Line icon={BadgeDollarSign} label="Servicing plans" sub="Weekly plan fees" n={p.servicing} />
            <Line icon={Receipt} label="Setup fees" sub={p.setupCount ? `${p.setupCount} new ${p.setupCount === 1 ? 'agent' : 'agents'} · ${money(SETUP_FEE)} each` : 'No new agents'} n={p.setup} />
          </ul>
        </Tile>
        <Tile className="adm-total is-cost" i={1} title="Costs" sub="What it took to run">
          <b className="fx-huge tp-money"><CountUp value={p.costTotal} format={money} /></b>
          <ul className="adm-sum">
            <Line icon={Megaphone} label="Ad spend" extra={<EngineSlot className="adm-engine-sm" />} n={p.ads} neg />
            <Line icon={Headset} label="VA payouts" sub={p.runs.length ? `${p.runs.length} pay ${p.runs.length === 1 ? 'run' : 'runs'} paid` : 'No run paid yet'} n={p.vaPay} neg />
            <Line icon={CreditCard} label="Card fees" sub={`About ${Math.round(CARD_FEE * 100)}% of what came in`} n={p.fees} neg />
            <Line icon={Wrench} label="Tools" sub={p.tools ? 'Texting, phone lines, software' : 'Billed on the 1st'} n={p.tools} neg />
          </ul>
        </Tile>
        <Tile className={`adm-total is-profit${p.profit < 0 ? ' is-loss' : ''}`} i={2} title="Profit" sub={`Brought in minus costs · ${margin}% kept`}>
          <b className="fx-huge tp-money"><CountUp value={p.profit} format={money} /></b>
          <Waterfall p={p} />
        </Tile>
        <Split p={p} key={p.split[0].pct} />
      </div>
    </section>
  )
}

function AgentBills() {
  const { data: agents } = useAdmAgents()
  const { data: m } = useAdmMoney()
  const note = useNote()
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
        <div className="adm-tr adm-th" aria-hidden="true"><span>Agent</span><span>Plan</span><span>Lead budget</span><span>Status</span><span>Next</span></div>
        {agents.map((a, i) => {
          const [word, tone] = BILL_WORD[a.billing.status]
          return (
            <div key={a.id} className="adm-tr" style={{ '--i': i }}>
              <Link to={ap('agents', a.id)} className="adm-who"><Avatar name={a.name} /><span className="tp-grow"><b>{a.name}</b><small>{a.billing.method}</small></span></Link>
              <span className="adm-cell"><b>{PLANS[a.plan].label}</b><small>{PLANS[a.plan].price ? `${money(PLANS[a.plan].price)} a week` : 'No plan fee'}</small></span>
              <span className="adm-cell"><b className="tp-money">{money(a.spend)}</b><small>a week</small></span>
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
        {m.listen.length > 0 && <div className="adm-listens">{m.listen.map((c, i) => <Listen key={c.id} c={c} i={i} />)}</div>}
        <Tile i={2} title="Who is in Monday's run" sub={`${m.payday} · ${money(m.rate)} a confirmed cancellation`}>
          <ul className="tp-list adm-rows">{m.run.map(r => {
            const [bw, bt] = BANK_WORD[r.bank]
            return <li key={r.va_id} className="fx-mrow"><Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small>{r.count} verified cancellations</small></span><Chip tone={bt}>{bw}</Chip><b className="tp-money">{r.bank === 'ready' ? money(r.amount) : '–'}</b></li>
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
            <li><CircleCheck size={14} aria-hidden="true" /><span className="tp-grow">Pay per cancellation<small>Weekly cap and minimum too</small></span><Link to={`${ap('settings')}?tab=pay`} className="fx-pillbtn">{money(m.rate)}<ArrowUpRight size={13} /></Link></li>
          </ul>
        </Tile>
      </div>
    </div>
  )
}

const TABS = [['revenue', 'By week'], ['agents', 'Agent billing'], ['payouts', 'Payouts']]
export default function Billing() {
  const [sp, setSp] = useSearchParams()
  const { data: m } = useAdmMoney()
  const raw = sp.get('tab')
  const tab = TABS.some(t => t[0] === raw) ? raw : 'revenue'
  const rawP = sp.get('period')
  const period = PERIODS.some(x => x[0] === rawP) ? rawP : 'week'
  const put = (k, v, dflt) => { const next = new URLSearchParams(sp); if (v === dflt) next.delete(k); else next.set(k, v); setSp(next, { replace: true }) }
  return (
    <div className="tp-page fx-page adm-billing">
      <MoneyTop period={period} setPeriod={v => put('period', v, 'week')} />
      <PillTabs label="Revenue details" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={t => put('tab', t, 'revenue')}
        items={TABS.map(([k, label]) => ({ key: k, label, count: k === 'agents' && m.failed.length ? m.failed.length : k === 'payouts' && m.listen.length ? m.listen.length : undefined }))} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'revenue' && <Revenue />}
        {tab === 'agents' && <AgentBills />}
        {tab === 'payouts' && <Payouts />}
      </div>
    </div>
  )
}
