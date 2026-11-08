import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Shuffle, PhoneMissed, Hand, CalendarOff, CreditCard, PhoneCall, Radio, Megaphone } from 'lucide-react'
import { useAdmDay, useAdmMoney, useAdmAgents, useAdmDesk, useAdmCosts, dateText } from '../data'
import { Avatar } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile, EngineSlot } from '../kit'
import { useGhlRow } from '../useGhlRow'
import { ap } from '../paths'
import { adAlerts } from '../p879'

// P849 — the admin Overview: the whole business at a glance on the Solvik shape (head stats, one dominant tile, a
// right column, colour carried by a few filled tiles). Dominant tile = leads this week as a funnel (in, booked,
// transferred, sold) with a bar per day; under it, who is on shift today (butter) and revenue this week (sage); the
// right column = what needs an admin, as stage-coloured cards; along the bottom, the agents. Sample info only.
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

// This week's leads by day, with its key. In the hero on wide screens; its own tile on a phone (P867), so the phone's
// first block is just the funnel and Needs you peeks below it.
function DayBars({ day, top }) {
  return (
    <>
    <div className="adm-daybars" role="img" aria-label={day.byDay.map(d => `${d.name}: ${d.in} in, ${d.sold} sold`).join('. ')}>
      {day.byDay.map((d, i) => (
        <span key={d.day} className={d.later ? 'is-later' : ''} style={{ '--i': i }}>
          <b className="tp-num">{d.later ? '' : d.in}</b>
          <i style={{ '--h': d.in / top }}>
            <em className="is-sold" style={{ '--h': d.in ? d.sold / d.in : 0 }} />
            <em className="is-mid" style={{ '--h': d.in ? (d.booked + d.transferred - d.sold) / d.in : 0 }} />
          </i>
          <small>{d.name}</small>
        </span>
      ))}
    </div>
    <div className="fx-key"><span><i className="adm-k is-sold" />Sold</span><span><i className="adm-k is-mid" />Booked or transferred</span><span><i className="adm-k is-in" />Came in</span></div>
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
  const w = day.week
  const steps = [['in', 'Came in', w.in], ['booked', 'Booked', w.booked], ['transferred', 'Transferred', w.transferred], ['sold', 'Sold', w.sold]]
  const top = Math.max(4, ...day.byDay.map(d => d.in))
  const revTop = Math.max(...m.weeks.map(x => x.plans + x.leads))
  const needs = [
    ...day.unassigned.map(l => ({ id: l.id, to: ap('leads', l.id), tone: 'warn', icon: Shuffle, kicker: 'No agent yet', title: l.name, sub: `${l.product} · came ${l.came.replace('Today, ', '')}` })),
    ...day.missed.map(l => ({ id: l.id, to: ap('leads', l.id), tone: 'warn', icon: PhoneMissed, kicker: 'Missed transfer', title: l.name, sub: `${l.agent ? 'Rang the agent' : 'No pickup'} · ${l.came}` })),
    ...day.late.map(c => ({ id: c.id, to: `${ap('team')}?call=${c.id}`, tone: 'warn', icon: Hand, kicker: 'Call past its time', title: c.client, sub: `${c.time} · give it to someone free` })),
    ...day.requests.map(r => ({ id: r.id, to: `${ap('team')}?tab=requests`, tone: 'teal', icon: CalendarOff, kicker: 'Day off asked', title: r.va || 'A VA', sub: dateText(r.date) })),
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
          <section className="fx-tile is-deep fx-ovl-needs" style={{ '--i': 4 }} aria-label="Needs you">
            <div className="fx-ovl-needs-in">
              <header className="fx-tile-h">
                <span className="tp-grow"><h2>Needs you</h2><p>{needs.length ? `${needs.length} things, oldest money first` : 'Nothing waiting'}</p></span>
              </header>
              {needs.length > 0
                ? <div className="fx-ncards adm-needs">{needs.map((n, i) => <Need key={`${n.kicker}-${n.id}`} {...n} i={i} />)}</div>
                : <p className="fx-calm"><Check size={16} aria-hidden="true" />Nothing needs an admin right now.</p>}
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

          <Tile className="is-fill is-green adm-ov-rev" i={2} title="Revenue this week" sub={`Plans ${money(m.plans)} · leads ${money(m.leadsCharged)}`} to={ap('billing')} label="Open Revenue">
            <b className="fx-huge tp-money"><CountUp value={m.total} format={money} /></b>
            <div className="adm-minibars" role="img" aria-label={m.weeks.map(x => `Week of ${x.wk}: ${money(x.plans + x.leads)}`).join(', ')}>
              {m.weeks.map(x => (
                <span key={x.wk} className={x.now ? 'is-now' : ''}>
                  <i style={{ '--h': (x.plans + x.leads) / revTop }}><em style={{ '--h': x.plans / (x.plans + x.leads) }} /></i>
                  <small>{x.wk.replace('Oct ', '').replace('Sep ', '').replace('Nov ', '')}</small>
                </span>
              ))}
            </div>
            <small className="adm-note">{money(m.lastWeek)} last week · {day.real ? 'from billing' : 'sample prices'}</small>
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
