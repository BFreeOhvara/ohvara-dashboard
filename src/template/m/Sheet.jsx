import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { useExit } from '../motion'

// P908 — phone sheets. Sheet: a full-screen page that slides up (what a desktop drawer becomes on a phone), with a
// close at the top-left, the title in the middle and its buttons pinned at the bottom above the home bar.
// ActionSheet: a short sheet from the bottom for a pick (a status, a create action), every row 56 px.
function useEsc(open, onClose) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const html = document.documentElement
    const was = html.style.overflow
    html.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); html.style.overflow = was }
  }, [open, onClose])
}

export function Sheet({ open, onClose, title, kicker, tone, footer, children }) {
  const [shown, leaving] = useExit(open)
  useEsc(open, onClose)
  if (!shown) return null
  return createPortal(
    <div className={`tp fx mx-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <section className={`mx-sheet${tone ? ` is-${tone}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mx-sheet-h">
          <button type="button" className="mx-ib" aria-label="Close" onClick={onClose}><ChevronDown size={24} aria-hidden="true" /></button>
          <span className="mx-sheet-t">{kicker && <small>{kicker}</small>}<b>{title}</b></span>
          <span className="mx-ib-gap" aria-hidden="true" />
        </header>
        <div className="mx-sheet-b">{children}</div>
        {footer && <footer className="mx-sheet-f">{footer}</footer>}
      </section>
    </div>,
    document.body,
  )
}

export function ActionSheet({ open, onClose, title, sub, children }) {
  const [shown, leaving] = useExit(open)
  useEsc(open, onClose)
  if (!shown) return null
  return createPortal(
    <div className={`tp fx mx-layer is-short${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="mx-scrim" aria-label="Close" onClick={onClose} />
      <section className="mx-act" role="dialog" aria-modal="true" aria-label={title}>
        <i className="mx-grab" aria-hidden="true" />
        <header className="mx-act-h"><span className="tp-grow"><b>{title}</b>{sub && <small>{sub}</small>}</span><button type="button" className="mx-ib" aria-label="Close" onClick={onClose}><X size={20} aria-hidden="true" /></button></header>
        <div className="mx-act-b">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

// One row in an ActionSheet: an icon or a tone dot, a label and a one-line meaning.
export function ActRow({ icon: Icon, tone, label, sub, onClick, href, disabled }) {
  const inner = <>
    {Icon ? <span className="mx-act-ic"><Icon size={20} aria-hidden="true" /></span> : <span className={`mx-dot is-${tone}`} aria-hidden="true" />}
    <span className="tp-grow"><b>{label}</b>{sub && <small>{sub}</small>}</span>
  </>
  if (href) return <a className="mx-act-row" href={href} onClick={onClick}>{inner}</a>
  return <button type="button" className={`mx-act-row${tone ? ` is-${tone}` : ''}`} disabled={disabled} onClick={onClick}>{inner}</button>
}
