// ── ScriptFlowchart ──────────────────────────────────────────────────────────
// The bird's-eye view of the call decision tree for the Training Center.
// Top-down: opener → five response branches (with condensed step details)
//           → shared close at the bottom.
// Built from buildScriptFlow() so structure, colors, and outcomes stay in
// lock-step with the live Call modal.

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

// Extract up to 4 meaningful steps for the flowchart — skips sub-steps and
// limits say lines to 2. Routes are shown via the outcome badge, not here.
function getHighlights(steps) {
  const out = []
  let sayCount = 0
  for (const s of steps) {
    if (out.length >= 4) break
    if (s.type === 'action') {
      out.push(s)
    } else if (s.type === 'say' && !s.sub && sayCount < 2) {
      out.push(s)
      sayCount++
    } else if (s.type === 'fork') {
      out.push(s)
    }
    // routes shown via booksNate/outcome badge at bottom
  }
  return out
}

function trunc(t, n = 56) {
  const s = t.trim()
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

function StepItem({ s }) {
  if (s.type === 'action') {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4 }}>
        <span style={{ fontSize: 9.5, color: 'var(--warning)', flexShrink: 0, marginTop: 1, fontWeight: 700 }}>▸</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{trunc(s.text)}</span>
      </div>
    )
  }
  if (s.type === 'say') {
    const clean = s.text.replace(/^["']|["']$/g, '').trim()
    return (
      <p style={{ fontSize: 10.5, color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: 1.45, margin: '0 0 4px', paddingLeft: 2 }}>
        "{trunc(clean)}"
      </p>
    )
  }
  if (s.type === 'fork') {
    return (
      <div style={{ marginBottom: 5 }}>
        <p style={{ fontSize: 10.5, margin: '0 0 4px', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--accent)',
            background: 'var(--accent-dim)', border: '0.5px solid var(--accent-border)',
            borderRadius: 3, padding: '1px 5px', flexShrink: 0,
          }}>if/else</span>
          <span style={{ color: 'var(--text-muted)' }}>{trunc(s.q, 44)}</span>
        </p>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 2 }}>
          {s.options.slice(0, 3).map((o, i) => (
            <span key={i} style={{
              fontSize: 9.5, padding: '1px 7px', borderRadius: 4,
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              color: 'var(--text-muted)',
            }}>{trunc(o.label, 24)}</span>
          ))}
        </div>
      </div>
    )
  }
  return null
}

export function ScriptFlowchart({ flow }) {
  const opener = flow.opener
  const close = flow.close
  const openerLine = opener.steps[0]?.text || ''

  return (
    <div style={{ maxWidth: 940, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* Opener — single root box */}
      <Box color={opener.color} wide>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: opener.color, fontWeight: 700, margin: '0 0 6px' }}>
          Opener · same every call
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{openerLine}</p>
      </Box>

      <VLine caption="Their response routes the call" />

      {/* Rail above branch row */}
      <div style={{ width: '100%', height: 2, background: 'var(--border)', maxWidth: 860 }} />

      {/* Five response branches */}
      <div style={{
        width: '100%', display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: 12, marginTop: 16,
      }}>
        {flow.branches.map(b => {
          const highlights = getHighlights(b.steps)
          return (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 2, height: 12, background: 'var(--border)' }} />
              <div style={{
                width: '100%', background: b.dim, border: `0.5px solid ${b.border}`, borderTop: `3px solid ${b.color}`,
                borderRadius: 12, padding: '12px 13px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Branch header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ width: 19, height: 19, borderRadius: 5, background: b.color, color: '#0E0E1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{b.short}</span>
                  <p style={{ fontSize: 12.5, fontWeight: 600, color: b.color, margin: 0, lineHeight: 1.25 }}>{b.title}</p>
                </div>

                {/* Trigger */}
                {b.trigger && <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '0 0 8px', fontStyle: 'italic', lineHeight: 1.4 }}>{b.trigger}</p>}

                {/* Condensed step details */}
                {highlights.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '0 0 8px', opacity: 0.5 }} />
                    <div style={{ flex: 1 }}>
                      {highlights.map((s, i) => <StepItem key={i} s={s} />)}
                    </div>
                    <div style={{ height: 1, background: 'var(--border)', margin: '8px 0 8px', opacity: 0.5 }} />
                  </>
                )}

                {/* Outcome badge */}
                <div style={{ marginTop: highlights.length > 0 ? 0 : 'auto' }}>
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
          )
        })}
      </div>

      <VLine caption="Booking paths funnel to the close" />

      {/* Close — shared terminal box */}
      <Box color={close.color} wide>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: close.color, fontWeight: 700, margin: '0 0 6px' }}>
          ★ Close · hand off to Nate &amp; book
        </p>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)', margin: 0 }}>{close.goal}</p>
      </Box>
    </div>
  )
}
