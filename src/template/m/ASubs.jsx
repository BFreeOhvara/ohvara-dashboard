import { useState } from 'react'
import { Search, X, FileUp, CalendarDays } from 'lucide-react'
import { useSampleLeads, useSampleClients, useSampleOverview } from '../data'
import { useClientStatusOf } from '../checkSettings'
import { clockNow } from '../leadLifecycle'
import { paths } from '../paths'
import { ReactivateDrawer, ReactivationCards } from '../Reactivate'
import { useApp, SubPage, Ini, rise } from './AppKit'
import { NeedCard, useNeedItems, useNow } from './AHome'
import { stageOf, TONE, TAG, minutesOf } from './appModel'

// P967 — the sub-screens that open over a tab: Search (All / Leads / Clients; P972: a normal page with a big title
// that scrolls away, no bottom bar, and the keyboard only once the field is tapped), Needs you (every card), Today's calls,
// Import your leads (the P957/P959 flow, unchanged), and Notifications (slides in from the left; new ones dotted, the
// bell's badge clears once it's opened).
const leadName = l => `${l.first_name} ${l.last_name}`
const clientName = c => `${c.client_first_name} ${c.client_last_name}`
const CLIENT_TONE = { working: 'sky', needs_attention: 'apricot', protected: 'sage', closed: 'stone' }
const CLIENT_WORD = { working: 'Working', needs_attention: 'Needs attention', protected: 'Protected', closed: 'Closed' }

export function ASearch() {
  const app = useApp()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const statusOf = useClientStatusOf()
  const [q, setQ] = useState('')
  const [f, setF] = useState('all')
  const n = q.trim().toLowerCase()
  const digits = n.replace(/\D/g, '')
  const hit = (name, phone, more = '') => !n || `${name} ${more}`.toLowerCase().includes(n) || (digits.length >= 3 && String(phone || '').replace(/\D/g, '').includes(digits))
  const now = clockNow()
  const ls = f === 'clients' ? [] : leads.filter(l => stageOf(l, now) !== null && hit(leadName(l), l.phone, l.city || ''))
  const cs = f === 'leads' ? [] : clients.filter(c => hit(clientName(c), c.client_phone, c.carrier_name || ''))
  return (
    <SubPage big title="Search" line="Leads and clients" className="is-search">
      <label className="ma-search"><Search size={19} aria-hidden="true" /><input type="search" aria-label="Search leads and clients" placeholder="Name, phone, city or carrier" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      <div className="ma-chips" role="tablist" aria-label="Search in">
        {[['all', 'All'], ['leads', 'Leads'], ['clients', 'Clients']].map(([k, w]) => <button key={k} type="button" role="tab" aria-selected={f === k} className={`ma-fchip ma-press${f === k ? ' is-on' : ''}`} onClick={() => setF(k)}>{w}</button>)}
      </div>
      {ls.length > 0 && <p className="ma-cap is-out">Leads · {ls.length}</p>}
      <ul className="ma-cards">
        {ls.slice(0, 30).map((l, i) => {
          const st = stageOf(l, now)
          return (
            <li key={l.id} className={`ma-lead is-${TONE[st]} ma-rise`} style={rise(i)}>
              <button type="button" className="ma-lead-open" onClick={() => app.open(paths.lead(l.id))}><Ini name={leadName(l)} size={42} /><span className="ma-grow"><b>{leadName(l)}</b><small>{TAG[st]}{l.city ? ` · ${l.city}` : ''}</small></span></button>
            </li>
          )
        })}
      </ul>
      {cs.length > 0 && <p className="ma-cap is-out">Clients · {cs.length}</p>}
      <ul className="ma-cards">
        {cs.slice(0, 30).map((c, i) => {
          const st = statusOf(c)
          return (
            <li key={c.id} className={`ma-lead is-${CLIENT_TONE[st] || 'sage'} is-client ma-rise`} style={rise(i)}>
              <button type="button" className="ma-lead-open" onClick={() => app.open(paths.client(c.id))}><Ini name={clientName(c)} size={42} /><span className="ma-grow"><b>{clientName(c)}</b><small>{CLIENT_WORD[st] || 'Client'}{c.carrier_name ? ` · ${c.carrier_name}` : ''}</small></span></button>
            </li>
          )
        })}
      </ul>
      {n && !ls.length && !cs.length && <p className="ma-empty">No one matches “{q}”.</p>}
    </SubPage>
  )
}

