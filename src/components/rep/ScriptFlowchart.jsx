// ── ScriptFlowchart ──────────────────────────────────────────────────────────
// Full recursive branching tree of the call script. Every fork splits into
// separate visual paths — you can see every possible route through the script
// at once, down to each terminal outcome.
// Built entirely from buildScriptFlow() data — no duplicated script content.

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

// A ▸ action the rep performs (set status, coaching reminder)
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

// A route node (→ CLOSE, → Branch A)
function RouteNode({ target, flow }) {
  const dest = flow.byId[target]
  const label = dest?.kind === 'close'
    ? '→ CLOSE — book with Nate'
    : `→ ${dest?.title || target}`
  const isClose = dest?.kind === 'close'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10.5, fontWeight: 600,
      color: isClose ? 'var(--success)' : 'var(--info)',
      background: isClose ? 'rgba(34,197,94,0.10)' : 'rgba(56,189,248,0.10)',
      border: `0.5px solid ${isClose ? 'rgba(34,197,94,0.30)' : 'rgba(56,189,248,0.30)'}`,
      borderRadius: 20, padding: '3px 10px',
    }}>
      {label}
    </span>
  )
}

// A fork node: decision box + side-by-side option columns (recursive)
function ForkNode({ step, color, flow }) {
  return (
    <div style={{ width: '100%' }}>
      {/* Fork question */}
      <div style={{
        padding: '6px 10px', boxSizing: 'border-box',
        background: 'rgba(108,99,255,0.10)', border: '0.5px solid rgba(108,99,255,0.25)',
        borderRadius: '7px 7px 0 0',
        display: 'flex', alignItems: 'flex-start', gap: 6,
      }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--accent)',
          background: 'rgba(108,99,255,0.18)', borderRadius: 3, padding: '1px 5px',
          flexShrink: 0, whiteSpace: 'nowrap', marginTop: 1,
        }}>if/else</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{step.q}</span>
      </div>
      {/* Option columns */}
      <div style={{
        display: 'flex', width: '100%', boxSizing: 'border-box',
        border: '0.5px solid var(--border)', borderTop: 'none',
        borderRadius: '0 0 7px 7px', overflow: 'hidden',
      }}>
        {step.options.map((opt, i) => (
          <div key={i} style={{
            flex: 1, minWidth: 0, boxSizing: 'border-box',
            padding: '8px 7px',
            borderLeft: i > 0 ? '0.5px solid var(--border)' : 'none',
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
            {opt.steps.length > 0
              ? opt.steps.map((s, j) => <FlowStep key={j} step={s} color={color} flow={flow} />)
              : (
                <>
                  <VC h={6} />
                  <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>continue</span>
                </>
              )
            }
          </div>
        ))}
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

// A branch column: header card + full step tree
function BranchColumn({ branch, flow }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <VC h={12} />
      <div style={{
        width: '100%', boxSizing: 'border-box',
        background: branch.dim, border: `0.5px solid ${branch.border}`,
        borderTop: `3px solid ${branch.color}`, borderRadius: 10, padding: '10px 12px',
      }}>
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
      {/* Full recursive step tree */}
      {branch.steps.map((step, i) => (
        <FlowStep key={i} step={step} color={branch.color} flow={flow} />
      ))}
    </div>
  )
}

// The close column — full step tree for the booking block
function CloseColumn({ close, flow }) {
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
      {close.steps.map((step, i) => (
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

export function ScriptFlowchart({ flow }) {
  const opener = flow.opener
  const openerLine = opener.steps[0]?.text || opener.goal

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ minWidth: 900, maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

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
  )
}
