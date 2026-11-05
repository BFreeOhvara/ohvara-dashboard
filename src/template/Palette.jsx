import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, Users, PhoneIncoming, FileText, LayoutGrid, ChevronRight, CornerDownLeft } from 'lucide-react'
import { useSampleClients, useSampleLeads } from './data'
import { stageChip } from './LeadOutcome'
import { stageLabel } from './stages'
import { paths } from './paths'

// The search palette: Ctrl/⌘K or the rail's Search. Centred over a dimmed, blurred page; results grouped
// (Clients, Leads, Policies, Pages) with the typed letters marked. Keyboard first: ↑ ↓ to move, Enter to open, Esc.
const GROUPS = [['clients', 'Clients', Users], ['leads', 'Leads', PhoneIncoming], ['policies', 'Policies', FileText], ['pages', 'Pages', LayoutGrid]]

function Mark({ text, q }) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

// `rows` (optional): { clients, leads, policies } already shaped as palette rows, for a shell with real data
// (the Fulfillment shell, src/fulshell). Without it the sample clients and leads are searched.
export default function Palette({ onClose, pages, rows: given = null, placeholder = 'Search clients, leads, policies, pages' }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const navigate = useNavigate()
  const input = useRef(null)
  const list = useRef(null)
  const { data: clients } = useSampleClients()
  const { data: leads } = useSampleLeads()

  const n = q.trim().toLowerCase()
  const groups = useMemo(() => {
    const all = given ? { clients: [], leads: [], policies: [], ...given, pages: pages.map(p => ({ id: `g-${p.label}`, name: p.label, sub: 'Page', hay: p.label, go: p.to })) } : {
      clients: clients.map(c => ({ id: `c-${c.id}`, name: `${c.client_first_name} ${c.client_last_name}`, sub: `${stageLabel[c.stage][1]} · ${c.client_phone}`, hay: `${c.client_first_name} ${c.client_last_name} ${c.client_phone} ${c.city}`, go: () => paths.client(c.id) })),
      leads: leads.map(l => ({ id: `l-${l.id}`, name: `${l.first_name} ${l.last_name}`, sub: `${stageChip(l.stage)[1]} · ${l.city}, ${l.state}`, hay: `${l.first_name} ${l.last_name} ${l.phone} ${l.city}`, go: () => paths.lead(l.id) })),
      policies: clients.map(c => ({ id: `p-${c.id}`, name: c.policy_number, sub: `${c.carrier_name} · ${c.client_first_name} ${c.client_last_name}`, hay: `${c.policy_number} ${c.carrier_name} ${c.client_last_name}`, go: () => paths.client(c.id) })),
      pages: pages.map(p => ({ id: `g-${p.label}`, name: p.label, sub: 'Page', hay: p.label, go: p.to })),
    }
    return GROUPS.map(([key, label, Icon]) => {
      const rows = all[key].filter(r => !n || r.hay.toLowerCase().includes(n))
      return { key, label, Icon, rows: n ? rows.slice(0, 5) : rows.slice(0, key === 'pages' ? 6 : 3) }
    }).filter(g => g.rows.length).reduce((out, g) => {
      const start = out.reduce((c, x) => c + x.rows.length, 0)
      return [...out, { ...g, rows: g.rows.map((r, i) => ({ ...r, n: start + i })) }]
    }, [])
  }, [clients, leads, pages, n, given])
  const flat = groups.flatMap(g => g.rows)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { list.current?.querySelector('.is-at')?.scrollIntoView({ block: 'nearest' }) }, [at])

  const pick = r => { onClose(); navigate(r.go()) }
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => (flat.length ? (i + 1) % flat.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => (flat.length ? (i - 1 + flat.length) % flat.length : 0)) }
    else if (e.key === 'Enter' && flat[at]) { e.preventDefault(); pick(flat[at]) }
  }
  return createPortal(
    <div className="tp fx-layer fx-pal-layer" role="presentation" onKeyDown={onKey}>
      <button type="button" className="fx-scrim tp-bare" aria-label="Close search" tabIndex={-1} onClick={onClose} />
      <section className="fx-pal" role="dialog" aria-modal="true" aria-label="Search">
        <label className="fx-pal-in">
          <Search size={18} aria-hidden="true" />
          <input ref={input} value={q} onChange={e => { setQ(e.target.value); setAt(0) }} placeholder={placeholder} aria-label="Search" role="combobox" aria-expanded="true" aria-controls="fx-pal-list" aria-activedescendant={flat[at] ? `fx-r-${flat[at].id}` : undefined} />
          <button type="button" className="fx-kbd" onClick={onClose}>esc</button>
        </label>
        <div className="fx-pal-list" id="fx-pal-list" role="listbox" ref={list}>
          {groups.map(g => (
            <div key={g.key} className="fx-pal-g" role="group" aria-label={g.label}>
              <h4>{g.label}</h4>
              {g.rows.map(r => {
                const mine = r.n
                return (
                  <button key={r.id} id={`fx-r-${r.id}`} type="button" role="option" aria-selected={mine === at} className={`fx-pal-r${mine === at ? ' is-at' : ''}`} onMouseMove={() => setAt(mine)} onClick={() => pick(r)}>
                    <span className="fx-pal-ic"><g.Icon size={16} aria-hidden="true" /></span>
                    <span className="tp-grow"><b><Mark text={r.name} q={n} /></b><small><Mark text={r.sub} q={n} /></small></span>
                    {mine === at ? <CornerDownLeft size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          ))}
          {flat.length === 0 && <p className="fx-pal-none">No match for “{q.trim()}”. Try a last name, phone or policy number.</p>}
        </div>
        <footer className="fx-pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
      </section>
    </div>,
    document.body,
  )
}
