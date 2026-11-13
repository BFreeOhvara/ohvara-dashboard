import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CheckCheck } from 'lucide-react'
import { useAdmFeed, useAdmAgents, useAdmVas, useAdmLeads, useAdmClients, useAdmActions } from '../data'
import { useNote } from '../../template/kit'
import { useApp, SubPage, BottomSheet, Ini, rise } from '../../template/m/AppKit'
import { useNoAutoKeyboard } from '../../template/m/useKeyboard'
import { NoteRow } from '../../template/m/ANotes'
import { FEED_SEEN } from './admStore'
import { searchAll, takingLeads, money } from './admModel'

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
  return (
    <SubPage title="Search" line="Agents, VAs, leads and clients" big>
      <label className="va-find ma-rise"><Search size={18} aria-hidden="true" /><input ref={input} type="search" inputMode="search" placeholder="Name or phone" aria-label="Search agents, VAs, leads and clients" value={q} onChange={e => setQ(e.target.value)} /></label>
      {q.trim() && (
        <div className="ma-glass ma-list ma-rise" style={rise(1)}>
          {hits.map(h => (
            <button key={`${h.kind}-${h.id}`} type="button" className="ma-row" onClick={() => app.openSub(h.kind, { t: h.id })}>
              <Ini name={h.name} tone={TONE[h.kind]} size={40} />
              <span className="ma-grow"><b>{h.name}</b><small>{h.sub}</small></span>
            </button>
          ))}
          {!hits.length && <p className="ma-empty">Nobody by that name or number.</p>}
        </div>
      )}
      {!q.trim() && <p className="ma-note">Type a name or at least 3 digits of a phone number.</p>}
    </SubPage>
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
