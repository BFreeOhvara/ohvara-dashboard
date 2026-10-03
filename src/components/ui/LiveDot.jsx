// Prompt 689 — "a call is live right now" marker. Red dot, ring pulsing
// outward (styles in index.css; static under prefers-reduced-motion).
export function LiveDot({ size = 8, title = 'Call in progress' }) {
  return <span className="live-dot" title={title} role="img" aria-label={title} style={{ width: size, height: size }} />
}
