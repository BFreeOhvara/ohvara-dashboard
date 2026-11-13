import { useMemo, useState } from 'react'
import { Bell, Search, ChevronRight, CalendarOff, CreditCard, UserPlus, CheckCircle2 } from 'lucide-react'
import { useAdmDay, useAdmDesk, useAdmPeriod, useAdmMoney, useAdmAgents, useAdmActions, useAdmSource, useAdmRota, PERIODS } from '../data'
import { useNote, useAccount } from '../../template/kit'
import { useApp, Ini, rise, SubPage } from '../../template/m/AppKit'
import { greetingOf, firstName } from '../../template/m/va/vaModel'
import { money, changeWords, barsOf, halvesOf, toWatch, flagOf, statusLine, callSplit } from './admModel'
import { useNeeds, useOwnerMe } from './useAdm'
import { LATER } from './admStore'
import { AssignSheet } from './ASubsAdm'
import { useMessageTo } from './useAdm'

// P986 — Home: the bell (Notifications from the left), the wordmark, search. The date and greeting; the dark profit
// card (this month, the change vs last month, the last 4 weeks, each owner's half and the payday; tap for the money
// breakdown); Needs you (days off, failed cards, unassigned leads, each with two buttons; "All clear" when empty); the
// green Team on shift card; today across all agents; agents to watch.
const dateOf = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const shortPay = p => String(p || '').replace(/^(\w{3}), \w{3} (\d+)$/, '$1 $2')

export default function AHomeAdm() {
  const app = useApp()
  const me = useOwnerMe()
  const account = useAccount()
  const { data: day } = useAdmDay()
  const { data: desk } = useAdmDesk()
  const { data: month } = useAdmPeriod('month')
  const { data: last } = useAdmPeriod('last')
  const { data: m } = useAdmMoney()
  const { data: agents } = useAdmAgents()
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const weeks = m.weeks.slice(-4)
  const bars = barsOf(weeks.map(w => w.revenue))
  const halves = halvesOf(month.split, me)
  const split = callSplit(desk)
  const today = day.byDay.find(d => d.day === day.today) || { in: 0, booked: 0, transferred: 0 }
  const watch = toWatch(agents)
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
        <span>{dateOf(day.todayIso)}</span>
        <h1>{greetingOf(nowMin)}, {me?.name || firstName(account?.name) || 'there'}</h1>
      </div>

      <button type="button" className="ma-plan am-profit ma-press ma-rise" style={rise(1)} onClick={() => app.openSub('money')} aria-label={`Profit this month ${money(month.profit)}. Open the money breakdown`}>
        <i className="ma-glow is-sky" aria-hidden="true" />
        <span className="am-profit-top">
          <span className="ma-grow"><small>Profit this month</small><b className="tp-money">{money(month.profit)}</b><small className="am-change">{changeWords(month.profit, last.profit)}</small></span>
          <span className="am-bars" aria-hidden="true">
            {weeks.map((w, i) => <span key={w.wk}><i style={{ height: `${bars[i]}%` }} className={w.now ? 'is-now' : ''} /><small>{w.wk.replace(/^\w+ /, '')}</small></span>)}
          </span>
        </span>
        <span className="ma-plan-stats am-halves">
          {halves.map(h => <span key={h.id}><b className="tp-money">{money(h.amount)}</b><small>{h.label}</small></span>)}
          <span><b>{shortPay(m.payday)}</b><small>payday</small></span>
        </span>
        <ChevronRight size={20} className="am-profit-go" aria-hidden="true" />
      </button>

      <NeedsYou />

      <button type="button" className="va-shift is-sage am-shift ma-press ma-rise" style={rise(3)} onClick={() => app.goTab('team')}>
        <span className="va-shift-top">
          <b><i className={day.onShift.length ? 'is-live' : ''} aria-hidden="true" />Team on shift · {day.onShift.length ? day.onShift.map(v => firstName(v.name)).join(', ') : 'nobody yet'}</b>
          <span>{split.done} of {split.total} calls done</span>
        </span>
        <span className="va-bar" role="progressbar" aria-label="Desk calls done today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={split.total ? Math.round((split.done / split.total) * 100) : 0}><i style={{ width: `${split.total ? Math.round((split.done / split.total) * 100) : 0}%` }} /></span>
        <small>No clients on hold · <OffLine /></small>
        <ChevronRight size={20} className="am-shift-go" aria-hidden="true" />
      </button>

      <div className="ma-h2 ma-rise" style={rise(4)}><h2>Today across all agents</h2></div>
      <button type="button" className="ma-week am-today ma-press ma-rise" style={rise(4)} onClick={() => app.openSub('leads')} aria-label="Open all leads">
        <span><b>{today.in}</b><small>new leads</small></span>
        <span><b className="is-good">{today.booked}</b><small>booked</small></span>
        <span><b>{today.transferred}</b><small>live transfers</small></span>
      </button>

      <div className="ma-h2 ma-rise" style={rise(5)}><h2>Agents to watch</h2><button type="button" className="ma-textbtn" onClick={() => app.goTab('agents')}>All agents</button></div>
      <div className="ma-glass ma-list ma-rise" style={rise(5)}>
        {watch.map(a => {
          const f = flagOf(a)
          return (
            <button key={a.id} type="button" className="ma-row" onClick={() => app.openSub('agent', { t: a.id })}>
              <Ini name={a.name} tone="sky" size={42} />
              <span className="ma-grow"><b>{a.name}</b><small className={f ? 'am-warn' : ''}>{f ? f.title : statusLine(a)}</small></span>
              <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
            </button>
          )
        })}
        {!watch.length && <p className="ma-hint">Every agent is doing fine.</p>}
        <button type="button" className="ma-all" onClick={() => app.goTab('agents')}>All agents<ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
  )
}

// Who is off today (a day off booked for today), for the Team on shift card.
function OffLine() {
  const { data: day } = useAdmDay()
  const { data: rota } = useAdmRota()
  const names = rota.dayOff.filter(d => d.date === day.today && d.status === 'approved').map(d => firstName(d.va))
  return names.length ? <>{names.join(' and ')} {names.length === 1 ? 'is' : 'are'} off</> : <>Nobody off today</>
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
      {!items.length && <p className="ma-empty is-glass am-clear"><CheckCircle2 size={20} aria-hidden="true" />All clear. Nothing needs you right now.</p>}
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
