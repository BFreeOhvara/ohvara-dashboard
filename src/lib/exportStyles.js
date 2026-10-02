// Shared card / control / button styles. One place so the pages can't drift
// from each other the way hand-copied inline styles would.
//
// Prompt 669 — re-cut to Restorix Portal's design system: 16px-radius cards
// with 20/24 padding, mono eyebrow labels, 40px controls on the page canvas,
// fully-rounded buttons. Same export names as before (the Claude Design port,
// Prompt 327), so every page that already uses them picks the new look up
// without a rewrite.
//
// `grid3` uses auto-fit/minmax so three columns collapse to one on a phone —
// the team works from phones.
//
// Components that consume these live in components/ui/ExportForm.jsx.

export const MONO = "'JetBrains Mono',monospace"
export const DISPLAY = "'Space Grotesk',system-ui,sans-serif"

export const card = {
  background: 'var(--bg-surface)',
  border: 'var(--border-w) solid var(--border)',
  borderRadius: 16,
  padding: '20px 24px',
}

// Title inside a card — Manrope semibold, like Restorix's SettingsSection.
export const cardTitle = {
  margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)',
}

// Heading that sits above a card, outside it — Restorix's `h2 font-display
// text-lg font-medium`.
export const sectionTitle = {
  margin: 0, fontFamily: DISPLAY, fontSize: 18, fontWeight: 500,
  color: 'var(--text-primary)', letterSpacing: '-0.01em',
}

// Restorix's `.eyebrow` — mono caps in the accent's deep shade.
export const eyebrow = {
  margin: 0, fontFamily: MONO, fontSize: 11, fontWeight: 500, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--accent-deep)',
}

export const fieldLabel = { ...eyebrow, margin: '0 0 6px' }

export const control = {
  width: '100%', height: 40,
  background: 'var(--bg-base)',
  border: 'var(--border-w) solid var(--border)',
  borderRadius: 8, padding: '0 12px',
  fontSize: 14, color: 'var(--text-primary)', outline: 'none',
}

export const grid3 = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 14, marginBottom: 14,
}

export const primaryBtn = {
  height: 40, padding: '0 20px', border: 'none', borderRadius: 999,
  background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  whiteSpace: 'nowrap',
}

// Restorix's `secondary` button — bordered pill on the raised surface.
export const ghostBtn = {
  height: 36, padding: '0 16px',
  border: 'var(--border-w) solid var(--border)', borderRadius: 999,
  background: 'var(--bg-surface)', color: 'var(--text-primary)',
  fontSize: 13, fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  whiteSpace: 'nowrap',
}
