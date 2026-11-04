import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check } from 'lucide-react'

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

// Icon buttons: a small spring wiggle on click, and on a desktop mouse a slight pull toward the pointer.
// Both are skipped under reduced motion (the CSS also zeroes the keyframes there).
const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
export function wiggle(e) {
  const el = e.currentTarget
  if (!el || still()) return
  el.classList.remove('is-wig')
  void el.offsetWidth // restart the animation on a quick second click
  el.classList.add('is-wig')
}
export function pull(e) {
  const el = e.currentTarget
  if (!el || still() || e.pointerType !== 'mouse') return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--tp-px', `${((e.clientX - r.left) / r.width - 0.5) * 6}px`)
  el.style.setProperty('--tp-py', `${((e.clientY - r.top) / r.height - 0.5) * 6}px`)
}
export function release(e) {
  e.currentTarget?.style.removeProperty('--tp-px')
  e.currentTarget?.style.removeProperty('--tp-py')
}
export const wig = { onClick: wiggle, onPointerMove: pull, onPointerLeave: release, onAnimationEnd: e => e.currentTarget.classList.remove('is-wig') }

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

export function Drawer({ open, onClose, title, sub, children, footer, center = false }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="tp tp-layer" role="presentation">
      <button type="button" className="tp-scrim tp-bare" aria-label="Close" onClick={onClose} />
      <section className={`tp-sheet ov-card${center ? ' is-center' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="tp-sheet-h">
          <div className="tp-grow"><h2 className="tp-h2">{title}</h2>{sub && <p className="tp-sub">{sub}</p>}</div>
          <button type="button" className="tp-icbtn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="tp-sheet-b">{children}</div>
        {footer && <footer className="tp-sheet-f">{footer}</footer>}
      </section>
    </div>,
    document.body,
  )
}

export const initials = name => name.split(' ').map(w => w[0]).slice(0, 2).join('')
export const Avatar = ({ name, tone = '' }) => <span className={`tp-av ${tone}`} aria-hidden="true">{initials(name)}</span>
export const Chip = ({ tone = 'blue', children }) => <span className={`tp-chip is-${tone}`}><i />{children}</span>
export const SampleTag = ({ children = 'Sample price' }) => <span className="tp-tag">{children}</span>
export const Money = ({ v, cents = true, size = '' }) => (
  <span className={`tp-money ${size}`}>{`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`}</span>
)
// Legal, terms, privacy and consent wording is never written here: it stays a visible placeholder.
export const Pending = ({ children = 'Consent wording pending' }) => <p className="tp-pending">{children}</p>

export function Seg({ options, value, onChange, label }) {
  return (
    <div className="tp-seg" role="tablist" aria-label={label}>
      {options.map(o => (value === o.key ? (
        <span role="tab" key={o.key} aria-selected="true" className="on">{o.label}{o.count != null && <b>{o.count}</b>}</span>
      ) : (
        <button type="button" role="tab" key={o.key} aria-selected="false" onClick={() => onChange(o.key)}>
          {o.label}{o.count != null && <b>{o.count}</b>}
        </button>
      )))}
    </div>
  )
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
