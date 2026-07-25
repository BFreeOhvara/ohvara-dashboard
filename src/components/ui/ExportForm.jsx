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

// One-line honest note for anything the export draws but this build can't
// populate yet. Never substitute invented data for one of these.
export function GapNote({ children }) {
  return (
    <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {children}
    </p>
  )
}
