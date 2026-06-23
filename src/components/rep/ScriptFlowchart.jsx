import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'

// ── ScriptFlowchart ──────────────────────────────────────────────────────────
// Full recursive branching tree of the call script. Every fork splits into
// separate visual paths — you can see every possible route through the script
// at once, down to each terminal outcome.
// Built entirely from buildScriptFlow() data — no duplicated script content.

// Registration hooks for the back-reference connector overlay (Change 3) —
// branch header boxes register themselves as anchors; route nodes that point
// back to an earlier branch register themselves as connector sources.
const FlowRefsContext = createContext(null)

// Short vertical connector between nodes
function VC({ h = 12 }) {
  return <div style={{ width: 2, height: h, background: 'var(--border)', flexShrink: 0 }} />
}

// Strip surrounding double-quotes if the entire string is quoted
function unquote(t) {
  const s = t.trim()
  return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"'
    ? s.slice(1, -1)
    : s
}

// Change 2 — coaching-action steps only render at the terminal position of
// their own steps array (no further steps follow in that specific path).
// Mid-flow actions are filtered out here so a rep can't accidentally read a
// directive aloud — this is a display-only filter, the underlying script
// data (and the click-through ScriptWalk, which still shows every step in
// order) is untouched.
function visibleSteps(steps) {
  return steps.filter((s, i) => s.type !== 'action' || i === steps.length - 1)
}

// A spoken line node — italic, color-tinted
function SayNode({ text, color }) {
  return (
    <div style={{
      width: '100%', padding: '7px 10px', boxSizing: 'border-box',
      background: color + '12', border: `0.5px solid ${color}35`,
      borderRadius: 7,
    }}>
      <p style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
        {unquote(text)}
      </p>
    </div>
  )
}

