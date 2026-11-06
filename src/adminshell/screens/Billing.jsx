import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Play, Pause, CircleCheck, Landmark, ArrowUpRight, CreditCard, MessageSquare, RotateCw, Ban, Wallet, Megaphone } from 'lucide-react'
import { useAdmMoney, useAdmAgents, useAdmActions, PLANS } from '../data'
import { Avatar, Chip, PillTabs, SampleTag, Switch, useNote } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile } from '../kit'
import { ap } from '../paths'
import { BILL_WORD, BANK_WORD } from '../words'

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

const TABS = [['revenue', 'Revenue'], ['agents', 'Agent billing'], ['payouts', 'VA payouts']]
export default function Billing() {
  const [sp, setSp] = useSearchParams()
  const { data: m } = useAdmMoney()
  const raw = sp.get('tab')
  const tab = TABS.some(t => t[0] === raw) ? raw : 'revenue'
  return (
    <div className="tp-page fx-page adm-billing">
      <PillTabs label="Billing and revenue" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={t => setSp(t === 'revenue' ? {} : { tab: t }, { replace: true })}
        items={TABS.map(([k, label]) => ({ key: k, label, count: k === 'agents' && m.failed.length ? m.failed.length : k === 'payouts' && m.listen.length ? m.listen.length : undefined }))} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'revenue' && <Revenue />}
        {tab === 'agents' && <AgentBills />}
        {tab === 'payouts' && <Payouts />}
      </div>
    </div>
  )
}
