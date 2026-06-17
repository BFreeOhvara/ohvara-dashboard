// ── ScriptFlowchart ──────────────────────────────────────────────────────────
// The bird's-eye view of the call decision tree for the Training Center: a
// top-down flowchart of boxes and connecting lines — one opener at the top,
// the five response branches below it, and the shared close at the bottom that
// the booking paths funnel into. Built from buildScriptFlow() so the structure,
// colors, and outcomes stay in lock-step with the live Call modal.

function VLine({ caption }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, margin: '6px 0' }}>
      <div style={{ width: 2, height: 22, background: 'var(--border)' }} />
      {caption && <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{caption}</p>}
      {caption && <div style={{ width: 2, height: 22, background: 'var(--border)' }} />}
    </div>
  )
}

function Box({ color, children, wide }) {
  return (
    <div style={{
      width: wide ? 'min(440px, 100%)' : '100%',
      background: color + '14', border: `0.5px solid ${color}55`, borderLeft: `3px solid ${color}`,
      borderRadius: 12, padding: '14px 16px', boxSizing: 'border-box',
    }}>
      {children}
    </div>
  )
}

export function ScriptFlowchart({ flow }) {
  const opener = flow.opener
  const close = flow.close
  const openerLine = opener.steps[0]?.text || ''

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* Opener — the single root box */}
      <Box color={opener.color} wide>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: opener.color, fontWeight: 700, margin: '0 0 6px' }}>
          Opener · same every call
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{openerLine}</p>
      </Box>

      <VLine caption="Their response routes the call" />

      {/* Decorative rail above the branch row */}
      <div style={{ width: '100%', height: 2, background: 'var(--border)', maxWidth: 860 }} />

      {/* The five response branches — sized to sit in one row on desktop,
          wrapping gracefully on narrower screens. */}
      <div style={{
        width: '100%', display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12, marginTop: 16,
      }}>
        {flow.branches.map(b => (
          <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 2, height: 12, background: 'var(--border)' }} />
            <div style={{
              width: '100%', background: b.dim, border: `0.5px solid ${b.border}`, borderTop: `3px solid ${b.color}`,
              borderRadius: 12, padding: '12px 13px', boxSizing: 'border-box', minHeight: 118,
              display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ width: 19, height: 19, borderRadius: 5, background: b.color, color: '#0E0E1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{b.short}</span>
                <p style={{ fontSize: 12.5, fontWeight: 600, color: b.color, margin: 0, lineHeight: 1.25 }}>{b.title}</p>
              </div>
              {b.trigger && <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 10px', fontStyle: 'italic', lineHeight: 1.4 }}>{b.trigger}</p>}
              <div style={{ marginTop: 'auto' }}>
                {b.booksNate ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: 'var(--success)', background: 'rgba(34,197,94,0.10)', border: '0.5px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '3px 8px' }}>
                    → Books Nate
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '3px 8px' }}>
                    Ends: {b.outcome || 'log outcome'}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <VLine caption="Booking paths funnel to the close" />

      {/* Close — the shared terminal box */}
      <Box color={close.color} wide>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: close.color, fontWeight: 700, margin: '0 0 6px' }}>
          ★ Close · hand off to Nate &amp; book
        </p>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: 0 }}>{close.goal}</p>
      </Box>
    </div>
  )
}
