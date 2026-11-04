import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming, CalendarDays, Phone, Search, Wallet, Clock } from 'lucide-react'
import { useSampleLeads, useSampleBilling, useSampleSettings, useSampleActions } from '../data'
import { Avatar, Chip, Money, Seg, Switch, Drawer, Empty, useNote } from '../kit'
import { stageChip, OutcomeDrawer } from '../LeadOutcome'
import { paths } from '../paths'

// Leads as lanes: where each lead stands, left to right. On a desktop the page holds still and each lane
// scrolls inside itself; on a phone the lanes sit side by side in a strip that swipes sideways.
const LANES = [
  { key: 'now', label: 'Needs you now', tone: 'warn', stages: ['ringing', 'missed', 'no_show'], empty: 'No one is waiting on you.' },
  { key: 'booked', label: 'Booked', tone: 'blue', stages: ['booked'], empty: 'No appointments booked yet.' },
  { key: 'follow', label: 'Follow up', tone: 'teal', stages: ['follow_up'], empty: 'No callbacks set.' },
  { key: 'sold', label: 'Sold', tone: 'green', stages: ['sold'], empty: 'Sales you mark show here.' },
  { key: 'closed', label: 'Not interested', tone: 'mute', stages: ['not_interested'], empty: 'Nothing closed out.' },
]

function LeadCard({ l, onOutcome, onAccept }) {
  const [tone, label] = stageChip(l.stage)
  const waiting = ['booked', 'no_show', 'missed'].includes(l.stage)
  const live = l.kind === 'live_call'
  return (
    <article className={`tp-lcard is-${l.stage}`}>
      <div className="tp-row tp-between">
        <span className="tp-lkind">{live ? <PhoneIncoming size={13} aria-hidden="true" /> : <CalendarDays size={13} aria-hidden="true" />}{live ? 'Live call' : 'Appointment'}</span>
        <Chip tone={tone}>{label}</Chip>
      </div>
      <Link to={paths.lead(l.id)} className="tp-lname"><Avatar name={`${l.first_name} ${l.last_name}`} tone="blue" /><span><b>{l.first_name} {l.last_name}</b><small>{l.city}, {l.state} · {l.age_band}</small></span></Link>
      <p className="tp-lwhen"><Clock size={13} aria-hidden="true" />{l.appt || (l.stage === 'ringing' ? 'Ringing now, 0:14' : l.follow ? `Call back ${l.follow}` : 'No time set')}</p>
      <div className="tp-lacts">
        {l.stage === 'ringing' && <button type="button" className="ov-hero tp-primary sm" onClick={() => onAccept(l)}><Phone size={14} />Accept</button>}
        {waiting && ['sold', 'follow_up', 'not_interested'].map(k => <button key={k} type="button" className="tp-btn ov-ghost" onClick={() => onOutcome(l, k)}>{stageChip(k)[1]}</button>)}
        {l.stage === 'sold' && <Link to={paths.submit()} className="tp-btn ov-ghost">Submit for servicing</Link>}
        {l.stage === 'follow_up' && <Link to={paths.lead(l.id)} className="tp-btn ov-ghost">Open lead</Link>}
      </div>
    </article>
  )
}

export default function Leads() {
  const { data: leads } = useSampleLeads()
  const { data: billing } = useSampleBilling()
  const { data: settings } = useSampleSettings()
  const { setDuty, moveLead } = useSampleActions()
  const note = useNote()
  const [kind, setKind] = useState('all')
  const [q, setQ] = useState('')
  const [outcome, setOutcome] = useState(null)
  const [spend, setSpend] = useState(false)
  const n = q.trim().toLowerCase()
  const shown = leads.filter(l => (kind === 'all' || (kind === 'live' ? l.kind === 'live_call' : l.kind === 'appointment'))
    && (!n || `${l.first_name} ${l.last_name} ${l.city} ${l.phone}`.toLowerCase().includes(n)))
  const total = billing.leadTypes.filter(t => t.on).reduce((s, t) => s + t.weekly, 0)
  const accept = l => { moveLead(l.id, 'booked'); note(`You took the call with ${l.first_name}. The team dropped off`) }
  return (
    <div className="tp-page tp-leads">
      <div className="tp-tools ov-card">
        <label className="tp-find"><Search size={16} aria-hidden="true" /><input aria-label="Find a lead" placeholder="Find a lead by name, city or phone" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Seg label="Lead type" value={kind} onChange={setKind} options={[{ key: 'all', label: 'All', count: leads.length }, { key: 'appointments', label: 'Appointments', count: leads.filter(l => l.kind === 'appointment').length }, { key: 'live', label: 'Live calls', count: leads.filter(l => l.kind === 'live_call').length }]} />
        <span className="tp-grow" />
        <div className="tp-duty" title={`Live calls ring (214) 555-0188 inside your hours, ${settings.hours.start} to ${settings.hours.end}.`}>
          <span><b>On duty</b><small>{settings.hours.start} to {settings.hours.end}</small></span>
          <Switch on={settings.duty} label="On duty" onChange={v => { setDuty(v); note(v ? 'You are on duty. Calls ring your phone' : 'You are off duty. Calls stop ringing') }} />
        </div>
        <button type="button" className="tp-spend" onClick={() => setSpend(true)}><Wallet size={16} aria-hidden="true" /><Money v={total} cents={false} /><small>a week</small><span className="tp-link">Change spend</span></button>
      </div>

      <div className="tp-board" role="region" aria-label="Leads by stage">
        {LANES.map(lane => {
          const rows = shown.filter(l => lane.stages.includes(l.stage))
          return (
            <section key={lane.key} className={`tp-lane ov-card is-${lane.tone}`} aria-label={`${lane.label}, ${rows.length}`}>
              <header className="tp-lane-h"><i aria-hidden="true" /><b>{lane.label}</b><span className="tp-lane-n">{rows.length}</span></header>
              <div className="tp-lane-b">
                {rows.map(l => <LeadCard key={l.id} l={l} onOutcome={(lead, k) => setOutcome({ lead, kind: k })} onAccept={accept} />)}
                {rows.length === 0 && <Empty title="Nothing here" sub={n ? 'No lead matches that search.' : lane.empty} />}
              </div>
            </section>
          )
        })}
      </div>
      <p className="tp-sub tp-board-note">The team books inside your working hours, at a time that works for the lead. Miss a live call and they book the next open slot within the hour.</p>

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
    <Drawer open={open} onClose={onClose} title="Change spend" sub={`Sample prices, not final · next charge ${billing.next_charge}`} footer={<button type="button" className="ov-hero tp-primary" onClick={() => { note('Spend updated'); onClose() }}>Done</button>}>
      {billing.leadTypes.map(t => <div key={t.key} className="tp-row"><span className="tp-ic teal">{t.key === 'live' ? <PhoneIncoming size={16} /> : <CalendarDays size={16} />}</span><div className="tp-grow"><b>{t.label}</b><p className="tp-sub">{t.sub}</p></div><Money v={t.weekly} cents={false} /><Switch on={t.on} label={t.label} onChange={v => setLeadType(t.key, v)} /></div>)}
    </Drawer>
  )
}
