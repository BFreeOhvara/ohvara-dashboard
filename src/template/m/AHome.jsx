import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Search, ChevronRight, ShieldCheck, Wallet, FileUp } from 'lucide-react'
import { useSampleOverview, useSampleNeeds, useSampleLeads, useSampleClients, useSampleBilling, useDataSource, useSampleSettings } from '../data'
import { PhoneClock } from './zone'
import { whenBoth, theirTime } from './zoneTime'
import { useClientStatusOf, useCheckSettings, todayFor } from '../checkSettings'
import { checkLists } from '../../lib/clientCheck.js'
import { resultsFor } from '../agentView'
import { dailyTotal } from '../spendPlan'
import { useDeliveredPace } from '../useDeliveredPace'
import { usd } from '../motion'
import { paths } from '../paths'
import { targetOf } from '../../lib/deedstoneCall'
import { AddLeadsCard } from '../Products955'
import { useProducts, useNavKeys } from '../useProducts'
import { useApp, useMark, CallButton, Ini, rise } from './AppKit'
import { useAnswer } from './MClients'
import { greeting, minutesOf, untilWords, stageOf, TONE, RESULT } from './appModel'
import { clockNow } from '../leadLifecycle'

// P967 — Home: what an agent sees first. The bell (left), the ohvara wordmark, search (right); the date and hello;
// Up next (who, when, how long until, one white Call); Later today; Needs you (the top two, one-tap answers);
// This week in three numbers.
export function useNow(o) {
  return minutesOf(`${o.clock.time} ${o.clock.ampm}`)
}

const leadName = l => `${l.first_name} ${l.last_name}`

// One to-do card with its one-tap answers. Leads to mark: Sold / Not sold / No show (a live call: Call back).
// Still on the books: All N still on / Pick. A sale to finish: Add details. Billing: its one button.
export function NeedCard({ item, leads, lists }) {
  const app = useApp()
  const mark = useMark()
  const answer = useAnswer()
  if (item.key) {
    return (
      <div className="ma-need is-coral">
        <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><Wallet size={19} /></span><span className="ma-grow"><b>{item.title}</b><small>{item.what}</small></span></div>
        <div className="ma-need-btns"><Link to={paths.billing()} className="ma-nb is-main ma-press">{item.name}</Link></div>
      </div>
    )
  }
  if (item.kind === 'check') {
    const list = lists.find(x => x.draft === item.ref)
    const cs = list?.clients || []
    const n = cs.length
    return (
      <div className="ma-need is-sage">
        <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><ShieldCheck size={20} /></span><span className="ma-grow"><b>Still on the books?</b><small>{n ? `${n} ${n === 1 ? 'policy' : 'policies'} · ${item.what.split('.')[0]}` : item.what}</small></span></div>
        <div className="ma-need-btns">
          {n > 0 && <button type="button" className="ma-nb is-main is-wide ma-press" onClick={() => answer(cs, item.ref)}>{n === 1 ? 'Still on' : `All ${n} still on`}</button>}
          <button type="button" className="ma-nb ma-press" onClick={() => app.open(`${paths.clients()}`, { cf: 'need' })}>Pick</button>
        </div>
      </div>
    )
  }
  if (item.kind === 'submit') {
    return (
      <div className="ma-need is-sage">
        <div className="ma-need-top"><span className="ma-need-ic" aria-hidden="true"><FileUp size={19} /></span><span className="ma-grow"><b>{item.name}</b><small>Sold. Add the policy details and our team takes it</small></span></div>
        <div className="ma-need-btns"><Link to={paths.submit(item.ref)} className="ma-nb is-main ma-press">{item.action || 'Add details'}</Link></div>
      </div>
    )
  }
  const l = leads.find(x => x.id === item.ref)
  if (!l) return null
  const live = item.trigger === 'live'
  const can = resultsFor(l)
  const third = can.includes('no_show') ? 'no_show' : can.includes('follow_up') ? 'follow_up' : null
  const keys = ['sold', 'not_interested', third].filter(k => k && can.includes(k))
  const when = l.stage === 'ringing' ? 'ringing now' : item.when === 'Today' ? (live ? 'today' : (l.appt || '').split(', ').pop()) : item.when
  return (
    <div className="ma-need is-apricot">
      <div className="ma-need-top">
        <Link to={paths.lead(l.id)} className="ma-cover" aria-label={`Open ${leadName(l)}`} />
        <Ini name={leadName(l)} size={40} />
        <span className="ma-grow"><b>{leadName(l)}</b><small>{live ? 'Live call' : 'Booked call'}{when ? ` · ${when}` : ''} · how did it go?</small></span>
      </div>
      <div className="ma-need-btns">
        {keys.map((k, i) => <button key={k} type="button" className={`ma-nb${i === 0 ? ' is-main' : ''} ma-press`} onClick={() => mark(l, k)}>{k === 'follow_up' ? 'Call back' : RESULT[k].label}</button>)}
        {!keys.length && <button type="button" className="ma-nb is-main ma-press" onClick={() => app.markLead(l)}>Mark</button>}
      </div>
    </div>
  )
}

