import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CheckCheck, X, Clock3, CalendarOff, CreditCard, UserPlus, ListChecks, Users, BarChart3, Bug } from 'lucide-react'
import { useAdmFeed, useAdmAgents, useAdmVas, useAdmLeads, useAdmClients, useAdmActions, useAdmDay } from '../data'
import { useNote } from '../../template/kit'
import { useApp, SubPage, BottomSheet, Ini, Row, rise } from '../../template/m/AppKit'
import { useNoAutoKeyboard } from '../../template/m/useKeyboard'
import { NoteRow } from '../../template/m/ANotes'
import { FEED_SEEN, RECENT, useRecent } from './admStore'
import { useNeeds } from './useAdm'
import { searchAll, takingLeads, money, toWatch, flagOf, statusLine, leadStage, leadWhen, LEAD_TONE, LEAD_WORD } from './admModel'

// P986 — the admin app's small shared screens and pieces: Notifications (from the left), Search (agents, VAs, leads
// and clients), the "Give to an agent" sheet, and opening a chat with one person.
const KIND = { billing: 'payment', team: 'message', bug: 'todo', connect: 'message', desk: 'live' }

export function ANotif() {
  const { data: feed } = useAdmFeed()
  const [read, setRead] = useState(() => FEED_SEEN.get())
  const ids = feed.map(f => f.id).join('|')
  useEffect(() => { if (ids) FEED_SEEN.add(ids.split('|')) }, [ids]) // keyed on the ids: the feed is a new array each render
  const left = feed.filter(f => !read.includes(f.id)).length
  const markAll = <button type="button" className="ma-textbtn ma-press" onClick={() => setRead(feed.map(f => f.id))} disabled={!left}><CheckCheck size={18} aria-hidden="true" />Mark all read</button>
  return (
    <SubPage title="Notifications" line={left ? `${left} new` : 'All caught up'} close="Close notifications" className="is-notif" left={markAll} arrowRight big>
      {feed.map((f, i) => (
        <NoteRow key={f.id} i={i} unread={!read.includes(f.id)} it={{ kind: KIND[f.kind] || 'todo', title: f.who, what: f.text, time: f.at }} onClick={() => setRead(r => [...new Set([...r, f.id])])} />
      ))}
      {!feed.length && <p className="ma-empty is-glass">Nothing new. Payments, days off, bug reports and the desk show here.</p>}
    </SubPage>
  )
}

const TONE = { agent: 'sky', va: 'sage', lead: 'stone', client: 'sky' }
// P995: Search never opens blank. Before typing: recent searches, Needs you (failed cards, day-off requests,
// unassigned leads), today's booked calls, agents to watch, VAs on shift now, and quick jumps. Typing searches agents,
// VAs, leads and clients as before; a search is kept as a recent one once a result is opened.
const Sym = ({ tone, Icon }) => <span className={`ma-sym is-${tone}`}><Icon size={16} aria-hidden="true" /></span>
const JUMPS = [['leads', 'All leads', ListChecks, 'sky'], ['clients', 'All clients', Users, 'sage'], ['reports', 'Reports', BarChart3, 'butter'], ['bugs', 'Bug reports', Bug, 'coral']]
export function ASearch() {
  const app = useApp()
  const { data: agents } = useAdmAgents()
  const { data: vas } = useAdmVas()
  const { data: leads } = useAdmLeads()
  const { data: clients } = useAdmClients()
  const [q, setQ] = useState('')
  const input = useRef(null)
  useNoAutoKeyboard(input) // no focus on open; the keyboard only comes up when they tap the field
  const hits = useMemo(() => searchAll({ agents, vas, leads, clients }, q), [agents, vas, leads, clients, q])
  const open = h => { RECENT.add(q); app.openSub(h.kind, { t: h.id }) }
  return (
    <SubPage title="Search" line="Agents, VAs, leads and clients" big className="is-search">
      <label className="va-find ma-rise"><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" enterKeyHint="search" placeholder="Name or phone" aria-label="Search agents, VAs, leads and clients" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') RECENT.add(q) }} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      {q.trim() ? (
        <div className="ma-glass ma-list ma-rise" style={rise(1)}>
          {hits.map(h => (
            <button key={`${h.kind}-${h.id}`} type="button" className="ma-row" onClick={() => open(h)}>
              <Ini name={h.name} tone={TONE[h.kind]} size={40} />
              <span className="ma-grow"><b>{h.name}</b><small>{h.sub}</small></span>
            </button>
          ))}
          {!hits.length && <p className="ma-empty">Nobody by that name or number.</p>}
        </div>
      ) : <SearchSuggest onPick={setQ} />}
    </SubPage>
  )
}

