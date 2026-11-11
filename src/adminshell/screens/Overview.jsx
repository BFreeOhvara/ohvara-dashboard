import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, CalendarDays, CreditCard, PhoneCall, Radio, Megaphone, ChevronDown, ChevronUp, Shuffle, Rocket, CalendarOff, PhoneIncoming, ListChecks, Headset, Landmark, Users } from 'lucide-react'
import { useAdmDay, useAdmMoney, useAdmAgents, useAdmDesk, useAdmCosts, useAdmSetup, useAdmRota, useAdmVas, SHIFT_MIN, dateText } from '../data'
import { Avatar } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { Tile, EngineSlot } from '../kit'
import { useGhlRow } from '../useGhlRow'
import { ap } from '../paths'
import { adAlerts } from '../p879'
import LiveStatus from '../LiveStatus'
import { adminTodos, shortCover } from '../todos'
import Chart from '../../template/Chart'
import AreaTrend from '../../template/AreaTrend'
import '../../template/rowbtn936.css'
import '../p942.css'

// P849 — the admin Overview: the whole business at a glance on the Solvik shape (head stats, one dominant tile, a
// right column, colour carried by a few filled tiles). Dominant tile = leads this week as a funnel (in, booked,
// transferred, sold) with a bar per day; under it, who is on shift today (butter) and revenue this week (sage); the
// right column = the admin's To-dos (P914); along the bottom, the agents. Sample info only.
// P906: "transferred" reads Live calls; no missed transfers (a missed one bounces back and is booked).
// P914: "Needs you" is To-dos: a clean list of real admin jobs (todos.js), each with one action; what fits shows, the
// rest wait behind "Show all" (never cut off). Empty: All caught up.
const TODOS_SHOWN = 5 // P934: at least this many; the box shows as many as fit its height (useTodoFit)
const TODO_ICON = { lead: Shuffle, card: CreditCard, launch: Rocket, cover: CalendarOff, ad: Megaphone }
const money = usd()
const cents = usd(true)
const REV_SERIES = [{ key: 'plans', label: 'Plan fees', color: 'var(--ox-1)' }, { key: 'fee', label: 'Booking desk', color: 'var(--ox-3)' }, { key: 'setup', label: 'Setup fees', color: 'var(--ox-4)' }]

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

// P934: the To-dos box shows as many rows as its height holds (it's as tall as Leads this week beside it), so it is
// never half empty; Show all sits pinned at the bottom of the box when more are waiting.
const TODO_ROW = 64 // one row (58px) and the gap under it
function useTodoFit(ref, all) {
  const [fit, setFit] = useState(TODOS_SHOWN)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || all) return undefined
    const read = () => {
      const head = el.querySelector('.fx-tile-h')
      const cs = getComputedStyle(el)
      const room = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (head?.offsetHeight || 0) - 10 - 46 // header gap, Show all
      setFit(Math.max(TODOS_SHOWN, Math.floor((room + 6) / TODO_ROW)))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, all])
  return fit
}

function Todo({ t, i }) {
  const Icon = TODO_ICON[t.kind] || Check
  return (
    <li className={`adm-todo is-${t.tone}`} style={{ '--i': i }}>
      <span className="adm-todo-ic"><Icon size={15} aria-hidden="true" /></span>
      <span className="tp-grow"><b>{t.title}</b><small>{t.sub}</small></span>
      <Link to={t.to} className="fx-pillbtn adm-todo-go">{t.action}</Link>
    </li>
  )
}

// P942 — the leads chart is shadcn/ui's "Area Chart - Interactive" (src/template/AreaTrend.jsx, same on the agent
// Overview): Came in (light, behind), Delivered, Sold (dark, front); range This week · Last 30 days · Last 3 months.
// It takes all the height the box has left under the funnel, so there is no empty bottom half.
const LEAD_SERIES = [
  { key: 'in', label: 'Came in', color: 'var(--ox-soft)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--ox-mid-tone)' },
  { key: 'sold', label: 'Sold', color: 'var(--ox-sold)' },
]
function LeadTrend({ day, className = '' }) {
  return <AreaTrend rows={day.trend} series={LEAD_SERIES} todayIso={day.todayIso} label="Leads" className={className}
    head={<p className="adm-trend-what">Came in, delivered and sold, day by day</p>} />
}

