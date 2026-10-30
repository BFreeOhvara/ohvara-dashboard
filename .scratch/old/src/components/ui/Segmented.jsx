// Shared segmented toggle — the app's one sub-tab pattern (Prompt 348,
// extracted in Prompt 361 so every page's tabs match exactly).
// Prompt 669 — restyled to Restorix Portal's grouped SegmentedTabs: one
// bordered box on the card surface, solid-accent active segment.
export function Segmented({ options, value, onChange, size = 'md', style }) {
  const pad = size === 'sm' ? '4px 10px' : '6px 14px'
  const font = size === 'sm' ? 12 : 13.5
  return (
    <div style={{
      display: 'flex', gap: 4, background: 'var(--bg-surface)', border: 'var(--border-w) solid var(--border)',
      borderRadius: 10, padding: 4, width: 'fit-content', ...style,
    }}>
      {options.map(o => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="tab-transition"
            style={{
              border: 'none', borderRadius: 7, padding: pad, fontSize: font, fontWeight: on ? 600 : 500,
              background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'var(--text-secondary)',
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
