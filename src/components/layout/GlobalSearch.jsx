import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, ArrowRight, CornerDownLeft, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { matchClients, tabOf, agentStageOf, isLive, placeOf } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'
import { callWhen } from '../../lib/scheduling'
import { fullName } from '../../lib/policyFormat'
import { NAV } from '../../lib/nav'
import { StatusPill } from '../agent/AgentUI'

// Header search (Prompt 722). Clients by name / phone / carrier — the same
// rows and matching as My Pipeline's "Find any client" (matchClients) — plus
// "Go to" pages from the role's nav. Ctrl/⌘ K or "/" focuses it from anywhere
// (not while typing in a field; on My Pipeline "/" stays with the page's own
// search). A desktop box from 1024px; below that an icon button that opens it
// as a full-screen sheet. Agents and admins only (DashboardLayout hides it for
// Fulfillment). A client opens in My Pipeline's drawer (?open=).

const MAX_CLIENTS = 6
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const isTyping = el => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
const wide = () => window.matchMedia('(min-width: 1024px)').matches
const monthDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'

// "Call Fri, Oct 9 · 2:30 PM · State Farm · Pensacola, FL", "Tried Oct 7 · Allstate", …
// Prompt 724 — the call time is the client's (client_timezone).
function metaLine(p) {
  const stage = agentStageOf(p)
  const what = stage === 'booked' ? (isLive(p) ? 'On a call now' : `Call ${callWhen(p.scheduled_call_at, p.client_timezone)}`)
    : stage === 'cancelled' ? `Old policy cancelled ${monthDay(p.fulfillment_completed_at || p.updated_at)}`
    : stage === 'confirmNumber' ? 'Confirm the number'
    : stage === 'needsAttention' ? 'Call and rebook'
    : p.last_call_at ? `Tried ${monthDay(p.last_call_at)}` : 'No answer'
  return [what, p.current_carrier, placeOf(p)].filter(Boolean).join(' · ')
}