export default function Overview() {
  const { data: day } = useAdmDay()
  const { data: m } = useAdmMoney()
  const { data: agents } = useAdmAgents()
  const { data: desk } = useAdmDesk()
  const { data: costs } = useAdmCosts()
  const row = useGhlRow()
  const { data: pipeline } = useAdmSetup()
  const { data: rota } = useAdmRota()
  const { data: vas } = useAdmVas()
  const [allTodos, setAllTodos] = useState(false)
  const todoBox = useRef(null)
  const fit = useTodoFit(todoBox, allTodos)
  const w = day.week
  const steps = [['in', 'Came in', w.in], ['booked', 'Booked', w.booked], ['transferred', 'Live calls', w.transferred], ['sold', 'Sold', w.sold]]
  const k = n => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : money(n))
  const ahead = Object.keys(rota.rota || {}).map(Number).filter(d => Number.isFinite(d) && d >= day.today).sort((a, b) => a - b).slice(0, 10)
  const cover = shortCover({ rota: rota.rota, dayOff: rota.dayOff, days: ahead, min: SHIFT_MIN, nameOf: id => (vas.find(v => v.id === id)?.name || 'A VA').split(' ')[0] })
  // P879 (N-A-04): an ad rejected, or in review over 24 h, from the engine (sample until 858 + GoHighLevel).
  const todos = adminTodos({
    unassigned: day.unassigned, pipeline, failed: day.failed, cover, ads: day.real ? [] : adAlerts(),
    ap, money, dayText: dateText, agentName: id => agents.find(a => a.id === id)?.name || 'An agent',
  })
  const onShift = day.onShift.map(v => ({ ...v, calls: desk.filter(c => c.va_id === v.id) }))
  const todayCalls = desk.length
  const done = desk.filter(c => ['cancelled', 'no_answer'].includes(c.status)).length

  // P867: three bands so the page clearly scrolls. The first screen (this week's leads + Needs you) fills the window
  // (data-fold, src/template/fold.js) and the next band, On shift + Revenue, peeks about a third; Agents runs last.
  return (
    <div className="tp-page fx-page adm-ov">
      <LiveStatus />
      <div className="adm-ov-top" data-fold data-fold-next=".adm-ov-pair" data-fold-peek>
        <Tile className="adm-ov-hero" i={0} icon={PhoneIncoming} title="Leads this week" sub={`${day.range} · ${money(w.premium)} a month in new premium`} to={ap('leads')} label="Open Leads">
          <ol className="adm-funnel" aria-label="This week's leads">
            {steps.map(([k, label, n], i) => (
              <li key={k} className={`is-${k}`} style={{ '--i': i }}>
                <small>{label}</small>
                <b className="fx-huge tp-num"><CountUp value={n} /></b>
                {i > 0 && <span className="adm-rate">{steps[i - 1][2] ? Math.round((n / (k === 'booked' || k === 'transferred' ? w.in : w.booked + w.transferred)) * 100) : 0}%</span>}
              </li>
            ))}
          </ol>
          <LeadTrend day={day} className="adm-ov-trend" />
          <CostLine costs={costs} row={row} />
        </Tile>

        <div className="fx-ovl-side">
          <section className={`fx-tile is-deep fx-ovl-needs adm-todos${allTodos ? ' is-all' : ''}`} style={{ '--i': 4 }} aria-label="To-dos">
            <div className="fx-ovl-needs-in" ref={todoBox}>
              <header className="fx-tile-h">
                <span className="adm-tile-ic" aria-hidden="true"><ListChecks size={16} /></span>
                <span className="tp-grow"><h2>To-dos</h2><p>{todos.length ? `${todos.length} to do` : 'Nothing waiting'}</p></span>
                {/* P945: booked calls look after themselves (they move on at 10 minutes); the shortcut opens the calendar. */}
                <Link to={`${ap('team')}?tab=calendar`} className="fx-pillbtn adm-cal-go"><CalendarDays size={14} aria-hidden="true" />Calendar</Link>
              </header>
              {todos.length
                ? <ul className="adm-todo-list">{(allTodos ? todos : todos.slice(0, fit)).map((t, i) => <Todo key={t.id} t={t} i={i} />)}</ul>
                : <p className="fx-calm"><Check size={16} aria-hidden="true" />All caught up.</p>}
              {todos.length > fit && (
                <button type="button" className="fx-pillbtn fx-self adm-needs-more" aria-expanded={allTodos} onClick={() => setAllTodos(v => !v)}>
                  {allTodos ? <>Show fewer<ChevronUp size={14} /></> : <>Show all {todos.length}<ChevronDown size={14} /></>}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="adm-ov-pair">
          <Tile className="is-fill is-teal adm-ov-shift" i={1} icon={Headset} title="On shift today" sub={`${done} of ${todayCalls} calls done today`} to={ap('team')} label="Open Fulfillment team">
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

          <Tile className="is-fill is-green adm-ov-rev" i={2} icon={Landmark} title="Revenue this week" sub={`Plans ${money(m.plans)} · booking desk ${money(m.leadFee)} · setup ${money(m.setup)}`} to={ap('billing')} label="Open Revenue">
            <b className="fx-huge tp-money"><CountUp value={m.total} format={money} /></b>
            <Chart tone="fill" stacked compact height={112} format={k} className="adm-revchart"
              label={m.days.map(x => `${x.name}: ${x.later ? 'not yet' : money(x.revenue)}`).join(', ')}
              data={m.days.map(x => ({ name: x.name, later: x.later, today: x.isToday, plans: x.plans, fee: x.fee, setup: x.setup || 0, total: x.revenue }))}
              series={REV_SERIES} yAxis={false}
              tip={r => [...REV_SERIES.map(s => [s.label, money(r[s.key]), s.color]), ['Total', money(r.total)]]} />
            <small className="adm-note">{money(m.lastWeek)} last week · lead spend ({money(m.leadSpend)}) passes to Meta and isn't counted · {day.real ? 'from billing' : 'sample prices'}</small>
          </Tile>
      </div>

      <Tile className="adm-ov-days" i={5} title="Leads by day" sub="Came in, delivered and sold">
        <LeadTrend day={day} />
      </Tile>

      <Tile className="adm-ov-agents" i={6} icon={Users} title="Agents" sub={`${day.onDuty.length} taking live transfers now · ${agents.length} in all`} to={ap('agents')} label="Open Agents">
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
