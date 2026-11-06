import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './select.css'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useExit } from './motion'
import { dayOptions, timeOptions } from './selectOptions'

// P847 — the one dropdown for both shells (agent and fulfillment). Replaces every native <select>, <datalist> and
// date/time picker: a glass menu under the field on a desktop, a bottom sheet on a phone, the shell's spring motion.
// Keyboard: Up/Down/Home/End move, Enter or Space picks, Escape closes, typing jumps (or filters when there's a search
// box). Screen readers get a listbox with options and the active one announced (aria-activedescendant).
//   options: strings, or [{ value, label, sub? }]
//   search: a search box at the top (on for long lists by default, over 8 options)
//   allowCustom: a combobox: whatever is typed can be used as the value ("Use 'Acme Life'"), e.g. a carrier not listed
const PHONE = 640
const norm = o => (typeof o === 'object' && o !== null ? { value: o.value, label: o.label ?? String(o.value), sub: o.sub } : { value: o, label: String(o) })

export function Select({ value, onChange, options, label, placeholder = 'Pick one', search, allowCustom = false, disabled = false, className = '', invalid = false, id }) {
  const list = useMemo(() => options.map(norm), [options])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activeRaw, setActive] = useState(0)
  const [at, setAt] = useState(null)
  const btn = useRef(null)
  const box = useRef(null)
  const findRef = useRef(null)
  const typed = useRef({ text: '', t: 0 })
  const uid = useId()
  const listId = `${uid}-list`
  const showSearch = search ?? (allowCustom || list.length > 8)
  const [shown, leaving] = useExit(open, 180)

  const n = q.trim().toLowerCase()
  const rows = useMemo(() => {
    const hit = n ? list.filter(o => `${o.label} ${o.sub || ''}`.toLowerCase().includes(n)) : list
    if (allowCustom && n && !list.some(o => o.label.toLowerCase() === n)) return [...hit, { value: q.trim(), label: `Use "${q.trim()}"`, custom: true }]
    return hit
  }, [list, n, q, allowCustom])
  const active = Math.min(activeRaw, Math.max(0, rows.length - 1))
  const current = list.find(o => o.value === value)
  const shownText = current ? current.label : (allowCustom && value ? String(value) : '')

  const place = useCallback(() => {
    const el = btn.current
    if (!el) return
    if (window.innerWidth < PHONE) { setAt(null); return }
    const r = el.getBoundingClientRect()
    const want = Math.min(340, 56 + Math.min(rows.length || 1, 7) * 46 + (showSearch ? 54 : 0))
    const below = window.innerHeight - r.bottom - 12
    const up = below < Math.min(want, 220) && r.top > below
    setAt({ left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 240) - 8))), width: Math.round(Math.max(r.width, 240)), ...(up ? { bottom: Math.round(window.innerHeight - r.top + 6), maxHeight: Math.round(Math.min(340, r.top - 12)) } : { top: Math.round(r.bottom + 6), maxHeight: Math.round(Math.min(340, Math.max(180, below))) }), up })
  }, [rows.length, showSearch])

  const openIt = () => {
    if (disabled) return
    const i = list.findIndex(o => o.value === value)
    setQ('')
    setActive(i < 0 ? 0 : i)
    place()
    setOpen(true)
  }
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) btn.current?.focus() }, [])
  const choose = o => { if (!o) return; onChange(o.value); close() }

  // Focus the search box (or the list) once it opens; keep the menu under the field when the page moves.
  useLayoutEffect(() => {
    if (!open) return undefined
    ;(showSearch ? findRef.current : box.current)?.focus({ preventScroll: true })
    const onMove = () => place()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => { window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true) }
  }, [open, showSearch, place])
  useEffect(() => {
    if (!open) return
    box.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKey = e => {
    const last = rows.length - 1
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(last, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Home' && !showSearch) { e.preventDefault(); setActive(0) }
    else if (e.key === 'End' && !showSearch) { e.preventDefault(); setActive(last) }
    else if (e.key === 'Enter' || (e.key === ' ' && !showSearch)) { e.preventDefault(); choose(rows[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') close(false)
    else if (!showSearch && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      // Type-ahead: jump to the first option starting with what was typed in the last half second.
      const now = Date.now()
      typed.current = { text: (now - typed.current.t < 500 ? typed.current.text : '') + e.key.toLowerCase(), t: now }
      const i = rows.findIndex(o => o.label.toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setActive(i)
    }
  }
  const onBtnKey = e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openIt() }
  }

  const phone = !at
  const optId = i => `${uid}-o${i}`
  return (
    <>
      <button type="button" ref={btn} id={id} className={`fx-sel${invalid ? ' tp-danger' : ''}${open ? ' is-open' : ''} ${className}`.trim()} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={label ? `${label}: ${shownText || placeholder}` : undefined}
        onClick={() => (open ? close() : openIt())} onKeyDown={onBtnKey}>
        <span className={`fx-sel-v${shownText ? '' : ' is-ph'}`}>{shownText || placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" className="fx-sel-chev" />
      </button>
      {shown && createPortal(
        <div className={`tp fx-layer fx-sel-layer${phone ? ' is-phone' : ''}${leaving ? ' is-leaving' : ''}`} role="presentation">
          <button type="button" className={`fx-scrim tp-bare${phone ? '' : ' is-clear'}`} aria-label="Close list" tabIndex={-1} onClick={() => close()} />
          <div className={`fx-menu fx-selmenu${at?.up ? ' is-up' : ''}`} style={at ? { left: at.left, width: at.width, top: at.top, bottom: at.bottom, maxHeight: at.maxHeight } : undefined}>
            {phone && <p className="fx-selmenu-h">{label || placeholder}</p>}
            {showSearch && (
              <label className="fx-selfind"><Search size={15} aria-hidden="true" />
                <input ref={findRef} value={q} onChange={e => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder={allowCustom ? 'Search or type a name' : 'Search'}
                  role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={rows[active] ? optId(active) : undefined} aria-label={`Search ${label || 'the list'}`} autoComplete="off" />
              </label>
            )}
            <ul ref={box} id={listId} className="fx-sellist" role="listbox" aria-label={label || placeholder} tabIndex={showSearch ? -1 : 0}
              aria-activedescendant={!showSearch && rows[active] ? optId(active) : undefined} onKeyDown={showSearch ? undefined : onKey}>
              {rows.map((o, i) => {
                const on = !o.custom && o.value === value
                return (
                  <li key={`${o.custom ? 'c-' : ''}${o.value}`} id={optId(i)} data-i={i} role="option" aria-selected={on}
                    className={`fx-selopt${i === active ? ' is-active' : ''}${on ? ' is-on' : ''}${o.custom ? ' is-custom' : ''}`}
                    style={{ '--i': Math.min(i, 8) }} onMouseMove={() => i !== active && setActive(i)} onClick={() => choose(o)}>
                    <span className="tp-grow"><b>{o.label}</b>{o.sub && <small>{o.sub}</small>}</span>
                    {on && <Check size={15} aria-hidden="true" />}
                  </li>
                )
              })}
              {rows.length === 0 && <li className="fx-selnone" role="presentation">Nothing matches "{q.trim()}"</li>}
            </ul>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

// A day and a time, both as dropdowns (replaces <input type="datetime-local">). value / onChange use the same
// 'YYYY-MM-DDTHH:mm' local string the native input gave, so callers keep `new Date(value)`.
export function DayTimeSelect({ value, onChange, label = 'When' }) {
  const [day, time] = value ? value.split('T') : ['', '']
  const days = useMemo(() => dayOptions(), [])
  const times = useMemo(() => timeOptions(), [])
  return (
    <div className="fx-daytime">
      <Select label={`${label}, day`} placeholder="Pick a day" value={day} options={days} onChange={d => onChange(`${d}T${time || '09:00'}`)} />
      <Select label={`${label}, time`} placeholder="Pick a time" value={time} options={times} onChange={t => onChange(`${day || days[0].value}T${t}`)} />
    </div>
  )
}
