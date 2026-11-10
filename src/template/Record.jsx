import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { still } from './motion'

// The record drawer: a lead or a client opens from the right at its own URL, the page behind dims and blurs.
// Hero card, stage stepper, details, timeline, and the actions pinned at the bottom. Esc or ✕ closes; onClose
// puts the URL back. On a phone it is a full-height sheet.
export function RecordDrawer({ label, kicker, hero, stepper, children, actions, onClose, tone = 'blue' }) {
  const [leaving, setLeaving] = useState(false)
  const panel = useRef(null)
  const close = useCallback(() => {
    if (still()) { onClose(); return }
    setLeaving(true)
    setTimeout(onClose, 220) // P914: the shared drawer play-out (shell914.css)
  }, [onClose])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    panel.current?.focus({ preventScroll: true })
    const html = document.documentElement
    const was = html.style.overflow
    html.style.overflow = 'hidden'
    // The page behind can't be clicked or tabbed to while the drawer is open (the drawer lives outside it).
    const app = document.getElementById('root')
    app?.setAttribute('inert', '')
    return () => { window.removeEventListener('keydown', onKey); html.style.overflow = was; app?.removeAttribute('inert') }
  }, [close])
  return createPortal(
    <div className={`tp fx-layer fx-rec-layer${leaving ? ' is-leaving' : ''}`} role="presentation">
      <button type="button" className="fx-scrim tp-bare" aria-label="Close" tabIndex={-1} onClick={close} />
      <section ref={panel} tabIndex={-1} className={`fx-rec is-${tone}`} role="dialog" aria-modal="true" aria-label={label}>
        <header className="fx-rec-h">
          <span className="fx-rec-k">{kicker}</span>
          <button type="button" className="fx-x" aria-label="Close" onClick={close}><X size={18} /></button>
        </header>
        <div className="fx-rec-b">
          <div className={`fx-hero-card is-${tone}`}>{hero}</div>
          {stepper}
          {children}
        </div>
        {actions && <footer className="fx-rec-f">{actions}</footer>}
      </section>
    </div>,
    document.body,
  )
}

// Clickable stage chips, in order. Steps before the current one read as done.
export function Stepper({ steps, current, onPick, label }) {
  const at = steps.findIndex(s => s.key === current)
  return (
    <div className="fx-steps" role="group" aria-label={label}>
      {steps.map((s, i) => (s.key === current
        ? <span key={s.key} className="fx-step is-on" aria-current="step">{s.label}</span>
        : <button key={s.key} type="button" className={`fx-step${i < at ? ' is-done' : ''}${s.tone ? ` is-res is-${s.tone}` : ''}`} onClick={() => onPick(s.key)}>{s.label}</button>))}
    </div>
  )
}

// A small labelled block inside the drawer.
export function Block({ title, sub, children, aside }) {
  return (
    <section className="fx-blk">
      <header><h3>{title}</h3>{aside}</header>
      {sub && <p className="tp-sub">{sub}</p>}
      {children}
    </section>
  )
}
