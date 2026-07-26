// Shared segmented-pill toggle — the app's one sub-tab pattern (Prompt 348,
// extracted in Prompt 361 so Submissions' tabs can match it exactly instead
// of drifting via a hand-copied second definition).
export function Segmented({ options, value, onChange, size = 'md', style }) {
  const pad = size === 'sm' ? '4px 10px' : '6px 16px'
  const font = size === 'sm' ? 10.5 : 12
  return (
    <div style={{
      display: 'flex', gap: 2, background: 'var(--bg-elevated)', border: 'var(--border-w) solid var(--border)',
      borderRadius: 6, padding: 2, width: 'fit-content', ...style,
    }}>
      {options.map(o => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              border: 'none', borderRadius: 4, padding: pad, fontSize: font, fontWeight: 700,
              background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