export function useNeedItems() {
  const { data: needs } = useSampleNeeds()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const source = useDataSource()
  const settings = useCheckSettings()
  const lists = useMemo(() => checkLists(clients, todayFor(source), settings), [clients, source, settings])
  const navKeys = useNavKeys()
  // P974: servicing-only agents (Clients in the bar) see client to-dos only (and billing), never lead ones.
  const all = [...(needs.notices || []), ...needs.now]
  const items = navKeys.has('leads') ? all : all.filter(it => it.key || (it.kind !== 'lead' && it.kind !== 'submit'))
  return { items, leads, clients, lists }
}

export default function AHome() {
  const app = useApp()
  const { data: o } = useSampleOverview()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: bill } = useSampleBilling()
  const statusOf = useClientStatusOf()
  const { has } = useProducts()
  const navKeys = useNavKeys()
  const { items, lists } = useNeedItems()
  const money = usd()
  const now = useNow(o)
  // P974: servicing-only agents (Clients in the bar): Needs you and Up next are about clients only.
  const clientsOnly = !navKeys.has('leads')
  const { data: zoneSet } = useSampleSettings() // P989: the live clock in the agent's zone
  const appts = clientsOnly ? o.todayAppts.filter(a => a.kind === 'client') : o.todayAppts
  const next = clientsOnly
    ? (o.nextAppt?.kind === 'client' ? o.nextAppt : appts.filter(a => minutesOf(a.time) > now).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))[0] || null)
    : o.nextAppt
  const personOf = a => (a.kind === 'client' ? clients.find(c => c.id === a.ref) : leads.find(l => l.id === a.ref))
  const toOf = a => (a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))
  const toneOf = a => { const p = personOf(a); return a.kind === 'client' ? 'sage' : (p && TONE[stageOf(p, clockNow())]) || 'sky' }
  const later = appts.filter(a => (!next || a.id !== next.id) && minutesOf(a.time) > now).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  const needClients = clients.filter(c => statusOf(c) === 'needs_attention').length
  // P991: delivered this week and its pace against how much of the week has passed.
  const { dl, pace } = useDeliveredPace()
  const prot = clients.filter(c => statusOf(c) === 'protected').length
  const hour = Math.floor(now / 60)
  const first = next ? next.who.split(' ')[0] : ''
  const nextPerson = next ? personOf(next) : null

  return (
    <div className="ma-home">
      <header className="ma-home-h ma-rise">
        <button type="button" className="ma-ib ma-press" aria-label={`Notifications${app.unseen ? `, ${app.unseen} new` : ''}`} onClick={() => app.openSub('notif')}>
          <Bell size={25} strokeWidth={1.9} aria-hidden="true" />{app.unseen > 0 && <span className="ma-badge is-bell">{app.unseen}</span>}
        </button>
        <Link to={paths.home()} className="ma-wordmark" aria-label="Ohvara home">ohvara</Link>
        <button type="button" className="ma-ib ma-press" aria-label="Search" onClick={() => app.openSub('search')}><Search size={25} strokeWidth={1.9} aria-hidden="true" /></button>
      </header>

      <div className="ma-hello ma-rise" style={rise(0)}>
        <PhoneClock tz={zoneSet?.timeZone} />
        <h1>{greeting(hour)}, {o.name}</h1>
      </div>

      {next
        ? (
          <article className="ma-next ma-rise" style={rise(1)}>
            <i className="ma-glow" aria-hidden="true" />
            <div className="ma-next-top">
              <span className="ma-grow ma-next-who">
                <span className="ma-next-k"><i aria-hidden="true" />Up next · {untilWords(minutesOf(next.time) - now)}</span>
                <b>{next.who}</b>
                <span className="ma-next-when">{whenBoth(next, zoneSet?.timeZone)} · {next.label}</span>
              </span>
              <Ini name={next.who} size={54} className="ma-next-av" />
            </div>
            <div className="ma-next-btns">
              <CallButton className="ma-btn is-white is-grow" phone={next.kind === 'client' ? nextPerson?.client_phone : nextPerson?.rawPhone || nextPerson?.phone}
                to={nextPerson ? targetOf(next.kind === 'client' ? 'client' : 'lead', nextPerson) : null} label={`Call ${first}`} />
              <Link to={toOf(next)} state={{ tab: 'home' }} className="ma-round is-glass is-big ma-press" aria-label={`Open ${next.who}`}><ChevronRight size={20} aria-hidden="true" /></Link>
            </div>
          </article>
        )
        : (
          <article className="ma-next is-calm ma-rise" style={rise(1)}>
            <i className="ma-glow" aria-hidden="true" />
            <span className="ma-next-k"><i aria-hidden="true" />Up next</span>
            <b className="ma-next-none">{clientsOnly ? 'No client calls today' : 'Nothing else booked today'}</b>
            <span className="ma-next-when">{clientsOnly ? 'Our team works your clients. Anything that needs you shows below.' : 'Our team books calls inside your hours as leads come in.'}</span>
            {clientsOnly
              ? <button type="button" className="ma-btn is-white ma-press" onClick={() => app.goTab('clients')}>Open your clients</button>
              : <button type="button" className="ma-btn is-white ma-press" onClick={() => app.goTab('calendar')}>Open the calendar</button>}
          </article>
        )}

      {later.length > 0 && (
        <div className="ma-glass ma-later ma-rise" style={rise(2)}>
          <p className="ma-cap">Later today</p>
          {later.slice(0, 2).map(a => (
            <Link key={a.id} to={toOf(a)} state={{ tab: 'home' }} className="ma-trow">
              <span className="ma-time">{a.time}</span>
              <i className={`ma-dot is-${toneOf(a)}`} aria-hidden="true" />
              <span className="ma-grow"><b>{a.who}</b><small>{a.label}{theirTime(a, zoneSet?.timeZone) ? ` · ${theirTime(a, zoneSet?.timeZone)} theirs` : ''}</small></span>
              <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
            </Link>
          ))}
          <button type="button" className="ma-all" onClick={() => app.openSub('today')}>{appts.length === 1 ? '1 call today' : `All ${appts.length} calls today`}<ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      )}
      {!later.length && appts.length > 0 && <button type="button" className="ma-pillbtn ma-rise ma-press" style={rise(2)} onClick={() => app.openSub('today')}>{appts.length === 1 ? '1 call today' : `All ${appts.length} calls today`}<ChevronRight size={18} aria-hidden="true" /></button>}

      <section className="ma-needs ma-rise" style={rise(3)} aria-label="Needs you">
        <div className="ma-h2"><h2>Needs you</h2><span>{items.length ? `${items.length} waiting` : 'All caught up'}</span></div>
        {items.length
          ? items.slice(0, 2).map(it => <NeedCard key={it.id || it.key} item={it} leads={leads} lists={lists} />)
          : <p className="ma-empty is-glass">Nothing waiting on you. We let you know when something comes up.</p>}
        {items.length > 2 && <button type="button" className="ma-pillbtn is-tone is-apricot ma-press" onClick={() => app.openSub('needs')}>View all {items.length}<ChevronRight size={18} aria-hidden="true" /></button>}
      </section>

      <AddLeadsCard className="ma-suggest" />

      <div className="ma-week ma-rise" style={rise(4)}>
        <div aria-label={`${dl.total} delivered this week, ${pace.word.toLowerCase()}`}><b className={pace.key === 'ahead' || pace.key === 'above' || pace.key === 'in' ? 'is-good' : pace.key === 'behind' ? 'is-warn' : undefined}>{dl.total}</b><small>delivered</small><small className={`ma-pace is-${pace.tone}`}>{pace.word}</small></div>
        <div><b>{prot}/{clients.length}</b><small>protected</small></div>
        {has('leads')
          ? <button type="button" onClick={() => app.open(paths.billing())}><b className="tp-money">{money(dailyTotal(bill.spend))}</b><small>a day on leads</small></button>
          : clientsOnly
            ? <button type="button" onClick={() => app.goTab('clients')}><b>{needClients}</b><small>need attention</small></button>
            : <div><b>{leads.filter(l => l.stage === 'sold').length}</b><small>sold</small></div>}
      </div>
    </div>
  )
}
