// Card + control styling lifted verbatim from the approved Claude Design
// export (vault: media/claude-design-export-ohvara-dashboard-v3.html) — the
// same 10px uppercase label, 34px control, 8px card and 22/24 padding it uses
// on every screen. One place so the ported pages can't drift from each other
// the way hand-copied inline styles would.
//
// One deliberate deviation: the export's form grids are a hard `1fr 1fr 1fr`,
// which overflows a phone. `grid3` uses auto-fit/minmax so the same three
// columns collapse to one on mobile — the team works from phones.
//
// Components that consume these live in components/ui/ExportForm.jsx.

export const MONO = "'JetBrains Mono',monospace"

export const card = {
  background: 'var(--bg-surface)',
  border: 'var(--border-w) solid var(--border)',
  borderRadius: 8,
  padding: '22px 24px',
}

export const cardTitle = {
  margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
}

export const fieldLabel = {
  margin: '0 0 5px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
  textTransform: 'uppercase', color: 'var(--text-secondary)',
}

export const control = {
  width: '100%', height: 34,
  background: 'var(--bg-elevated)',
  border: 'var(--border-w) solid var(--border)',
  borderRadius: 6, padding: '0 10px',
  fontSize: 12.5, color: 'var(--text-primary)', outline: 'none',
}

export const grid3 = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 12, marginBottom: 12,
}

export const primaryBtn = {
  height: 36, padding: '0 18px', border: 'none', borderRadius: 6,
  background: 'var(--accent)', color: '#fff', fontSize: 12.5, fontWeight: 700,
}

export const ghostBtn = {
  height: 34, padding: '0 14px',
  border: 'var(--border-w) solid var(--border)', borderRadius: 6,
  background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
  fontSize: 11.5, fontWeight: 700,
  display: 'inline-flex', alignItems: 'center', gap: 6,
}
