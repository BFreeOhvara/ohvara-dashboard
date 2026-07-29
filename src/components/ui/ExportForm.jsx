import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { control, fieldLabel, MONO } from '../../lib/exportStyles'

// Field primitives for the pages ported from the approved Claude Design
// export. The raw style objects live in lib/exportStyles.js — re-exporting
// them from here too would break fast refresh (a module may export components
// or constants, not both).

export function Field({ label, children, style }) {
  return (
    <div style={style}>
      <p style={fieldLabel}>{label}</p>
      {children}
    </div>
  )
}

export function TextField({ label, mono, style, ...props }) {
  return (
    <Field label={label}>
      <input {...props} style={{ ...control, ...(mono ? { fontFamily: MONO } : null), ...style }} />
    </Field>
  )
}

export function SelectField({ label, children, style, ...props }) {
  return (
    <Field label={label}>
      <select {...props} style={{ ...control, padding: '0 8px', ...style }}>{children}</select>
    </Field>
  )
}

// Prompt 387: a native <select>'s open direction is chosen by the browser,
// and that heuristic isn't "is there room below" — it's closer to "which
// half of the viewport is the trigger in." A select low on a long form
// (e.g. New Submission's State field, several rows down) pops upward and
// covers the page above it even when the page has plenty of room below —
// there's no CSS to override a native select's popup direction. This is a
// real DOM dropdown standing in for one, so it always opens below its own
// trigger like every other element on the page.
export function AnchoredSelectField({ label, value, onChange, options, placeholder = 'Select…', style }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <p style={fieldLabel}>{label}</p>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          ...control, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', textAlign: 'left',
          color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
      </button>

      {open && (
        <div
          className="scrollbar-thin"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            maxHeight: 240, overflowY: 'auto',
            background: '#13131F', border: 'var(--border-w) solid var(--border)', borderRadius: 6,
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)', zIndex: 20,
          }}
        >
          {options.map(o => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '7px 10px', fontSize: 12.5, cursor: 'pointer',
                color: o.value === value ? 'var(--accent)' : 'var(--text-primary)',
                background: o.value === value ? 'var(--accent-dim)' : 'transparent',
              }}
              onMouseEnter={e => { if (o.value !== value) e.currentTarget.style.background = 'var(--bg-elevated)' }}
              onMouseLeave={e => { if (o.value !== value) e.currentTarget.style.background = 'transparent' }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// One-line honest note for anything the export draws but this build can't
// populate yet. Never substitute invented data for one of these.
export function GapNote({ children }) {
  return (
    <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {children}
    </p>
  )
}
