import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Search, X, UserPlus, StickyNote, ChevronRight, ShieldAlert, Wrench, ShieldCheck } from 'lucide-react'
import { useSampleClients, useDataSource } from '../data'
import { useCheckSettings, todayFor } from '../checkSettings'
import { clientStatusOf, checkLists, mergeLists, nextCheck } from '../../lib/clientCheck.js'
import { stagesOf } from '../../lib/clientStages.js'
import { paths } from '../paths'
import { AddNote } from '../TemplateFrame'
import { AddClients } from '../AddClients891'
import { useApp, SubPage, Ini, rise } from './AppKit'
import { CheckCard } from './MClients'
import { CLIENT_GROUPS, CLIENT_TONE, groupClients, clientNow } from './appModel'

// P974 — Clients, built out (the same data hooks and status rules as the portal's Clients page). On top: three
// summary tiles (Needs attention · Working · Protected) that filter the list when tapped, and a search. Then the
// list in groups, most urgent first: Needs attention, Working, Protected; each row in its status colour with the
// name, the carrier and one line on what's happening. Closed ones wait behind "Show closed". It's a sub-screen from
// Account for agents with leads, and the second tab for servicing-only agents (AClientsTab).
const fullName = c => `${c.client_first_name} ${c.client_last_name}`
const ICON = { needs_attention: ShieldAlert, working: Wrench, protected: ShieldCheck }
const SHORT = { needs_attention: 'Need you', working: 'Working', protected: 'Protected' }

function useClientsView() {
  const { data: clients } = useSampleClients()
  const source = useDataSource()
  const settings = useCheckSettings()
  const today = todayFor(source)
  const status = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, today, settings)])), [clients, today, settings])
  const statusOf = c => status.get(c.id)
  const merged = useMemo(() => mergeLists(checkLists(clients, today, settings)), [clients, today, settings])
  return { clients, statusOf, merged, today, settings }
}

function ClientRow({ c, st, today, settings, i }) {
  const app = useApp()
  const stages = stagesOf(c)
  const next = st === 'protected' ? nextCheck(c, today, settings) : null
  const where = [c.carrier_name, c.product_name].filter(Boolean).join(' · ') || 'Policy details to come'
  return (
    <li className={`ma-lead is-${CLIENT_TONE[st] || 'sage'} is-client`} style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
      <button type="button" className="ma-lead-open" onClick={() => app.open(paths.client(c.id))}>
        <Ini name={fullName(c)} size={44} />
        <span className="ma-grow"><b>{fullName(c)}</b><small className="is-when">{where}</small><small className="ma-clip2">{clientNow(c, st, stages, next)}</small></span>
      </button>
      <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
    </li>
  )
}

function ClientsBody({ tab = false }) {
  const loc = useLocation()
  const { clients, statusOf, merged, today, settings } = useClientsView()
  const [f, setF] = useState(loc.state?.cf === 'need' ? 'needs_attention' : 'all')
  const [q, setQ] = useState('')
  const [closed, setClosed] = useState(false)
  // Home's "Pick" lands here with cf: 'need'; as a tab this screen is already up, so follow each new arrival.
  const cf = loc.state?.cf
  const [seenKey, setSeenKey] = useState(loc.key)
  if (seenKey !== loc.key) { setSeenKey(loc.key); if (cf === 'need') setF('needs_attention') }
  const count = k => clients.filter(c => statusOf(c) === k).length
  const groups = groupClients(clients, statusOf, { f, q, closed })
  const nClosed = count('closed')
  const searching = !!q.trim()
  return (
    <>
      <div className="ma-csum ma-rise" style={rise(0)} role="group" aria-label="Filter by status">
        {CLIENT_GROUPS.map(([k, label]) => {
          const Icon = ICON[k]
          const on = f === k
          return (
            <button key={k} type="button" aria-pressed={on} aria-label={`${label}: ${count(k)}${on ? ', showing only these' : ''}`}
              className={`ma-csum-t is-${CLIENT_TONE[k]} ma-press${on ? ' is-on' : ''}${f !== 'all' && !on ? ' is-dim' : ''}`} onClick={() => setF(on ? 'all' : k)}>
              <Icon size={17} aria-hidden="true" />
              <b>{count(k)}</b>
              <small>{SHORT[k]}</small>
            </button>
          )
        })}
      </div>
      <label className="ma-search is-small ma-rise" style={rise(1)}><Search size={18} aria-hidden="true" /><input type="search" aria-label="Find a client" placeholder="Name, phone or carrier" value={q} onChange={e => setQ(e.target.value)} />{q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}</label>
      {f !== 'all' && <button type="button" className="ma-link-btn is-left" onClick={() => setF('all')}>Show all clients</button>}

      {merged.rows.length > 0 && (f === 'all' || f === 'needs_attention') && !searching && <div className="ma-checkwrap"><CheckCard key={merged.drafts.join()} m={merged} /></div>}

      {groups.map(g => (
        <section key={g.key} className="ma-cgroup" aria-label={g.label}>
          <p className="ma-cap is-out"><i className={`ma-dot is-${g.tone}`} aria-hidden="true" />{g.label}<span>{g.items.length}</span></p>
          <ul className="ma-cards">
            {g.items.map((c, i) => <ClientRow key={c.id} c={c} st={g.key} today={today} settings={settings} i={i} />)}
          </ul>
        </section>
      ))}
      {!groups.length && <p className="ma-empty is-glass">{searching ? 'No clients match.' : f === 'needs_attention' ? 'Nothing to check. Every policy is confirmed on the books.' : clients.length ? 'No clients here right now.' : tab ? 'Your clients show here once you add them or sell a policy.' : 'No clients yet.'}</p>}
      {nClosed > 0 && f === 'all' && <button type="button" className="ma-pillbtn ma-press" onClick={() => setClosed(!closed)}>{closed ? 'Hide closed' : `Show closed (${nClosed})`}</button>}
    </>
  )
}

const actions = setPanel => (
  <span className="ma-sub-acts">
    <button type="button" className="ma-round is-soft ma-press" aria-label="Add clients" onClick={() => setPanel('add')}><UserPlus size={19} aria-hidden="true" /></button>
    <button type="button" className="ma-round is-soft ma-press" aria-label="Add a note to a client" onClick={() => setPanel('note')}><StickyNote size={19} aria-hidden="true" /></button>
  </span>
)
const lineOf = clients => `${clients.length} client${clients.length === 1 ? '' : 's'} · our team works them`

// From Account (agents with a lead product).
export function AClients() {
  const { data: clients } = useSampleClients()
  const [panel, setPanel] = useState(null)
  return (
    <SubPage big title="Clients" line={lineOf(clients)} right={actions(setPanel)} className="is-clients">
      <ClientsBody />
      <AddClients open={panel === 'add'} onClose={() => setPanel(null)} />
      <AddNote open={panel === 'note'} onClose={() => setPanel(null)} />
    </SubPage>
  )
}

// The second tab, for servicing-only agents.
export function AClientsTab() {
  const { data: clients } = useSampleClients()
  const [panel, setPanel] = useState(null)
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise">
        <span className="ma-grow"><h1>Clients</h1><small>{lineOf(clients)}</small></span>
        {actions(setPanel)}
      </div>
      <ClientsBody tab />
      <AddClients open={panel === 'add'} onClose={() => setPanel(null)} />
      <AddNote open={panel === 'note'} onClose={() => setPanel(null)} />
    </div>
  )
}
