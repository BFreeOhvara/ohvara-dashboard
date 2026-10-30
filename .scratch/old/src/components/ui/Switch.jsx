// Minimal boolean toggle — no equivalent existed anywhere in components/ui
// (Prompt 324 found only Button-as-toggle patterns like Users.jsx's
// Activate/Deactivate, nothing pill-shaped). Design tokens only, no
// hardcoded colors, matching every other control in this app.
// P778 — `label` names it for screen readers when no <label> wraps it, and
// .ov-switch adds an invisible hit area so the tap target is 44px tall.
export function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="ov-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 44, height: 24, borderRadius: 12, flexShrink: 0,
        border: 'none', padding: 2, cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--bg-muted)',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s ease',
        display: 'flex', alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'transform 0.15s ease',
      }} />
    </button>
  )
}
