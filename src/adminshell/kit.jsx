import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react'
import { useExit } from '../template/motion'

// P849 — the Admin side's own small pieces, beside the shared kit (src/template/kit.jsx, imported, never edited).

// A tile on the Solvik shape: title, a line under it, an open arrow. Staggered in by --i (flow.css).
export function Tile({ className = '', i = 0, title, sub, to, label, aside, children }) {
  return (
    <section className={`fx-tile ${className}`} style={{ '--i': i }} aria-label={title}>
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</span>
        {aside}
        {to && <Link to={to} className="fx-open" aria-label={label || `Open ${title}`}><ArrowUpRight size={16} /></Link>}
      </header>
      {children}
    </section>
  )
}

// Where the dropdown's list goes: under the button, or above it when there is no room below.
function measure(el, count) {
  const r = el?.getBoundingClientRect()
  if (!r) return null
  const room = window.innerHeight - r.bottom
  const want = Math.min(280, count * 44 + 12)
  const up = room < want + 16 && r.top > room
  const width = Math.max(r.width, 200)
  return { left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width, top: up ? null : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : null, up }
}

// The built-in dropdown: a button and a list that opens under it (above when there is no room), eased in and out,
// with the keyboard a select has (arrows, Home, End, Enter, Escape, a letter jumps). Replaces <select> in the shell.
//   options: [{ value, label, sub? }] or plain strings.
export function Dropdown({ value, options, onChange, label, placeholder = 'Pick one', disabled = false, className = '', id }) {
  const opts = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const list = useRef(null)
  const auto = useId()
  const lid = `${id || auto}-list`
  const [shown, leaving] = useExit(open, 160)
  const cur = opts.find(o => o.value === value)

  const count = opts.length
  const place = () => setPos(measure(btn.current, count))

  const show = () => { if (disabled) return; place(); setAt(Math.max(0, opts.findIndex(o => o.value === value))); setOpen(true) }
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus() }
  const pick = o => { onChange(o.value); close() }

  useLayoutEffect(() => { if (open) list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, at])
  useEffect(() => {
    if (!open) return undefined
    const off = e => { if (!btn.current?.contains(e.target) && !list.current?.contains(e.target)) close(false) }
    const move = () => setPos(measure(btn.current, count))
    window.addEventListener('pointerdown', off, true)
    window.addEventListener('resize', move)
    window.addEventListener('scroll', move, true)
    return () => { window.removeEventListener('pointerdown', off, true); window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true) }
  }, [open, count])

  const onKey = e => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(opts.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setAt(0) }
    else if (e.key === 'End') { e.preventDefault(); setAt(opts.length - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[at]) pick(opts[at]) }
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase()
      const n = opts.findIndex((o, i) => i > at && String(o.label).toLowerCase().startsWith(k))
      const m = n >= 0 ? n : opts.findIndex(o => String(o.label).toLowerCase().startsWith(k))
      if (m >= 0) setAt(m)
    }
  }

  return (
    <>
      <button ref={btn} type="button" id={id} className={`adm-dd${open ? ' is-open' : ''}${cur ? '' : ' is-empty'} ${className}`.trim()} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? lid : undefined} aria-label={label ? `${label}: ${cur ? cur.label : placeholder}` : undefined}
        aria-activedescendant={open ? `${lid}-${at}` : undefined}
        onClick={e => { e.preventDefault(); if (open) close(); else show() }} onKeyDown={onKey}>
        <span className="tp-grow">{cur ? cur.label : placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {shown && pos && createPortal(
        <ul ref={list} id={lid} role="listbox" aria-label={label} className={`tp adm-dd-pop${leaving ? ' is-leaving' : ''}${pos.up ? ' is-up' : ''}`}
          style={{ left: pos.left, width: pos.width, top: pos.top ?? undefined, bottom: pos.bottom ?? undefined }}>
          {opts.map((o, i) => (
            <li key={String(o.value)} id={`${lid}-${i}`} data-i={i} role="option" aria-selected={o.value === value}
              className={`${i === at ? 'is-at' : ''}${o.value === value ? ' is-on' : ''}`.trim() || undefined}
              onPointerEnter={() => setAt(i)} onPointerDown={e => e.preventDefault()} onClick={() => pick(o)}>
              <span className="tp-grow"><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
              {o.value === value && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}

// A labelled field that holds a Dropdown (a <label> around a button would pass clicks twice).
export function DField({ label, hint, children }) {
  return <div className="tp-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>
}

