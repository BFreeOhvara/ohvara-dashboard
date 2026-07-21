// Minimal boolean toggle — no equivalent existed anywhere in components/ui
// (Prompt 324 found only Button-as-toggle patterns like Users.jsx's
// Activate/Deactivate, nothing pill-shaped). Design tokens only, no
// hardcoded colors, matching every other control in this app.
export function Switch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        width: 36, height: 20, borderRadius: 10, flexShrink: 0,
        border: 'none', padding: 2, cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'var(--accent)' : 'var(--bg-elevated)',
        boxShadow: checked ? 'none' : 'inset 0 0 0 0.5px var(--border)',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s ease',
        display: 'flex', alignItems: 'center',
        justifyContent: checked ? 'flex-end' : 'flex-start',
      }}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'transform 0.15s ease',
      }} />
    </button>
  )
}