export function ANeeds() {
  const { items, leads, lists } = useNeedItems()
  return (
    <SubPage title="Needs you" line={items.length ? `${items.length} to do` : 'All done'}>
      <div className="ma-needs">
        {items.map((it, i) => <div key={it.id || it.key} className="ma-rise" style={rise(i)}><NeedCard item={it} leads={leads} lists={lists} /></div>)}
      </div>
      {!items.length && <p className="ma-empty">You’re all caught up. New to-dos show here and on Home.</p>}
    </SubPage>
  )
}

export function AToday() {
  const app = useApp()
  const { data: o } = useSampleOverview()
  const { data: leads } = useSampleLeads()
  const now = useNow(o)
  const list = [...o.todayAppts].sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  const toneOf = a => { if (a.kind === 'client') return 'sage'; const l = leads.find(x => x.id === a.ref); return (l && TONE[stageOf(l, clockNow())]) || 'sky' }
  const foot = <button type="button" className="ma-btn is-soft is-grow is-tall ma-press" onClick={() => { app.back(); app.goTab('calendar') }}><CalendarDays size={18} aria-hidden="true" />Open the calendar</button>
  return (
    <SubPage title="Today" line={`${list.length} call${list.length === 1 ? '' : 's'} · ${o.today}`} foot={foot}>
      <div className="ma-agenda">
        {list.map((a, i) => (
          <div key={a.id} className={`ma-slot ma-rise${minutesOf(a.time) + 30 <= now ? ' is-past' : ''}`} style={rise(i)}>
            <span className="ma-slot-t">{a.time}</span>
            <button type="button" className={`ma-up is-${toneOf(a)} ma-press`} onClick={() => app.open(a.kind === 'client' ? paths.client(a.ref) : paths.lead(a.ref))}>
              <span className="ma-grow"><b>{a.who}</b><small>{a.label}</small></span>
            </button>
          </div>
        ))}
      </div>
      {!list.length && <p className="ma-empty">No calls today. Our team fills open times inside your hours.</p>}
    </SubPage>
  )
}

// Import: the explainer and picker are the doorway; the upload itself is the P957/P959 drawer (card check, limits,
// separate numbers), unchanged.
const STEPS = [
  ['Upload your list', 'A spreadsheet (CSV or Excel) of past leads: name and phone, more if you have it.'],
  ['We check it', 'We remove numbers on Do Not Call lists and anyone already yours, and show you the count and price first.'],
  ['We text them', 'From their own number, with your name. Anyone who answers interested is booked on your calendar.'],
]
export function AImport() {
  const [open, setOpen] = useState(false)
  const foot = <button type="button" className="ma-btn is-solid is-grow is-tall ma-press" onClick={() => setOpen(true)}><FileUp size={18} aria-hidden="true" />Upload</button>
  return (
    <SubPage title="Import your leads" line="Old leads into booked calls" foot={foot}>
      <div className="ma-explain ma-rise">
        <b>Got old leads sitting in a spreadsheet?</b>
        <p>Send them to us. We text each one and book the interested ones on your calendar, like any other lead.</p>
      </div>
      <button type="button" className="ma-picker ma-press ma-rise" style={rise(1)} onClick={() => setOpen(true)}>
        <FileUp size={30} aria-hidden="true" />
        <b>Choose a file</b>
        <small>CSV or Excel · up to 5,000 rows</small>
      </button>
      <ol className="ma-steps ma-rise" style={rise(2)}>
        {STEPS.map(([t, s], i) => <li key={t}><span>{i + 1}</span><span className="ma-grow"><b>{t}</b><small>{s}</small></span></li>)}
      </ol>
      <div className="ma-embed"><ReactivationCards /></div>
      <ReactivateDrawer open={open} onClose={() => setOpen(false)} />
    </SubPage>
  )
}

// Notifications and Activity moved to ANotes.jsx (P972).
