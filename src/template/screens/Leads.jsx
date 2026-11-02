import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Wallet, Phone } from 'lucide-react'
import { useSampleLeads, useSampleBilling, useSampleSettings, useSampleActions } from '../data'
import { Avatar, Chip, Money, SampleTag, Seg, Switch, Drawer, useNote } from '../kit'
import { stageChip, OutcomeDrawer } from '../LeadOutcome'
import { paths } from '../paths'

function LeadRow({ l, onOutcome, onAccept }) {
  const [tone, label] = stageChip(l.stage)
  const waiting = ['booked', 'no_show', 'missed'].includes(l.stage)
  return (
    <li className="tp-li" style={{ alignItems: 'flex-start' }}>
      <Avatar name={`${l.first_name} ${l.last_name}`} tone="blue" />
      <div className="tp-grow">
        <div className="tp-row tp-wrap"><Link to={paths.lead(l.id)}><b>{l.first_name} {l.last_name}</b></Link><Chip tone={tone}>{label}</Chip></div>
        <small>{l.city}, {l.state} · {l.age_band} · {l.appt || (l.stage === 'ringing' ? 'Ringing now, 0:14' : 'No time set')}</small>
        <div className="tp-row tp-wrap" style={{ marginTop: 8, gap: 6 }}>
          {l.stage === 'ringing' && <button type="button" className="ov-hero tp-primary sm" onClick={() => onAccept(l)}><Phone size={14} />Accept</button>}
          {waiting && ['sold', 'follow_up', 'not_interested'].map(k => <button key={k} type="button" className="tp-btn ov-ghost" onClick={() => onOutcome(l, k)}>{stageChip(k)[1]}</button>)}
          {l.stage === 'sold' && <Link to={paths.submit()} className="tp-btn ov-ghost">Submit for servicing</Link>}
          {l.stage === 'follow_up' && <Chip tone="outline">{l.follow}</Chip>}
        </div>
      </div>
    </li>
  )
}

export default function Leads() {
  const { data: leads } = useSampleLeads()
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setDuty, moveLead } = useSampleActions()
  const note = useNote()
  const [tab, setTab] = useState('appointments')
  const [outcome, setOutcome] = useState(null)
  const [spend, setSpend] = useState(false)
  const rows = leads.filter(l => (tab === 'live' ? l.kind === 'live_call' : l.kind === 'appointment'))
  const total = billing.leadTypes.filter(t => t.on).reduce((n, t) => n + t.weekly, 0)
  const accept = l => { moveLead(l.id, 'booked'); note(`You took the call with ${l.first_name}. The team dropped off`) }
  return (
    <div className="tp-page">
      <section className="ov-card tp-card" aria-label="Leads spend">
        <div className="tp-row tp-wrap tp-between">
          <div className="tp-row"><span className="tp-ic"><Wallet size={18} /></span><div><h2 className="tp-h2">Leads spend</h2><p className="tp-sub">Next charge {billing.next_charge}</p></div></div>
          <div className="tp-row tp-wrap"><div><Money v={total} size="lg" /> <span className="tp-sub">a week</span></div><SampleTag /><button type="button" className="tp-btn ov-ghost" onClick={() => setSpend(true)}>Change spend</button></div>
        </div>
        <div className="tp-g2" style={{ marginTop: 12 }}>
          {billing.leadTypes.map(t => <div key={t.key} className="tp-row" style={{ opacity: t.on ? 1 : 0.55 }}><span className="tp-ic teal">{t.key === 'live' ? <PhoneIncoming size={16} /> : <CalendarDays size={16} />}</span><div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub}</p></div><Money v={t.weekly} cents={false} /></div>)}
        </div>
      </section>

      <section className="ov-card tp-card" aria-label="On duty">
        <div className="tp-row"><div className="tp-grow"><b>On duty</b><p className="tp-sub">Live calls ring (214) 555-0188 inside your hours, {settings.hours.start} to {settings.hours.end}.</p></div>
          <Switch on={settings.duty} label="On duty" onChange={v => { setDuty(v); note(v ? 'You are on duty. Calls ring your phone' : 'You are off duty. Calls stop ringing') }} /></div>
      </section>

      <Seg label="Leads" value={tab} onChange={setTab} options={[{ key: 'appointments', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live_call').length }]} />
      <section className="ov-card tp-card">
        <p className="tp-sub">{tab === 'live' ? 'If you miss one, the team books the next open slot within the hour.' : 'The team books inside your working hours, at a time that works for the lead.'}</p>
        <ul className="tp-list">{rows.map(l => <LeadRow key={l.id} l={l} onOutcome={(lead, kind) => setOutcome({ lead, kind })} onAccept={accept} />)}</ul>
      </section>

      <OutcomeDrawer lead={outcome?.lead} kind={outcome?.kind} onClose={() => setOutcome(null)} />
      <SpendDrawer open={spend} onClose={() => setSpend(false)} />
    </div>
  )
}

function SpendDrawer({ open, onClose }) {
  const { data: billing } = useSampleBilling()
  const { setLeadType } = useSampleActions()
  const note = useNote()
  return (
    <Drawer open={open} onClose={onClose} title="Change spend" sub="Sample prices, not final" footer={<button type="button" className="ov-hero tp-primary" onClick={() => { note('Spend updated'); onClose() }}>Done</button>}>
      {billing.leadTypes.map(t => <div key={t.key} className="tp-row"><div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub}</p></div><Money v={t.weekly} cents={false} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
    </Drawer>
  )
}