function SearchSuggest({ onPick }) {
  const app = useApp()
  const recent = useRecent()
  const needs = useNeeds()
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { data: leads } = useAdmLeads()
  const booked = leads.filter(l => l.day === day.today && l.agent_id && l.kind !== 'none').slice().reverse().slice(0, 4)
  const watch = toWatch(agents)
  let sec = 1
  return (
    <>
      {recent.length > 0 && (
        <div className="ma-rise" style={rise(sec++)}>
          <div className="ma-h2 am-sh2"><h2>Recent</h2><button type="button" className="ma-textbtn" onClick={() => RECENT.clear()}>Clear</button></div>
          <div className="ma-chips am-recent">
            {recent.map(t => <button key={t} type="button" className="ma-fchip ma-press" onClick={() => onPick(t)}><Clock3 size={14} aria-hidden="true" />{t}</button>)}
          </div>
        </div>
      )}
      {needs.length > 0 && (
        <div className="ma-rise" style={rise(sec++)}>
          <div className="ma-h2 am-sh2"><h2>Needs you</h2><span className="am-count">{needs.length}</span></div>
          <div className="ma-glass ma-list">
            {needs.map(it => {
              if (it.kind === 'dayoff') return <Row key={it.key} onClick={() => app.openSub('va', { t: it.r.va_id })} lead={<Sym tone="butter" Icon={CalendarOff} />} title={`${it.r.va} asked for a day off`} sub={`Nov ${it.r.date}${it.r.reason ? ` · ${it.r.reason}` : ''}`} />
              if (it.kind === 'failed') return <Row key={it.key} onClick={() => app.openSub('agent', { t: it.a.id })} lead={<Sym tone="coral" Icon={CreditCard} />} title={`${it.a.name}’s card failed`} sub={`${it.a.billing.failed.what} · ${money(it.a.billing.failed.amount)}`} />
              const n = it.leads.length
              return <Row key={it.key} onClick={() => app.openSub('unassigned')} lead={<Sym tone="apricot" Icon={UserPlus} />} title={`${n} ${n === 1 ? 'lead has' : 'leads have'} no agent`} sub={it.leads.slice(0, 2).map(l => l.name).join(', ')} />
            })}
          </div>
        </div>
      )}
      <div className="ma-rise" style={rise(sec++)}>
        <div className="ma-h2 am-sh2"><h2>Booked today</h2><button type="button" className="ma-textbtn" onClick={() => app.openSub('leads')}>All leads</button></div>
        {booked.length > 0 ? (
          <ul className="ma-cards">
            {booked.map(l => {
              const st = leadStage(l)
              return (
                <li key={l.id} className={`ma-lead is-${LEAD_TONE[st]}`}>
                  <button type="button" className="ma-lead-open" onClick={() => app.openSub('lead', { t: l.id })}><Ini name={l.name} size={42} /><span className="ma-grow"><b>{l.name}</b><small className="is-when">{leadWhen(l)}</small><small>{l.agent}{l.state ? ` · ${l.state}` : ''}</small></span></button>
                  <span className="ma-tag">{LEAD_WORD[st]}</span>
                </li>
              )
            })}
          </ul>
        ) : <p className="ma-empty is-glass">Nothing booked yet today.</p>}
      </div>
      {watch.length > 0 && (
        <div className="ma-rise" style={rise(sec++)}>
          <div className="ma-h2 am-sh2"><h2>Agents to watch</h2><button type="button" className="ma-textbtn" onClick={() => app.goTab('agents')}>All agents</button></div>
          <div className="ma-glass ma-list">
            {watch.map(a => {
              const f = flagOf(a)
              return <Row key={a.id} onClick={() => app.openSub('agent', { t: a.id })} lead={<Ini name={a.name} tone="sky" size={40} />} title={a.name} sub={<span className={f ? 'am-warn' : ''}>{f ? f.title : statusLine(a)}</span>} />
            })}
          </div>
        </div>
      )}
      <div className="ma-rise" style={rise(sec++)}>
        <div className="ma-h2 am-sh2"><h2>VAs on shift now</h2><button type="button" className="ma-textbtn" onClick={() => app.goTab('team')}>Team</button></div>
        {day.onShift.length > 0 ? (
          <div className="ma-glass ma-list">
            {day.onShift.map(v => <Row key={v.id} onClick={() => app.openSub('va', { t: v.id })} lead={<Ini name={v.name} tone="sage" size={40} />} title={v.name} sub="On shift now" />)}
          </div>
        ) : <p className="ma-empty is-glass">Nobody is on shift right now.</p>}
      </div>
      <div className="ma-rise" style={rise(sec++)}>
        <div className="ma-h2 am-sh2"><h2>Jump to</h2></div>
        <div className="am-jumps">
          {JUMPS.map(([k, w, Icon, tone]) => <button key={k} type="button" className="am-jump ma-press" onClick={() => app.openSub(k)}><Sym tone={tone} Icon={Icon} /><b>{w}</b></button>)}
        </div>
      </div>
    </>
  )
}

// "Give to an agent": the agents taking leads (admModel takingLeads), each with their daily spend.
export function AssignSheet({ leads, onClose, current = null }) {
  const { data: agents } = useAdmAgents()
  const { assignLead } = useAdmActions()
  const note = useNote()
  const list = takingLeads(agents)
  const one = leads?.length === 1 ? leads[0] : null
  const give = a => {
    for (const l of leads) assignLead(l.id, a.id)
    note(one ? `${one.name} is now ${a.name.split(' ')[0]}’s lead` : `${leads.length} leads given to ${a.name.split(' ')[0]}`)
    onClose()
  }
  return (
    <BottomSheet open={!!leads?.length} onClose={onClose} label="Give to an agent" tall>
      <p className="ma-sheet-t">{current ? 'Change the agent' : 'Give to an agent'}</p>
      <p className="ma-sheet-s">{one ? `${one.name} · ${one.state || ''}${one.product ? ` · ${one.product}` : ''}` : `${leads?.length || 0} leads`}. Agents taking leads right now.</p>
      <div className="am-sheetlist">
        {list.map(a => (
          <button key={a.id} type="button" className={`ma-pick${a.id === current ? ' is-on' : ''}`} onClick={() => give(a)} disabled={a.id === current}>
            <Ini name={a.name} tone="sky" size={40} />
            <span className="ma-grow"><b>{a.name}{a.id === current ? ' · has it now' : ''}</b><small>{a.states?.join(', ')} · <span className="tp-money">{money(a.spend)}</span> a day</small></span>
          </button>
        ))}
        {!list.length && <p className="ma-sheet-s">No agent is taking leads right now.</p>}
      </div>
    </BottomSheet>
  )
}