// A ▸ action the rep performs (set status, coaching reminder) — only ever
// reached here when it's the terminal step (see visibleSteps above)
function ActionNode({ text }) {
  return (
    <div style={{
      width: '100%', padding: '5px 9px', boxSizing: 'border-box',
      background: 'rgba(245,158,11,0.07)', border: '0.5px solid rgba(245,158,11,0.25)',
      borderRadius: 6, display: 'flex', alignItems: 'flex-start', gap: 5,
    }}>
      <span style={{ fontSize: 9.5, color: 'var(--warning)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>▸</span>
      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>{text}</span>
    </div>
  )
}

// A route node (→ CLOSE, → Branch A). Routes back to an earlier BRANCH node
// register as a connector source (Change 3) so a real curved line is drawn —
// routes forward to CLOSE keep the plain pill (the funnel-down layout already
// makes that connection visually obvious without a drawn line).
function RouteNode({ target, flow }) {
  const { registerBackref } = useContext(FlowRefsContext)
  const dest = flow.byId[target]
  const isBranchBackref = dest?.kind === 'branch'
  const label = dest?.kind === 'close'
    ? '→ CLOSE — book with Nate'
    : `→ ${dest?.title || target}`
  const isClose = dest?.kind === 'close'
  return (
    <span
      ref={isBranchBackref ? registerBackref(target) : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10.5, fontWeight: 600,
        color: isClose ? 'var(--success)' : 'var(--info)',
        background: isClose ? 'rgba(34,197,94,0.10)' : 'rgba(56,189,248,0.10)',
        border: `0.5px solid ${isClose ? 'rgba(34,197,94,0.30)' : 'rgba(56,189,248,0.30)'}`,
        borderRadius: 20, padding: '3px 10px',
      }}
    >
      {label}
    </span>
  )
}

// A fork node: decision box, then SEPARATE option cards side-by-side
// (Change 1 — each option is its own bordered box, not a shared
// column-divided container).
function ForkNode({ step, color, flow }) {
  return (
    <div style={{ width: '100%' }}>
      {/* Fork question — its own box */}
      <div style={{
        width: '100%', boxSizing: 'border-box', padding: '6px 10px',
        background: 'rgba(108,99,255,0.10)', border: '0.5px solid rgba(108,99,255,0.25)',
        borderRadius: 7, display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--accent)',
          background: 'rgba(108,99,255,0.18)', borderRadius: 3, padding: '1px 5px',
          flexShrink: 0, whiteSpace: 'nowrap', marginTop: 1,
        }}>if/else</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{step.q}</span>
      </div>

      <VC h={8} />

      {/* Separate option boxes — own border/radius/background each, divided
          by a gap instead of a shared outer border with a divider line. */}
      <div style={{ display: 'flex', width: '100%', boxSizing: 'border-box', gap: 8, alignItems: 'flex-start' }}>
        {step.options.map((opt, i) => {
          const shown = visibleSteps(opt.steps)
          return (
            <div key={i} style={{
              flex: 1, minWidth: 0, boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
              borderRadius: 8, padding: '8px 7px',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>
              {/* Option label */}
              <span style={{
                fontSize: 9.5, fontWeight: 600, color: color,
                background: color + '15', border: `0.5px solid ${color}44`,
                borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis',
                textAlign: 'center', display: 'block',
              }}>
                {opt.label}
              </span>
              {/* Option's step tree (recursive) */}
              {shown.length > 0
                ? shown.map((s, j) => <FlowStep key={j} step={s} color={color} flow={flow} />)
                : (
                  <>
                    <VC h={6} />
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>continue</span>
                  </>
                )
              }
            </div>
          )
        })}
      </div>
    </div>
  )
}

// One step with its leading connector — renders the right node type
function FlowStep({ step, color, flow }) {
  if (step.type === 'say')    return <><VC /><SayNode    text={step.text}  color={color} /></>
  if (step.type === 'action') return <><VC /><ActionNode text={step.text} /></>
  if (step.type === 'route')  return <><VC /><RouteNode  target={step.target} flow={flow} /></>
  if (step.type === 'fork')   return <><VC /><ForkNode   step={step} color={color} flow={flow} /></>
  return null
}

// A branch column: header card (registers as a back-reference anchor) + full
// step tree, mid-flow actions filtered (Change 2).
function BranchColumn({ branch, flow }) {
  const { registerBranchAnchor } = useContext(FlowRefsContext)
  const shown = visibleSteps(branch.steps)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <VC h={12} />
      <div
        ref={registerBranchAnchor(branch.id)}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: branch.dim, border: `0.5px solid ${branch.border}`,
          borderTop: `3px solid ${branch.color}`, borderRadius: 10, padding: '10px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: branch.trigger ? 4 : 0 }}>
          <span style={{
            width: 19, height: 19, borderRadius: 5, flexShrink: 0,
            background: branch.color, color: '#0E0E1A',
            fontSize: 11, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{branch.short}</span>
          <p style={{ fontSize: 12.5, fontWeight: 600, color: branch.color, margin: 0, lineHeight: 1.25 }}>{branch.title}</p>
        </div>
        {branch.trigger && (
          <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic', lineHeight: 1.4 }}>
            {branch.trigger}
          </p>
        )}
      </div>
      {/* Full recursive step tree (mid-flow actions hidden) */}
      {shown.map((step, i) => (
        <FlowStep key={i} step={step} color={branch.color} flow={flow} />
      ))}
    </div>
  )
}

// The close column — full step tree for the booking block, mid-flow actions
// filtered (Change 2).
function CloseColumn({ close, flow }) {
  const shown = visibleSteps(close.steps)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div style={{
        width: '100%', boxSizing: 'border-box',
        background: close.color + '12', border: `0.5px solid ${close.color}44`,
        borderTop: `3px solid ${close.color}`, borderRadius: 10, padding: '12px 14px',
      }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: close.color, fontWeight: 700, margin: '0 0 4px' }}>
          ★ Close · all booking paths end here
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{close.goal}</p>
      </div>
      {shown.map((step, i) => (
        <FlowStep key={i} step={step} color={close.color} flow={flow} />
      ))}
    </div>
  )
}

// Main connector between top-level sections
function VLine({ caption }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, margin: '5px 0' }}>
      <div style={{ width: 2, height: 20, background: 'var(--border)' }} />
      {caption && (
        <>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{caption}</p>
          <div style={{ width: 2, height: 20, background: 'var(--border)' }} />
        </>
      )}
    </div>
  )
}

