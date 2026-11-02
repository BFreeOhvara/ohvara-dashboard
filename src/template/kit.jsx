import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check } from 'lucide-react'

// Small pieces every template screen shares. Drawers, modals and the note are portaled to document.body: the
// page ease-in wrapper keeps a transform, which would pin position: fixed to the wrapper instead of the window.

const ToastCtx = createContext(() => {})
export const useNote = () => useContext(ToastCtx)

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
      {options.map(o => (
        <button type="button" role="tab" key={o.key} aria-selected={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}{o.count != null && <b>{o.count}</b>}
        </button>
      ))}
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