function Highlight({ text, q }) {
  const i = q ? text.toLowerCase().indexOf(q) : -1
  if (i < 0) return text
  return <>{text.slice(0, i)}<mark className="ov-gs-mark">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export function GlobalSearch() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const role = profile?.role
  const isAdmin = role === 'admin'
  const uid = useId()
  const box = useRef(null)
  const sheetInput = useRef(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [hi, setHi] = useState(0)
  // Admin's company-wide rows only load once the search is first used.
  const [wanted, setWanted] = useState(false)

  const { data: raw = [] } = useAgentBookings(isAdmin ? null : profile?.id, { enabled: !!profile?.id && (!isAdmin || wanted) })
  const rows = useMemo(() => (isAdmin ? excludeTestAccounts(raw, profile?.id) : raw), [raw, isAdmin, profile?.id])

  const q = query.trim().toLowerCase()
  const clients = useMemo(() => matchClients(rows, q).slice(0, MAX_CLIENTS), [rows, q])
  const pages = useMemo(() => (NAV[role] || []).flatMap(g => g.items)
    .map(i => (role === 'agent' && i.to === '/agent/billing' ? { ...i, label: 'Billing · manage plan' } : i))
    .filter(i => !q || i.label.toLowerCase().includes(q)), [role, q])
  const items = [...clients.map(p => ({ kind: 'client', p })), ...pages.map(page => ({ kind: 'page', page }))]
  const active = Math.min(hi, Math.max(0, items.length - 1))

  const open = focused || sheet

  // Ctrl/⌘ K and "/" from anywhere.
  useEffect(() => {
    const onKey = e => {
      const k = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey) && !e.altKey
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && pathname !== '/agent/clients'
      if (!k && !slash) return
      e.preventDefault()
      setWanted(true)
      if (wide()) box.current?.focus()
      else setSheet(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pathname])

  useEffect(() => { if (sheet) sheetInput.current?.focus() }, [sheet])

  const reset = () => { setQuery(''); setHi(0) }
  const close = () => { reset(); setSheet(false); box.current?.blur() }
  const choose = item => {
    close()
    if (item.kind === 'page') { navigate(item.page.to); return }
    const tab = tabOf(item.p)
    navigate(`/agent/clients?open=${item.p.id}${tab === 'booked' ? '' : `&stage=${tab}`}`)
  }
  const onKeyDown = e => {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setHi((active + 1) % items.length) }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setHi((active - 1 + items.length) % items.length) }
    else if (e.key === 'Enter' && items[active]) { e.preventDefault(); choose(items[active]) }
  }
  const onChange = e => { setQuery(e.target.value); setHi(0) }
  const listId = `${uid}-results`
  const optId = i => `${uid}-opt-${i}`

  const combo = {
    type: 'search', value: query, autoComplete: 'off', spellCheck: false,
    placeholder: 'Search clients, pages…', 'aria-label': 'Search clients and pages',
    role: 'combobox', 'aria-expanded': open, 'aria-controls': listId, 'aria-autocomplete': 'list',
    'aria-activedescendant': open && items[active] ? optId(active) : undefined,
    onChange, onKeyDown,
  }

  const results = (
    <div id={listId} role="listbox" aria-label="Search results" className="ov-gs-list">
      {clients.length > 0 && <div className="ov-gs-head" role="presentation">Clients</div>}
      {clients.map((p, i) => {
        const name = fullName(p)
        return (
          <div key={p.id} id={optId(i)} role="option" aria-selected={i === active}
            className={`ov-gs-item${i === active ? ' is-active' : ''}`}
            onMouseDown={e => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(items[i])}>
            <span className="ov-gs-avatar" aria-hidden="true">{initials(name)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="ov-gs-name"><Highlight text={name} q={q} /></span>
              <span className="ov-gs-meta">{metaLine(p)}</span>
            </span>
            <StatusPill tab={tabOf(p)} />
            <CornerDownLeft size={15} strokeWidth={2} className="ov-gs-enter" aria-hidden="true" />
          </div>
        )
      })}
      {clients.length > 0 && pages.length > 0 && <div className="ov-gs-sep" role="presentation" />}
      {pages.length > 0 && <div className="ov-gs-head" role="presentation">Go to</div>}
      {pages.map((page, j) => {
        const i = clients.length + j
        const Icon = page.icon
        return (
          <div key={page.to + page.label} id={optId(i)} role="option" aria-selected={i === active}
            className={`ov-gs-item${i === active ? ' is-active' : ''}`}
            onMouseDown={e => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => choose(items[i])}>
            <span className="ov-gs-page-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
            <span className="ov-gs-name" style={{ flex: 1 }}>{page.label}</span>
            <ArrowRight size={15} strokeWidth={2} className="ov-gs-arrow" aria-hidden="true" />
          </div>
        )
      })}
      {!items.length && <p className="ov-gs-empty">No clients or pages match &ldquo;{query.trim()}&rdquo;</p>}
      <div className="ov-gs-foot hidden lg:flex" aria-hidden="true">
        <span>↑ ↓ to move</span>
        <span>{items[active]?.kind === 'page' ? 'Enter to go' : 'Enter to open in My Pipeline'}</span>
        <span>Esc to close</span>
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden lg:block" style={{ position: 'relative', flexShrink: 0 }}>
        <label className="ov-input ov-gs-box">
          <Search size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
          <input ref={box} {...combo}
            onFocus={() => { setFocused(true); setWanted(true) }}
            onBlur={() => { setFocused(false); reset() }} />
          <kbd className="ov-gs-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </label>
        {focused && <div className="ov-card ov-pop ov-gs-pop">{results}</div>}
      </div>

      <button type="button" className="ov-hbtn ov-narrow-only" aria-label="Search" onClick={() => { setWanted(true); setSheet(true) }}>
        <Search size={18} strokeWidth={1.9} />
      </button>
      {/* Portaled: the header's backdrop blur would otherwise be the
          containing block for this fixed sheet. */}
      {sheet && createPortal(
        <div className="ov-gs-sheet ov-narrow-only" role="dialog" aria-modal="true" aria-label="Search">
          <div className="ov-gs-sheet-bar">
            <label className="ov-input ov-gs-sheet-input">
              <Search size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
              <input ref={sheetInput} {...combo} />
            </label>
            <button type="button" className="ov-hbtn" aria-label="Close search" onClick={close}><X size={18} strokeWidth={1.9} /></button>
          </div>
          <div className="ov-gs-sheet-body">{results}</div>
        </div>,
        document.body
      )}
    </>
  )
}
