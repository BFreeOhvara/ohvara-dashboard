import { Link } from 'react-router-dom'
import { CalendarCheck, Wallet, ShieldCheck, ChevronRight, Clock } from 'lucide-react'
import { useSampleOverview, useSampleNeeds, useSampleLeads, useSampleClients, useSampleBilling } from '../data'
import { Avatar } from '../kit'
import { laneOf } from '../stages'
import { useClientStatusOf } from '../checkSettings'
import { clientStatus } from '../../lib/clientCheck.js'
import { dailyTotal, rangeWords } from '../spendPlan'
import { usd } from '../motion'
import { CallBtn, NeedList, Sec } from './bits'
import { LiveStrip } from './MLeads'
import { mp } from './mpaths'

// P908 — the Overview on a phone: only what matters, stacked. Live calls first, then your next call (Call in reach),
// then what needs you, then this week in three numbers. The charts stay on the desktop.
export default function MOverview() {
  const { data: o } = useSampleOverview()
  const { data: needs } = useSampleNeeds()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: bill } = useSampleBilling()
  const statusOf = useClientStatusOf()
  const money = usd()
  const next = o.nextAppt
  const personOf = a => (a.kind === 'client' ? clients.find(c => c.id === a.ref) : leads.find(l => l.id === a.ref))
  const phoneOf = a => { const p = personOf(a); return a.kind === 'client' ? p?.client_phone : p?.rawPhone || p?.phone }
  const toneOf = a => { const p = personOf(a); return !p ? 'blue' : a.kind === 'client' ? clientStatus(statusOf(p)).tone : laneOf(p).tone }
  const toOf = a => (a.kind === 'client' ? mp.client(a.ref) : mp.lead(a.ref))
  const later = o.todayAppts.filter(a => next && a.id !== next.id && a.time !== next.time && !a.inText.startsWith('now'))
  const wk = bill.expected.appts.booked
  const prot = clients.filter(c => statusOf(c) === 'protected').length
  const hour = Number(o.clock.time.split(':')[0]) % 12 + (o.clock.ampm === 'PM' ? 12 : 0)
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="mx-page">
      <p className="mx-hello"><b>{hello}, {o.name}.</b><span>{o.today} · {o.clock.time} {o.clock.ampm}</span></p>

      <LiveStrip leads={leads} compact />

      <Sec title="Next call" to={mp.calendar()} link="Calendar">
        {next
          ? (
            <div className={`mx-next fx-card is-${toneOf(next)}`}>
              <Link to={toOf(next)} className="mx-cover" aria-label={`Open ${next.who}`} />
              <div className="mx-next-top"><span><Clock size={15} aria-hidden="true" />{next.time} · {next.inText}</span><span className="mx-tag">{next.label}</span></div>
              <div className="mx-next-mid"><Avatar name={next.who} tone={toneOf(next)} /><b>{next.who}</b></div>
              <CallBtn big phone={phoneOf(next)} label={`Call ${next.who.split(' ')[0]}`} />
            </div>
          )
          : <p className="mx-empty">Nothing else booked today.</p>}
        {later.length > 0 && (
          <ul className="mx-people is-flat">
            {later.map(a => (
              <li key={a.id} className={`mx-person is-${toneOf(a)}`}>
                <Link to={toOf(a)} className="mx-cover" aria-label={`Open ${a.who}`} />
                <span className="mx-time tp-num">{a.time}</span>
                <span className="tp-grow"><b>{a.who}</b><small>{a.label}</small></span>
                <ChevronRight size={18} className="mx-chev" aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </Sec>

      <Sec title="Needs you" to={mp.leads()} link="Leads">
        <NeedList items={[...needs.now, ...(needs.notices || [])]} />
      </Sec>

      <Sec title="This week">
        <ul className="mx-tiles is-three">
          <li><CalendarCheck size={18} aria-hidden="true" /><b className="tp-num">{bill.booked}</b><small>booked</small><em>about {rangeWords(wk)}</em></li>
          <li><ShieldCheck size={18} aria-hidden="true" /><b className="tp-num">{prot}</b><small>protected</small><em>{clients.length} clients</em></li>
          <li><Wallet size={18} aria-hidden="true" /><b className="tp-money">{money(dailyTotal(bill.spend))}</b><small>a day</small><Link to={mp.billing()} className="mx-link">Change</Link></li>
        </ul>
      </Sec>
    </div>
  )
}
