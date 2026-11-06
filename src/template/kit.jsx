import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X, Check } from 'lucide-react'
import { useStretchPill } from '../hooks/useStretchPill'
import { hueFor } from './avatarHue'
import { useExit } from './motion'

// Small pieces every template screen shares. Drawers, modals and the note are portaled to document.body: the
// page ease-in wrapper keeps a transform, which would pin position: fixed to the wrapper instead of the window.

const ToastCtx = createContext(() => {})
export const useNote = () => useContext(ToastCtx)

// Who is signed in. At /template it's the sample agent and nothing leaves the browser; at the real agent URLs
// AgentShell passes the real name, the real sign-out and the existing delete-account dialog (live: true).
const SAMPLE_ACCOUNT = { live: false, name: 'Dana Whitfield', signOut: null, DeleteDialog: null }
const AccountCtx = createContext(SAMPLE_ACCOUNT)
export const useAccount = () => useContext(AccountCtx)
export function AccountProvider({ value, children }) {
  return <AccountCtx.Provider value={value || SAMPLE_ACCOUNT}>{children}</AccountCtx.Provider>
}

export function NoteProvider({ children }) {
  const [note, setNote] = useState(null)
  const show = useCallback(text => setNote({ text, k: Date.now() }), [])
  useEffect(() => {
    if (!note) return undefined
    const t = setTimeout(() => setNote(null), 3200)
    return () => clearTimeout(t)
  }, [note])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {note && createPortal(<div className="tp tp-note-toast" role="status" key={note.k}><Check size={16} aria-hidden="true" />{note.text}</div>, document.body)}
    </ToastCtx.Provider>
  )
}

export function Drawer({ open, onClose, center = false, title: t, sub: s, children: c, footer: f }) {
  const [shown, leaving] = useExit(open)
  // While it plays out it keeps showing what it showed while open (callers often clear that state on close). Kept
  // with React's "adjust state during render" pattern: it re-renders at once with the same props, so it settles.
  const [held, setHeld] = useState({ t, s, c, f })
  if (open && (held.t !== t || held.s !== s || held.c !== c || held.f !== f)) setHeld({ t, s, c, f })
  const { t: title, s: sub, c: children, f: footer } = open ? { t, s, c, f } : held
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!shown) return null
  return createPortal(
    <div className={`tp tp-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="tp-scrim tp-bare" aria-label="Close" tabIndex={leaving ? -1 : undefined} onClick={onClose} />
      <section className={`tp-sheet ov-card${center ? ' is-center' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="tp-sheet-h">
          <div className="tp-grow"><h2 className="tp-h2">{title}</h2>{sub && <p className="tp-sub">{sub}</p>}</div>
          {/* The record drawer's round X: turns a quarter on hover (flow.css .fx-x) */}
          <button type="button" className="fx-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="tp-sheet-b">{children}</div>
        {footer && <footer className="tp-sheet-f">{footer}</footer>}
      </section>
    </div>,
    document.body,
  )
}

export const initials = name => name.split(' ').map(w => w[0]).slice(0, 2).join('')
// tone: a lead's or client's current stage tone (P843); without it the person's stable palette colour (P842).
export const Avatar = ({ name, tone }) => <span className={`tp-av av-${hueFor(name, tone)}${tone ? ' is-status' : ''}`} aria-hidden="true">{initials(name)}</span>
export const Chip = ({ tone = 'blue', children }) => <span className={`tp-chip is-${tone}`}><i />{children}</span>
export const SampleTag = ({ children = 'Sample price' }) => <span className="tp-tag">{children}</span>
export const Money = ({ v, cents = true, size = '' }) => (
  <span className={`tp-money ${size}`}>{`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`}</span>
)
// Legal, terms, privacy and consent wording is never written here: it stays a visible placeholder.
export const Pending = ({ children = 'Consent wording pending' }) => <p className="tp-pending">{children}</p>

// P842: the one tab / segmented control. Every tab group in the shell renders through it (top bar, Leads, Activity,
// Calendar, Settings, Billing and plan toggles, Clients status, the day and result pickers), so they all share the
// same stretch (useStretchPill) and the same selected colour (flow.css P842 .fx-pt.is-on).
//   items: [{ key, label, count?, to?, icon?, className?, extra?, title? }]
//   as: 'nav' renders router links (aria-current); otherwise buttons with role tab (or radio when role="radiogroup").
export function PillTabs({ items, value, onChange, label, className = '', itemClass = '', role = 'tablist', as, persistKey, innerRef }) {
  const ownRef = useRef(null)
  const ref = innerRef || ownRef
  useStretchPill(ref, { activeKey: value, selector: '.is-on', persistKey })
  const cls = o => `fx-pt ${itemClass} ${o.className || ''}${value === o.key ? ' is-on on' : ''}`.replace(/\s+/g, ' ').trim()
  const inner = o => <>{o.icon && <o.icon size={15} aria-hidden="true" />}{o.label}{o.count != null && <b className="fx-pt-n">{o.count}</b>}{o.extra}</>
  if (as === 'nav') {
    return (
      <nav className={className} ref={ref} aria-label={label}>
        {items.map(o => <Link key={o.key} to={o.to} className={cls(o)} aria-current={value === o.key ? 'page' : undefined}>{inner(o)}</Link>)}
      </nav>
    )
  }
  const radio = role === 'radiogroup'
  return (
    <div className={className} ref={ref} role={role} aria-label={label}>
      {/* P843: every item stays a <button>, selected or not. Swapping the selected one to a <span> (P842) made React
          replace the element on every click, so the hook lost the old pill's position and nothing flew. The selected
          one is disabled: there is nothing to do on it, as with the old span. */}
      {items.map(o => {
        const on = value === o.key
        return (
          <button key={o.key} type="button" role={radio ? 'radio' : 'tab'} title={o.title}
            {...(radio ? { 'aria-checked': on } : { 'aria-selected': on })} className={cls(o)} disabled={on} onClick={on ? undefined : () => onChange(o.key)}>
            {inner(o)}
          </button>
        )
      })}
    </div>
  )
}

export function Seg({ options, value, onChange, label, className = '', role }) {
  return <PillTabs items={options} value={value} onChange={onChange} label={label} role={role} className={`tp-seg ${className}`.trim()} />
}

export function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`tp-switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}><span /></button>
}

export function Field({ label, children, hint }) {
  return <label className="tp-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export function Empty({ title, sub }) {
  return <div className="tp-empty"><b>{title}</b><span>{sub}</span></div>
}
