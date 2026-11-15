import { useMemo, useState } from 'react'
import { Bell, Search, ChevronRight, CalendarOff, CreditCard, UserPlus, Radio, PhoneCall } from 'lucide-react'
import { useAdmDay, useAdmDesk, useAdmPeriod, useAdmMoney, useAdmAgents, useAdmActions, useAdmSource, useAdmSettings, useAdmCosts, PERIODS } from '../data'
import { PhoneClock } from '../../template/m/zone'
import { minuteOf } from '../../lib/callSlots'
import { useNote, useAccount } from '../../template/kit'
import { AllClear } from '../../template/AllClear'
import { useApp, Ini, rise, SubPage } from '../../template/m/AppKit'
import { greetingOf, firstName } from '../../template/m/va/vaModel'
import AreaTrend from '../../template/AreaTrend'
import LiveStatus from '../LiveStatus'
import { money, barsOf, halvesOf } from './admModel'
import { useNeeds, useOwnerMe } from './useAdm'
import { LATER } from './admStore'
import { AssignSheet } from './ASubsAdm'
import { useMessageTo } from './useAdm'

// P986 — Home: the bell (Notifications from the left), the wordmark, search. The date and greeting.
// P1002 — the numbers are the desktop Overview's (adminshell/screens/Overview.jsx), nothing the desktop doesn't have:
// the live line (what is on right now), Needs you (the desktop's To-dos), Leads this week as a funnel with what the ads
// cost, On shift today, Revenue this week (tap for the money breakdown), Leads by day, and every agent ranked by sales.
const LEAD_SERIES = [
  { key: 'in', label: 'Came in', color: 'var(--ox-soft)' },
  { key: 'delivered', label: 'Delivered', color: 'var(--ox-mid-tone)' },
  { key: 'sold', label: 'Sold', color: 'var(--ox-sold)' },
]