// SVG overlay drawing a real curved connector from each back-reference route
// (registered by RouteNode) to its target branch header (registered by
// BranchColumn) — Change 3. Recomputed after layout and on window resize.
// Named as a hook (not a component) since it's called directly, not via JSX.
function useBackrefOverlay(containerRef) {
  const branchAnchors = useRef({})
  const backrefs = useRef([])
  const [paths, setPaths] = useState([])

  useLayoutEffect(() => {
    function recompute() {
      const containerEl = containerRef.current
      if (!containerEl) return
      const cRect = containerEl.getBoundingClientRect()
      const next = backrefs.current
        .map(({ el, targetId }, i) => {
          const targetEl = branchAnchors.current[targetId]
          if (!targetEl || !el) return null
          const sRect = el.getBoundingClientRect()
          const tRect = targetEl.getBoundingClientRect()
          const sx = sRect.left - cRect.left
          const sy = sRect.top - cRect.top + sRect.height / 2
          const tx = tRect.left - cRect.left + tRect.width / 2
          const ty = tRect.top - cRect.top + tRect.height
          return { id: i, sx, sy, tx, ty }
        })
        .filter(Boolean)
      setPaths(next)
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [containerRef])

  const registerBranchAnchor = useCallback((id) => (el) => {
    if (el) branchAnchors.current[id] = el
  }, [])

  const registerBackref = useCallback((targetId) => (el) => {
    if (el && !backrefs.current.some(b => b.el === el)) {
      backrefs.current.push({ el, targetId })
    }
  }, [])

  return {
    registerBranchAnchor,
    registerBackref,
    overlay: (
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <defs>
          <marker id="backref-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 Z" fill="var(--accent)" />
          </marker>
        </defs>
        {paths.map(p => (
          <path
            key={p.id}
            d={`M ${p.sx},${p.sy} C ${p.sx - 70},${p.sy} ${p.tx - 70},${p.ty} ${p.tx},${p.ty}`}
            fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3"
            markerEnd="url(#backref-arrow)" opacity="0.55"
          />
        ))}
      </svg>
    ),
  }
}

export function ScriptFlowchart({ flow }) {
  const containerRef = useRef(null)
  const { registerBranchAnchor, registerBackref, overlay } = useBackrefOverlay(containerRef)

  const opener = flow.opener
  const openerLine = opener.steps[0]?.text || opener.goal

  return (
    <FlowRefsContext.Provider value={{ registerBranchAnchor, registerBackref }}>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <div
          ref={containerRef}
          style={{
            position: 'relative', minWidth: 900, maxWidth: 1200, margin: '0 auto',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
          }}
        >
          {overlay}

          {/* Opener */}
          <div style={{
            width: 'min(460px, 100%)', boxSizing: 'border-box',
            background: opener.color + '14', border: `0.5px solid ${opener.color}55`,
            borderLeft: `3px solid ${opener.color}`, borderRadius: 12, padding: '14px 16px',
          }}>
            <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: opener.color, fontWeight: 700, margin: '0 0 6px' }}>
              Opener · same every call
            </p>
            <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500, fontStyle: 'italic' }}>
              {unquote(openerLine)}
            </p>
          </div>

          <VLine caption="Their response routes the call" />

          {/* Rail */}
          <div style={{ width: '100%', height: 2, background: 'var(--border)' }} />

          {/* Five response branches */}
          <div style={{
            width: '100%', display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 10, alignItems: 'start',
          }}>
            {flow.branches.map(b => (
              <BranchColumn key={b.id} branch={b} flow={flow} />
            ))}
          </div>

          <VLine caption="Booking paths funnel to the close" />

          {/* Close — full step tree, centered */}
          <div style={{ width: 'min(480px, 100%)' }}>
            <CloseColumn close={flow.close} flow={flow} />
          </div>

        </div>
      </div>
    </FlowRefsContext.Provider>
  )
}
