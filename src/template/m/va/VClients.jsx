import { useMemo, useRef, useState } from 'react'
import { Search, X, Archive, CalendarClock, ChevronRight } from 'lucide-react'
import { useFulClients, useFulClock, useFulSchedule } from '../../ful/data'
import { clientStatusOf, clientStatus, STATUS_ORDER, CLIENT_STATUS, requestTag } from '../../../lib/clientCheck.js'
import { stagesOf } from '../../../lib/clientStages.js'
import { whyShort } from '../../ful/callSteps'
import { useApp, SubPage, Ini, Toggle, rise } from '../AppKit'
import { useNoAutoKeyboard } from '../useKeyboard'
import { CLIENT_TONE, dayWords } from '../appModel'
import { useVaNow, dayOfItem } from './useVaNow'

// P1002 — Clients, on the phone (the desktop's Clients page, ful/screens/Clients.jsx): every client across the agents
// this VA serves. A search ("Find a client, phone, policy…"), the status pills with their counts (All · Needs attention
// · Working · Protected), and Show closed (Closed is its own switch, hidden until it's on). Each card shows the
// client's status, where they stand and their next booked call; tap one to open the client.
const SHORT = { needs_attention: 'Needs attention', working: 'Working', protected: 'Protected', closed: 'Closed' }

function useClientStatuses() {
  const { data: clients } = useFulClients()
  const { today, isoOf } = useFulClock()
  const day = isoOf(today)
  const st = useMemo(() => new Map(clients.map(c => [c.id, clientStatusOf(c, day)])), [clients, day])
  return { clients, day, st }
}

// The next call still ahead for each client (a cancel-the-old-policy call or a booked servicing call), from the VA's schedule.
function useNextCalls() {
  const { data: all } = useFulSchedule()
  const { nowMs, tz, todayIso } = useVaNow()
  return useMemo(() => {
    const m = {}
    for (const i of all) {
      const cid = i.row?.client_id || i.row?.client?.id
      const at = Date.parse(i.iso || '')
      if (!cid || i.done || !Number.isFinite(at) || at < nowMs) continue
      if (!m[cid] || at < m[cid].at) m[cid] = { at, text: `${dayWords(dayOfItem(i, tz), todayIso).replace(/^\w+, /, '')} ${i.time}`, word: whyShort(i) }
    }
    return m
  }, [all, nowMs, tz, todayIso])
}

function standOf(c, st) {
  const stage = st === 'working' ? stagesOf(c) : null
  if (stage) return stage.current ? `Stage ${stage.at} of ${stage.of} · ${stage.current.label}` : stage.label
  return requestTag(c) || clientStatus(st).sub
}

export default function VClients() {
  const app = useApp()
  const { clients, st } = useClientStatuses()
  const next = useNextCalls()
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('all')
  const [showClosed, setShowClosed] = useState(false)
  const input = useRef(null)
  useNoAutoKeyboard(input)
  const setClosed = on => { setShowClosed(on); setStage(on ? 'closed' : 'all') }
  const shown = clients.filter(c => showClosed || st.get(c.id) !== 'closed')
  const t = q.trim().toLowerCase()
  const rows = shown.filter(c => (stage === 'all' || st.get(c.id) === stage) && `${c.name} ${c.policy_number} ${c.client_phone} ${c.agent}`.toLowerCase().includes(t))
  const count = s => clients.filter(c => st.get(c.id) === s).length
  const keys = showClosed ? [...STATUS_ORDER, 'closed'] : STATUS_ORDER
  const options = [{ key: 'all', label: 'All', n: shown.length }, ...keys.map(k => ({ key: k, label: SHORT[k], n: count(k), title: CLIENT_STATUS[k].sub }))]
  return (
    <SubPage title="Clients" line={`${shown.length} client${shown.length === 1 ? '' : 's'} across your agents`} big>
      <label className="ma-search ma-rise"><Search size={18} aria-hidden="true" />
        <input ref={input} type="search" inputMode="search" aria-label="Find a client" placeholder="Find a client, phone, policy…" value={q} onChange={e => setQ(e.target.value)} />
        {q && <button type="button" className="ma-ib" aria-label="Clear" onClick={() => setQ('')}><X size={18} aria-hidden="true" /></button>}
      </label>
      <div className="va-chips va-statuspills ma-rise" style={rise(0)} role="group" aria-label="Status">
        {options.map(o => (
          <button key={o.key} type="button" aria-pressed={stage === o.key} title={o.title} className={`ma-chip va-tap ma-press${stage === o.key ? ' is-solid' : ''}`} onClick={() => setStage(o.key)}>
            {o.label}<span className="va-pillcount">{o.n}</span>
          </button>
        ))}
      </div>
      <div className="ma-glass va-closedrow ma-rise" style={rise(1)}>
        <span className="ma-sym is-stone"><Archive size={16} aria-hidden="true" /></span>
        <span className="ma-grow"><b>Show closed</b></span>
        <Toggle small on={showClosed} label="Show closed clients" onChange={setClosed} />
      </div>

      <ul className="ma-cards va-clist">
        {rows.map((c, i) => {
          const s = st.get(c.id)
          const nx = next[c.id]
          return (
            <li key={c.id} className={`ma-lead is-${CLIENT_TONE[s] || 'sage'} is-client`} style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
              <button type="button" className="ma-lead-open" aria-label={`Open ${c.name}, ${SHORT[s]}`} onClick={() => app.openSub('client', { c: c.id })}>
                <Ini name={c.name} size={44} />
                <span className="ma-grow">
                  <span className="va-crow"><b>{c.name}</b><em className="va-tag">{SHORT[s]}</em></span>
                  <small className="is-when">{[c.carrier_name, [c.city, c.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Policy details to come'}</small>
                  <small className="ma-clip2">{standOf(c, s)}</small>
                  <small className="va-cnext"><CalendarClock size={13} aria-hidden="true" />{nx ? `${nx.word} · ${nx.text}` : 'Nothing booked'} · {c.agent}</small>
                </span>
              </button>
              <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
            </li>
          )
        })}
      </ul>
      {!rows.length && <p className="ma-empty is-glass ma-rise">No clients match. Check the spelling, or show every status.</p>}
    </SubPage>
  )
}