export default function AHomeAdm() {
  const app = useApp()
  const me = useOwnerMe()
  const account = useAccount()
  const { data: day } = useAdmDay()
  const { data: desk } = useAdmDesk()
  const { data: m } = useAdmMoney()
  const { data: agents } = useAdmAgents()
  const { data: costs } = useAdmCosts()
  const { data: zoneSet } = useAdmSettings() // P989: the clock and greeting in the admin's own zone
  const nowMin = minuteOf(new Date().toISOString(), zoneSet?.tz || 'America/Chicago')
  const w = day.week
  const steps = [['in', 'Came in', w.in], ['booked', 'Booked', w.booked], ['transferred', 'Live calls', w.transferred], ['sold', 'Sold', w.sold]]
  const bars = barsOf(m.days.map(d => (d.later ? 0 : d.revenue)))
  const onShift = day.onShift.map(v => ({ ...v, calls: desk.filter(c => c.va_id === v.id) }))
  const done = desk.filter(c => ['cancelled', 'no_answer'].includes(c.status)).length
  const ranked = agents.slice().sort((a, b) => b.week.sold - a.week.sold || b.week.in - a.week.in)
  const rate = (k, n) => (steps[0][2] ? Math.round((n / (k === 'booked' || k === 'transferred' ? w.in : w.booked + w.transferred)) * 100) : 0)
  const cost = v => (v == null ? '–' : money(v))
  return (
    <div className="ma-tabpage">
      <div className="ma-home-h ma-rise">
        <button type="button" className="ma-ib ma-press" aria-label={`Notifications${app.unseen ? `, ${app.unseen} new` : ''}`} onClick={() => app.openSub('notif')}>
          <Bell size={25} strokeWidth={1.9} aria-hidden="true" />{app.unseen > 0 && <span className="ma-badge is-bell">{app.unseen}</span>}
        </button>
        <span className="ma-wordmark" aria-hidden="true">ohvara</span>
        <button type="button" className="ma-ib ma-press" aria-label="Search agents, VAs, leads and clients" onClick={() => app.openSub('search')}><Search size={25} strokeWidth={1.9} aria-hidden="true" /></button>
      </div>

      <div className="ma-hello ma-rise" style={rise(0)}>
        <PhoneClock tz={zoneSet?.tz} />
        <h1>{greetingOf(nowMin)}, {me?.name || firstName(account?.name) || 'there'}</h1>
      </div>
      <div className="am-live ma-rise" style={rise(0)}><LiveStatus /></div>

      <NeedsYou />

      <div className="ma-h2 ma-rise" style={rise(3)}><h2>Leads this week</h2><button type="button" className="ma-textbtn" onClick={() => app.openSub('leads')}>All leads</button></div>
      <section className="ma-glass ma-pad am-leads ma-rise" style={rise(3)} aria-label="Leads this week">
        <p className="am-sub">{day.range} · <span className="tp-money">{money(w.premium)}</span> a month in new premium</p>
        <ol className="am-funnel" aria-label="This week's leads">
          {steps.map(([k, label, n], i) => (
            <li key={k} className={`is-${k}`}><b className="tp-num">{n}</b><small>{label}</small>{i > 0 && <span className="tp-num">{rate(k, n)}%</span>}</li>
          ))}
        </ol>
        {costs
          ? (
            <dl className="am-costs" aria-label="Ad cost this week">
              {[['Ad spend', money(costs.total.spend)], ['Per lead', cost(costs.total.perLead)], ['Per booked', cost(costs.total.perBooked)], ['Per sale', cost(costs.total.perSale)]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tp-money">{v}</dd></div>)}
            </dl>
          )
          : <small className="am-subnote">Cost per lead, booked and sale show once ad spend comes in from GoHighLevel.</small>}
      </section>

      <div className="ma-h2 ma-rise" style={rise(4)}><h2>On shift today</h2><span>{done} of {desk.length} calls done today</span></div>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        {onShift.map(v => (
          <button key={v.id} type="button" className="ma-row" onClick={() => app.openSub('va', { t: v.id })}>
            <Ini person name={v.name} size={42} />
            <span className="ma-grow"><b>{v.name}</b><small>{v.hours}</small></span>
            <span className={`am-onstat${v.onCall ? ' is-live' : ''}`}>{v.onCall ? <><PhoneCall size={12} aria-hidden="true" />On a call</> : `${v.calls.filter(c => c.status === 'booked').length} to call`}</span>
          </button>
        ))}
        {!onShift.length && <p className="ma-empty">Nobody is on shift right now.</p>}
        <button type="button" className="ma-all" onClick={() => app.goTab('team')}>Open Fulfillment team<ChevronRight size={16} aria-hidden="true" /></button>
      </div>

      <button type="button" className="ma-plan am-profit am-rev ma-press ma-rise" style={rise(5)} onClick={() => app.openSub('money')} aria-label={`Revenue this week ${money(m.total)}. Open the money breakdown`}>
        <i className="ma-glow is-sky" aria-hidden="true" />
        <span className="am-profit-top">
          <span className="ma-grow"><small>Revenue this week</small><b className="tp-money">{money(m.total)}</b><small className="am-change">{money(m.lastWeek)} last week</small></span>
          <span className="am-bars" aria-hidden="true">
            {m.days.map((d, i) => <span key={d.name}><i style={{ height: `${bars[i]}%` }} className={d.isToday ? 'is-now' : ''} /><small>{String(d.name).slice(0, 1)}</small></span>)}
          </span>
        </span>
        <span className="ma-plan-stats am-halves">
          <span><b className="tp-money">{money(m.plans)}</b><small>plans</small></span>
          <span><b className="tp-money">{money(m.leadFee)}</b><small>booking desk</small></span>
          <span><b className="tp-money">{money(m.setup)}</b><small>setup</small></span>
        </span>
        <ChevronRight size={20} className="am-profit-go" aria-hidden="true" />
      </button>
      <p className="ma-note am-revnote">Lead spend (<span className="tp-money">{money(m.leadSpend)}</span>) passes to Meta and isn’t counted · {day.real ? 'from billing' : 'sample prices'}</p>

      <div className="ma-h2 ma-rise" style={rise(6)}><h2>Leads by day</h2></div>
      <section className="ma-glass ma-pad am-trend ma-rise" style={rise(6)} aria-label="Leads by day">
        <AreaTrend rows={day.trend} series={LEAD_SERIES} todayIso={day.todayIso} label="Leads" head={<p className="am-sub">Came in, delivered and sold, day by day</p>} />
      </section>

      <div className="ma-h2 ma-rise" style={rise(7)}><h2>Agents</h2><button type="button" className="ma-textbtn" onClick={() => app.goTab('agents')}>All agents</button></div>
      <p className="ma-hint">{day.onDuty.length} taking live transfers now · {agents.length} in all</p>
      <div className="ma-glass ma-list ma-rise" style={rise(7)}>
        {ranked.map(a => {
          const duty = a.active && a.onDuty
          const due = a.billing.status === 'past_due'
          return (
            <button key={a.id} type="button" className="ma-row" onClick={() => app.openSub('agent', { t: a.id })}>
              <Ini person name={a.name} size={42} />
              <span className="ma-grow"><b>{a.name}</b><small>{a.planInfo.label} · {a.city}, {a.state}</small></span>
              <span className="am-sold"><b className="tp-num">{a.week.sold}</b><small>sold</small></span>
              <span className={`ma-tag is-${duty ? 'sage' : due ? 'apricot' : 'stone'}`}>{duty ? <><Radio size={11} aria-hidden="true" /> On duty</> : due ? 'Past due' : a.active ? 'Off duty' : 'Booking only'}</span>
            </button>
          )
        })}
        {!ranked.length && <p className="ma-empty">No agents yet.</p>}
      </div>
    </div>
  )
}

// ── Needs you ────────────────────────────────────────────────────────────────────────────────────────────────────
function NeedsYou() {
  const items = useNeeds()
  const { decideDayOff } = useAdmActions()
  const note = useNote()
  const src = useAdmSource()
  const msg = useMessageTo()
  const [assign, setAssign] = useState(null)
  return (
    <div className="ma-needs am-needs ma-rise" style={rise(2)}>
      <div className="ma-h2"><h2>Needs you</h2>{items.length > 0 && <span>{items.length}</span>}</div>
      {items.map(it => {
        if (it.kind === 'dayoff') {
          const r = it.r
          return (
            <div key={it.key} className="ma-need is-butter">
              <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><CalendarOff size={19} /></span><span className="ma-grow"><b>{r.va} asked for a day off</b><small>{`Nov ${r.date}`}{r.reason ? ` · ${r.reason}` : ''}</small></span></div>
              <div className="ma-need-btns">
                <button type="button" className="ma-nb is-main ma-press" onClick={() => { decideDayOff(r.id, true); note(`${firstName(r.va)}’s day off is approved`) }}>Approve</button>
                <button type="button" className="ma-nb ma-press" onClick={() => { decideDayOff(r.id, false); note(`${firstName(r.va)}’s day off is declined`) }}>Decline</button>
              </div>
            </div>
          )
        }
        if (it.kind === 'failed') {
          const a = it.a
          const f = a.billing.failed
          return (
            <div key={it.key} className="ma-need is-coral">
              <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><CreditCard size={19} /></span><span className="ma-grow"><b>{a.name}’s card failed</b><small>{f.what} · <span className="tp-money">{money(f.amount)}</span> · {f.when}</small></span></div>
              <div className="ma-need-btns">
                <button type="button" className="ma-nb is-main ma-press" onClick={() => note(src === 'sample' ? `Pay link sent to ${firstName(a.name)} (sample: nothing was sent)` : `Pay links go out once billing is switched on`)}>Send pay link</button>
                <button type="button" className="ma-nb ma-press" onClick={() => msg(a, 'Agent')}>Message</button>
              </div>
            </div>
          )
        }
        const n = it.leads.length
        return (
          <div key={it.key} className="ma-need is-apricot">
            <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><UserPlus size={19} /></span><span className="ma-grow"><b>{n} {n === 1 ? 'lead has' : 'leads have'} no agent</b><small>{it.leads.slice(0, 2).map(l => l.name).join(', ')}{n > 2 ? ` and ${n - 2} more` : ''}</small></span></div>
            <div className="ma-need-btns">
              <button type="button" className="ma-nb is-main ma-press" onClick={() => setAssign(it.leads)}>Assign</button>
              <button type="button" className="ma-nb ma-press" onClick={() => LATER.add(it.key)}>Later</button>
            </div>
          </div>
        )
      })}
      {!items.length && <AllClear phone line="Approvals, setup steps and anything else waiting on you." />}
      <AssignSheet leads={assign} onClose={() => setAssign(null)} />
    </div>
  )
}

const Line = ({ k, v, sub, strong }) => <div className={`ma-row am-line${strong ? ' is-strong' : ''}`}><span className="ma-grow"><b>{k}</b>{sub && <small>{sub}</small>}</span><span className="ma-val tp-money">{v}</span></div>

// ── Money breakdown ──────────────────────────────────────────────────────────────────────────────────────────────
export function AMoney() {
  const [period, setPeriod] = useState('month')
  const { data: p } = useAdmPeriod(period)
  const { data: m } = useAdmMoney()
  const me = useOwnerMe()
  const halves = useMemo(() => halvesOf(p.split, me), [p.split, me])
  const label = PERIODS.find(x => x[0] === period)
  return (
    <SubPage title="Money" line={`${label[1]} · ${label[2]}`} big>
      <div className="ma-seg am-seg ma-rise" role="tablist" aria-label="Period">
        {PERIODS.map(([k, w]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={`is-sky${period === k ? ' is-on' : ''}`} onClick={() => setPeriod(k)}>{w}</button>)}
      </div>
      <p className="ma-cap is-out">Brought in</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        <Line k="Plans" sub="Monthly plan fees" v={money(p.servicing)} />
        <Line k="Lead fee" sub="12% of lead spend" v={money(p.leadFee)} />
        <Line k="Setup fees" sub={`${p.setupCount} new ${p.setupCount === 1 ? 'agent' : 'agents'}`} v={money(p.setup)} />
        <Line k="Total" v={money(p.inTotal)} strong />
      </div>
      <p className="ma-cap is-out">Costs</p>
      <div className="ma-glass ma-list ma-rise" style={rise(2)}>
        <Line k="VA pay" sub={`${p.runs.length} pay ${p.runs.length === 1 ? 'run' : 'runs'}`} v={money(p.vaPay)} />
        <Line k="AI caller" sub={`${p.aiMins} minutes`} v={money(p.ai)} />
        <Line k="Card fees" v={money(p.fees)} />
        <Line k="Total" v={money(p.costTotal)} strong />
      </div>
      <div className="ma-plan am-profitline ma-rise" style={rise(3)}>
        <span className="ma-grow"><small>Profit</small><b className="tp-money">{money(p.profit)}</b></span>
      </div>
      <p className="ma-cap is-out">The split</p>
      <div className="ma-glass ma-list ma-rise" style={rise(4)}>
        {halves.map(h => <Line key={h.id} k={`${h.label} · ${h.pct}%`} sub={`Paid ${money(h.paid)} · ${money(h.owed)} still to pay · payday ${m.payday}`} v={money(h.amount)} />)}
      </div>
      <p className="ma-note">Lead spend ({money(p.leadSpend)}) is the agents’ money passed to Meta. It’s never in revenue or profit.</p>
    </SubPage>
  )
}
