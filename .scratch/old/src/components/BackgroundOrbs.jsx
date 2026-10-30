/**
 * BackgroundOrbs — three animated blurred orbs behind all content.
 * Renders fixed, z-index 0. Positioned via inline styles.
 * body::before/after in CSS handle the main two orbs;
 * this component adds the third (green, bottom-left).
 */
export function BackgroundOrbs() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0,
        pointerEvents: 'none', zIndex: 0,
        overflow: 'hidden',
      }}
    >
      {/* Subtle green — bottom left accent */}
      <div style={{
        position: 'absolute',
        width: 300, height: 200,
        background: 'rgba(34,197,94,0.04)',
        borderRadius: '50%',
        filter: 'blur(60px)',
        bottom: 100, left: -50,
        animation: 'orbFloat2 12s 2s ease-in-out infinite',
      }} />
    </div>
  )
}
