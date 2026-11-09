import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Hand, CreditCard, PhoneCall, Radio, Megaphone, ChevronDown, ChevronUp } from 'lucide-react'
import { useAdmDay, useAdmMoney, useAdmAgents, useAdmDesk, useAdmCosts } from '../data'
import { Avatar } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile, EngineSlot } from '../kit'
import { useGhlRow } from '../useGhlRow'
import { ap } from '../paths'
import { adAlerts } from '../p879'
import { UnmatchedAlert } from './Unmatched913'

// P849 — the admin Overview: the whole business at a glance on the Solvik shape (head stats, one dominant tile, a
// right column, colour carried by a few filled tiles). Dominant tile = leads this week as a funnel (in, booked,
// transferred, sold) with a bar per day; under it, who is on shift today (butter) and revenue this week (sage); the
// right column = what needs an admin, as stage-coloured cards; along the bottom, the agents. Sample info only.
// P906: "transferred" reads Live calls; no missed transfers (a missed one bounces back and is booked); Needs you shows
// what fits with "Show all" instead of a box cut off mid-card, and the page itself scrolls.
const NEEDS_SHOWN = 4
const money = usd()
const cents = usd(true)

// P858: what the ads cost per lead, per booked and per sale this week, from real spend and real outcomes. Until
// GoHighLevel's ad spend is connected, the engine slot.
function CostLine({ costs, row }) {
  if (!costs) return <p className="adm-note adm-costs">Cost per lead, booked and sale <EngineSlot settings={row} /></p>
  const t = costs.total
  const f = v => (v == null ? '–' : cents(v))
  return (
    <dl className="fx-facts adm-costs" aria-label="Ad cost this week">
      {[['Ad spend', money(t.spend)], ['Per lead', f(t.perLead)], ['Per booked', f(t.perBooked)], ['Per sale', f(t.perSale)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-money">{v}</dd></div>)}
    </dl>
  )
}

function Need({ to, tone, icon: Icon, kicker, title, sub, i }) {
  return (
    <article className={`fx-card fx-ncard is-${tone}`} style={{ '--i': i }}>
      <Link to={to} className="fx-cover" aria-label={`${kicker}: ${title}`} />
      <span className="fx-ncard-k"><Icon size={13} aria-hidden="true" />{kicker}</span>
      <h3>{title}</h3>
      <p>{sub}</p>
    </article>
  )
}

// P913 — this week as a clean grid: one equal cell per day, Mon to Sun, with the bar inside. A day with no data yet is
// the same empty cell (no dashed blobs). Leads this week: came in, with the sold part. Revenue this week: the same.
function WeekGrid({ cells, label }) {
  return (
    <ol className="adm-weekgrid" role="img" aria-label={label}>
      {cells.map((c, i) => (
        <li key={c.key} className={c.today ? 'is-today' : ''} style={{ '--i': i }}>
          <b className="tp-num">{c.later ? '' : c.text}</b>
          <span className="adm-wg-bar" aria-hidden="true"><i style={{ '--h': c.h }}><em style={{ '--h': c.part }} /></i></span>
          <small>{c.name}</small>
        </li>
      ))}
    </ol>
  )
}
const leadCells = (day, top) => day.byDay.map(d => ({
  key: d.day, name: d.name, later: d.later, today: d.day === day.today, text: d.in, h: d.later ? 0 : d.in / top, part: d.in ? d.sold / d.in : 0,
}))
function DayBars({ day, top }) {
  return (
    <>
      <WeekGrid cells={leadCells(day, top)} label={day.byDay.map(d => `${d.name}: ${d.later ? 'not yet' : `${d.in} in, ${d.sold} sold`}`).join('. ')} />
      <div className="fx-key"><span><i className="adm-k is-sold" />Sold</span><span><i className="adm-k is-in" />Came in</span></div>
    </>
  )
}

export default function Overview() {
  const { data: day } = useAdmDay()
  const { data: m } = useAdmMoney()
  const { data: agents } = useAdmAgents()
  const { data: desk } = useAdmDesk()
  const { data: costs } = useAdmCosts()
  const row = useGhlRow()
  const [allNeeds, setAllNeeds] = useState(false)
  // P913: the unmatched-lead alert takes the top of Needs you; the other cards wait behind "Show all" (never cut off)
  const shown = day.unassigned.length ? 0 : NEEDS_SHOWN
  const w = day.week
  const steps = [['in', 'Came in', w.in], ['booked', 'Booked', w.booked], ['transferred', 'Live calls', w.transferred], ['sold', 'Sold', w.sold]]
  const top = Math.max(4, ...day.byDay.map(d => d.in))
  const revTop = Math.max(1, ...m.days.map(x => x.revenue))
  const k = n => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : money(n))
  const needs = [
    ...day.late.map(c => ({ id: c.id, to: `${ap('team')}?call=${c.id}`, tone: 'warn', icon: Hand, kicker: 'Call past its time', title: c.client, sub: `${c.time} · give it to someone free` })),
    ...day.failed.map(a => ({ id: a.id, to: `${ap('billing')}?tab=agents`, tone: 'blue', icon: CreditCard, kicker: 'Payment failed', title: a.name, sub: `${a.billing.failed.what} · ${money(a.billing.failed.amount)}` })),
    // P879 (N-A-04): an ad rejected, or in review over 24 h, from the engine (sample until 858 + GoHighLevel).
    ...(day.real ? [] : adAlerts()).map(x => ({ id: `ad-${x.agent}`, to: ap('agents', x.agent), tone: 'warn', icon: Megaphone, kicker: x.kind === 'rejected' ? 'Ad rejected' : 'Ad in review', title: agents.find(a => a.id === x.agent)?.name || 'An agent', sub: x.text })),
  ]
  const onShift = day.onShift.map(v => ({ ...v, calls: desk.filter(c => c.va_id === v.id) }))
  const todayCalls = desk.length
  const done = desk.filter(c => ['cancelled', 'no_answer'].includes(c.status)).length

  // P867: three bands so the page clearly scrolls. The first screen (this week's leads + Needs you) fills the window
  // (data-fold, src/template/fold.js) and the next band, On shift + Revenue, peeks about a third; Agents runs last.
  return (
    <div className="tp-page fx-page adm-ov">
      <div className="adm-ov-top" data-fold>
        <Tile className="adm-ov-hero" i={0} title="Leads this week" sub={`${day.range} · ${money(w.premium)} a month in new premium`} to={ap('leads')} label="Open Leads">
          <ol className="adm-funnel" aria-label="This week's leads">
            {steps.map(([k, label, n], i) => (
              <li key={k} className={`is-${k}`} style={{ '--i': i }}>
                <small>{label}</small>
                <b className="fx-huge tp-num"><CountUp value={n} /></b>
                {i > 0 && <span className="adm-rate">{steps[i - 1][2] ? Math.round((n / (k === 'booked' || k === 'transferred' ? w.in : w.booked + w.transferred)) * 100) : 0}%</span>}
              </li>
            ))}
          </ol>
          <DayBars day={day} top={top} />
          <CostLine costs={costs} row={row} />
        </Tile>

        <div className="fx-ovl-side">
          <section className={`fx-tile is-deep fx-ovl-needs${allNeeds ? ' is-all' : ''}`} style={{ '--i': 4 }} aria-label="Needs you">
            <div className="fx-ovl-needs-in">
              <header className="fx-tile-h">
                <span className="tp-grow"><h2>Needs you</h2><p>{needs.length + day.unassigned.length ? `${needs.length + day.unassigned.length} things, oldest money first` : 'Nothing waiting'}</p></span>
              </header>
              <UnmatchedAlert />
              {(needs.length > 0 && (shown > 0 || allNeeds))
                ? <div className="fx-ncards adm-needs">{(allNeeds ? needs : needs.slice(0, shown)).map((n, i) => <Need key={`${n.kicker}-${n.id}`} {...n} i={i} />)}</div>
                : !needs.length && !day.unassigned.length && <p className="fx-calm"><Check size={16} aria-hidden="true" />Nothing needs an admin right now.</p>}
              {needs.length > shown && (
                <button type="button" className="fx-pillbtn fx-self adm-needs-more" aria-expanded={allNeeds} onClick={() => setAllNeeds(v => !v)}>
                  {allNeeds ? <>Show fewer<ChevronUp size={14} /></> : <>Show all {needs.length}<ChevronDown size={14} /></>}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="adm-ov-pair">
          <Tile className="is-fill is-teal adm-ov-shift" i={1} title="On shift today" sub={`${done} of ${todayCalls} calls done · ${day.late.length} past their time`} to={ap('team')} label="Open Fulfillment team">
            <b className="fx-huge tp-num"><CountUp value={onShift.length} /><small>VAs</small></b>
            <ul className="adm-shift">
              {onShift.map(v => (
                <li key={v.id}>
                  <Avatar name={v.name} />
                  <span className="tp-grow"><b>{v.name}</b><small>{v.hours}</small></span>
                  <span className={`adm-dot${v.onCall ? ' is-live' : ''}`}>{v.onCall ? <><PhoneCall size={12} aria-hidden="true" />On a call</> : `${v.calls.filter(c => c.status === 'booked').length} to call`}</span>
                </li>
              ))}
            </ul>
          </Tile>

          <Tile className="is-fill is-green adm-ov-rev" i={2} title="Revenue this week" sub={`Plans ${money(m.plans)} · 12% fee ${money(m.leadFee)} · setup ${money(m.setup)}`} to={ap('billing')} label="Open Revenue">
            <b className="fx-huge tp-money"><CountUp value={m.total} format={money} /></b>
            <WeekGrid label={m.days.map(x => `${x.name}: ${x.later ? 'not yet' : money(x.revenue)}`).join(', ')}
              cells={m.days.map(x => ({ key: x.day, name: x.name, later: x.later, today: x.isToday, text: k(x.revenue), h: x.later ? 0 : x.revenue / revTop, part: x.revenue ? x.plans / x.revenue : 0 }))} />
            <small className="adm-note">{money(m.lastWeek)} last week · lead spend ({money(m.leadSpend)}) passes to Meta and isn't counted · {day.real ? 'from billing' : 'sample prices'}</small>
          </Tile>
      </div>

      <Tile className="adm-ov-days" i={5} title="Leads by day" sub="This week, Monday to today">
        <DayBars day={day} top={top} />
      </Tile>

      <Tile className="adm-ov-agents" i={6} title="Agents" sub={`${day.onDuty.length} taking live transfers now · ${agents.length} in all`} to={ap('agents')} label="Open Agents">
        <ul className="adm-agents">
          {agents.slice().sort((a, b) => b.week.sold - a.week.sold || b.week.in - a.week.in).map(a => (
            <li key={a.id}>
              <Link to={ap('agents', a.id)} className="adm-agent">
                <Avatar name={a.name} />
                <span className="tp-grow"><b>{a.name}</b><small>{a.planInfo.label} · {a.city}, {a.state}</small></span>
                <span className="adm-agent-n"><b className="tp-num">{a.week.sold}</b><small>sold</small></span>
                <span className={`fx-delta is-${a.active && a.onDuty ? 'up' : a.billing.status === 'past_due' ? 'warn' : 'mute'}`}>
                  {a.active && a.onDuty ? <><Radio size={11} aria-hidden="true" />On duty</> : a.billing.status === 'past_due' ? 'Past due' : a.active ? 'Off duty' : 'Booking only'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to={ap('agents')} className="fx-pillbtn fx-self">All agents<ArrowUpRight size={14} /></Link>
      </Tile>
    </div>
  )
}
