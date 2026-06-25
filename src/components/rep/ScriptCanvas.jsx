import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  Handle, Position, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { X as XIcon } from 'lucide-react'
import { ScriptWalk } from './ScriptWalk'

// ── ScriptCanvas ─────────────────────────────────────────────────────────────
// Interactive zoomable map of the call script. Prompt 61 changes:
//   - Full page height (height: 100% in the canvas container)
//   - No node dragging (nodesDraggable={false})
//   - Clicking any node replaces the canvas with a ScriptWalk practice view
//     starting from that node's section; Exit returns to the canvas.

const NODE_W = 240
const COL = NODE_W + 70   // horizontal column unit
const ROW = 156           // vertical step unit
const BRANCH_GAP_Y = 210  // opener bottom → branch header row
const CLOSE_GAP_Y = 120   // tallest branch bottom → close header

const EDGE_GREY = '#3A3A4A'

function unquote(t) {
  const s = (t || '').trim()
  return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s
}

// Subtree width in columns: a linear chain is 1; a fork is the sum of its
// option widths; a chain's width is the max width of any step in it.
// Routes to other branches are back-ref arrows, not inlined subtrees, so they
// don't contribute width.
function measureSteps(steps, flow, visited) {
  let w = 1
  for (const s of steps) {
    if (s.type === 'fork') {
      let fw = 0
      for (const opt of s.options) fw += Math.max(1, measureSteps(opt.steps, flow, visited))
      w = Math.max(w, fw)
    }
  }
  return w
}

const headerNodeId = (sectionId) => (sectionId === 'close' ? 'close-header' : `header-${sectionId}`)
const routeLabel = (flow, target) => {
  const t = flow.byId[target]
  return t?.kind === 'close' ? '→ Close' : `→ ${t?.title || target}`
}

// Build React Flow nodes + edges from the derived flow. sectionId is stored
// in each node's data so clicking a node can start ScriptWalk at that section.
function buildGraph(flow) {
  const nodes = []
  const edges = []
  let counter = 0
  const nextId = () => `n${counter++}`

  function pushEdge(srcTail, targetId, label) {
    edges.push({
      id: `e${counter++}`,
      source: srcTail.id,
      target: targetId,
      label: (srcTail.label ?? label) || undefined,
      type: 'smoothstep',
      style: { stroke: EDGE_GREY, strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fill: '#9090AA', fontWeight: 600 },
      labelBgStyle: { fill: '#13131F' },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_GREY },
    })
  }

  function makeNode(id, type, data, x, y, sectionId) {
    nodes.push({ id, type, position: { x, y }, data: { dim: false, active: false, pickable: false, sectionId, ...data } })
    return id
  }

  // Lay out a sequence of steps within a horizontal band. sectionId tracks
  // which section owns these steps so nodes can route ScriptWalk on click.
  function placeSteps(steps, bandLeftPx, bandCols, startY, incomingTails, incomingLabel, accent, visited = new Set(), sectionId = 'opener') {
    let tails = incomingTails
    let label = incomingLabel
    let y = startY
    const centerX = bandLeftPx + (bandCols * COL) / 2 - NODE_W / 2

    let si = 0
    while (si < steps.length) {
      const step = steps[si]

      if (step.type === 'route') {
        const targetSection = flow.byId[step.target]
        const tgt = headerNodeId(step.target)
        if (targetSection?.kind === 'branch') {
          // Terminal "Go to X" node — no long cross-canvas arrow drawn.
          // Clicking this node in practice mode jumps to the target branch.
          const id = nextId()
          makeNode(id, 'goTo', { label: routeLabel(flow, step.target), targetSectionId: step.target, accent }, centerX, y, sectionId)
          for (const t of tails) pushEdge(t, id, label)
          y += ROW
        } else {
          // Forward route (to close or terminal)
          for (const t of tails) pushEdge(t, tgt, label ?? routeLabel(flow, step.target))
        }
        label = null
        tails = []
        si++
        continue
      }

      if (step.type === 'fork') {
        const id = nextId()
        makeNode(id, 'fork', { q: step.q, accent }, centerX, y, sectionId)
        for (const t of tails) pushEdge(t, id, label)
        label = null

        const optY = y + ROW
        let optLeftCols = 0
        const optTails = []
        let maxEndY = optY
        for (const opt of step.options) {
          const optCols = Math.max(1, measureSteps(opt.steps, flow, visited))
          const optLeftPx = bandLeftPx + optLeftCols * COL
          if (opt.steps.length === 0) {
            optTails.push({ id, label: opt.label })
          } else {
            const r = placeSteps(opt.steps, optLeftPx, optCols, optY, [{ id }], opt.label, accent, visited, sectionId)
            for (const tt of r.tails) optTails.push(tt)
            maxEndY = Math.max(maxEndY, r.endY)
          }
          optLeftCols += optCols
        }
        tails = optTails
        y = maxEndY
        si++
        continue
      }

      if (step.type === 'data_collect') {
        const id = nextId()
        makeNode(id, 'dataCollect', { fields: step.fields, label: step.label, hint: step.hint, accent }, centerX, y, sectionId)
        for (const t of tails) pushEdge(t, id, label)
        label = null
        tails = [{ id }]
        y += ROW
        si++
        continue
      }

      if (step.type === 'say') {
        // Peek ahead past any action steps for an immediately adjacent fork.
        let j = si + 1
        while (j < steps.length && steps[j]?.type === 'action') j++
        const nextFork = steps[j]?.type === 'fork' ? steps[j] : null

        if (nextFork) {
          // Say + fork combined into one node — no intermediate arrow.
          const id = nextId()
          makeNode(id, 'sayFork', { text: step.text, sub: step.sub, q: nextFork.q, accent }, centerX, y, sectionId)
          for (const t of tails) pushEdge(t, id, label)
          label = null

          const optY = y + ROW
          let optLeftCols = 0
          const optTails = []
          let maxEndY = optY
          for (const opt of nextFork.options) {
            const optCols = Math.max(1, measureSteps(opt.steps, flow, visited))
            const optLeftPx = bandLeftPx + optLeftCols * COL
            if (opt.steps.length === 0) {
              optTails.push({ id, label: opt.label })
            } else {
              const r = placeSteps(opt.steps, optLeftPx, optCols, optY, [{ id }], opt.label, accent, visited, sectionId)
              for (const tt of r.tails) optTails.push(tt)
              maxEndY = Math.max(maxEndY, r.endY)
            }
            optLeftCols += optCols
          }
          tails = optTails
          y = maxEndY
          si = j + 1  // skip say + interstitial actions + fork
          continue
        }

        // Standalone say (no adjacent fork)
        const id = nextId()
        makeNode(id, 'say', { text: step.text, sub: step.sub, accent }, centerX, y, sectionId)
        for (const t of tails) pushEdge(t, id, label)
        label = null
        tails = [{ id }]
        y += ROW
        si++
        continue
      }

      // action (and any other step type) — single node
      const id = nextId()
      makeNode(id, step.type, { text: step.text, sub: step.sub, accent }, centerX, y, sectionId)
      for (const t of tails) pushEdge(t, id, label)
      label = null
      tails = [{ id }]
      y += ROW
      si++
    }

    return { tails, endY: y }
  }

  // Branches laid out left-to-right, each in a band sized by its subtree width.
  let leftCols = 0
  let maxBranchEndY = BRANCH_GAP_Y
  for (const b of flow.branches) {
    const cols = Math.max(1, measureSteps(b.steps, flow))
    const bandLeftPx = leftCols * COL
    const hx = bandLeftPx + (cols * COL) / 2 - NODE_W / 2
    const hid = headerNodeId(b.id)
    makeNode(hid, 'branchHeader', { branch: b }, hx, BRANCH_GAP_Y, b.id)
    pushEdge({ id: 'opener' }, hid, b.short)
    const r = placeSteps(b.steps, bandLeftPx, cols, BRANCH_GAP_Y + ROW, [{ id: hid }], null, b.color, new Set(), b.id)
    maxBranchEndY = Math.max(maxBranchEndY, r.endY)
    leftCols += cols
  }
  const totalW = leftCols * COL

  // Opener centered over the full branch row.
  const openerLine = flow.opener.steps[0]?.text || flow.opener.goal
  makeNode('opener', 'opener', { text: openerLine, accent: flow.opener.color }, totalW / 2 - NODE_W / 2, 0, 'opener')

  // Close centered below the tallest branch, with its own step tree beneath.
  const closeCols = Math.max(1, measureSteps(flow.close.steps, flow))
  const closeY = maxBranchEndY + CLOSE_GAP_Y
  const closeBandLeft = totalW / 2 - (closeCols * COL) / 2
  makeNode('close-header', 'close', { close: flow.close }, totalW / 2 - NODE_W / 2, closeY, 'close')
  placeSteps(flow.close.steps, closeBandLeft, closeCols, closeY + ROW, [{ id: 'close-header' }], null, flow.close.color, new Set(), 'close')

  return { nodes, edges }
}

// ── Node shells ───────────────────────────────────────────────────────────────
const HANDLE = { width: 7, height: 7, opacity: 0, border: 'none', background: 'transparent', minWidth: 0, minHeight: 0 }

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HANDLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE} />
    </>
  )
}

function shell({ dim, active, pickable }, accent, extra) {
  return {
    width: NODE_W, boxSizing: 'border-box', borderRadius: 10, padding: '10px 12px',
    background: '#13131F',
    border: `1px solid ${active || pickable ? accent : 'var(--border)'}`,
    boxShadow: active ? `0 0 0 2px ${accent}, 0 8px 28px rgba(0,0,0,0.45)` : pickable ? `0 0 0 1px ${accent}` : 'none',
    opacity: dim ? 0.2 : 1,
    cursor: 'pointer',
    transition: 'opacity 0.2s, box-shadow 0.2s, border-color 0.2s',
    ...extra,
  }
}

function Tag({ color, children }) {
  return (
    <p style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '0.08em', color, fontWeight: 700, margin: '0 0 5px' }}>
      {children}
    </p>
  )
}

function SayNode({ data }) {
  return (
    <div style={shell(data, data.accent)}>
      <Handles />
      <Tag color={data.accent}>{data.sub ? 'Then say' : 'Say'}</Tag>
      <p style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
        {unquote(data.text)}
      </p>
    </div>
  )
}

function ActionNode({ data }) {
  return (
    <div style={shell(data, 'var(--warning)', { background: 'rgba(245,158,11,0.06)' })}>
      <Handles />
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700, marginTop: 1, flexShrink: 0 }}>▸</span>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45 }}>{data.text}</span>
      </div>
    </div>
  )
}

function DataCollectNode({ data }) {
  return (
    <div style={shell(data, 'var(--success)', { background: 'rgba(34,197,94,0.06)' })}>
      <Handles />
      <Tag color="var(--success)">▦ {data.label || 'Log on the call'}</Tag>
      {data.hint && (
        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.4, margin: '0 0 8px' }}>{data.hint}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(data.fields || []).map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>{f.label}</span>
            <span style={{
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              border: '0.5px dashed var(--border)', borderRadius: 5, padding: '2px 8px', minWidth: 44, textAlign: 'center',
            }}>—</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', margin: '8px 0 0' }}>
        Fill in during your actual call
      </p>
    </div>
  )
}

function SayForkNode({ data }) {
  return (
    <div style={shell(data, data.accent, { background: `${data.accent}0D` })}>
      <Handles />
      <Tag color={data.accent}>{data.sub ? 'Then say' : 'Say'}</Tag>
      <p style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-primary)', lineHeight: 1.5, margin: '0 0 10px', borderBottom: '0.5px solid var(--border)', paddingBottom: 10 }}>
        {unquote(data.text)}
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--accent)', background: 'rgba(108,99,255,0.20)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap' }}>if/else</span>
        {data.q && <span style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45 }}>{data.q}</span>}
      </div>
    </div>
  )
}

function GoToNode({ data }) {
  return (
    <div style={shell(data, 'var(--accent)', { background: 'rgba(108,99,255,0.08)', border: '1px dashed rgba(108,99,255,0.40)' })}>
      <Handle type="target" position={Position.Top} style={HANDLE} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 15, color: 'var(--accent)', lineHeight: 1 }}>→</span>
        <span style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{data.label}</span>
      </div>
    </div>
  )
}

function ForkNode({ data }) {
  return (
    <div style={shell(data, 'var(--accent)', { background: 'rgba(108,99,255,0.10)', border: data.active || data.pickable ? undefined : '1px solid rgba(108,99,255,0.30)' })}>
      <Handles />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--accent)', background: 'rgba(108,99,255,0.20)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap' }}>if/else</span>
        <span style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45 }}>{data.q}</span>
      </div>
    </div>
  )
}

function OpenerNode({ data }) {
  return (
    <div style={shell(data, data.accent, { width: 300, borderLeft: `3px solid ${data.accent}` })}>
      <Handles />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <Tag color={data.accent} style={{ margin: 0 }}>Opener · same every call</Tag>
        <span style={{
          fontSize: 8, fontWeight: 700, color: '#0E0E1A',
          background: data.accent, borderRadius: 4,
          padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.07em',
          flexShrink: 0,
        }}>▶ Start here</span>
      </div>
      <p style={{ fontSize: 13, fontStyle: 'italic', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
        {unquote(data.text)}
      </p>
    </div>
  )
}

function BranchHeaderNode({ data }) {
  const b = data.branch
  return (
    <div style={shell(data, b.color, { background: b.dim, borderTop: `3px solid ${b.color}` })}>
      <Handles />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: b.trigger ? 4 : 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, background: b.color, color: '#0E0E1A', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{b.short}</span>
        <p style={{ fontSize: 12, fontWeight: 600, color: b.color, margin: 0, lineHeight: 1.2 }}>{b.title}</p>
      </div>
      {b.trigger && <p style={{ fontSize: 9.5, color: 'var(--text-muted)', margin: 0, fontStyle: 'italic', lineHeight: 1.35 }}>{b.trigger}</p>}
    </div>
  )
}

function CloseNode({ data }) {
  const c = data.close
  return (
    <div style={shell(data, c.color, { width: 300, background: 'rgba(108,99,255,0.10)', borderTop: `3px solid ${c.color}` })}>
      <Handles />
      <Tag color={c.color}>★ Close · all booking paths end here</Tag>
      <p style={{ fontSize: 11.5, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>{c.goal}</p>
    </div>
  )
}

const nodeTypes = {
  say: SayNode,
  sayFork: SayForkNode,
  goTo: GoToNode,
  action: ActionNode,
  fork: ForkNode,
  dataCollect: DataCollectNode,
  opener: OpenerNode,
  branchHeader: BranchHeaderNode,
  close: CloseNode,
}

// ── CanvasInner ───────────────────────────────────────────────────────────────
// Renders the React Flow canvas. Clicking any node calls onPractice(sectionId)
// so the parent can swap to PracticeView. Nodes are not draggable (Prompt 61).
function CanvasInner({ flow, onPractice }) {
  const graph = useMemo(() => buildGraph(flow), [flow])

  // Clamp panning so the diagram can't scroll off-screen entirely.
  const translateExtent = useMemo(() => {
    if (!graph.nodes.length) return [[-500, -500], [2000, 2000]]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + NODE_W + 60)
      maxY = Math.max(maxY, n.position.y + 150)
    }
    const margin = 400
    return [[minX - margin, minY - margin], [maxX + margin, maxY + margin]]
  }, [graph.nodes])

  const onNodeClick = useCallback((_evt, node) => {
    onPractice(node.data.targetSectionId || node.data.sectionId || 'opener')
  }, [onPractice])

  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0A0A12' }}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.75}
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesFocusable={false}
        nodesDraggable={false}
      >
        <Background color="#1C1C2A" gap={22} size={1} colorMode="dark" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
        <div style={{ padding: '8px 14px', background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click any node to practice from that step</span>
        </div>
      </div>
    </div>
  )
}

// ── PracticeView ──────────────────────────────────────────────────────────────
// Full-height ScriptWalk practice experience starting from a specific section.
// Exit button returns to the canvas.
function PracticeView({ flow, startSectionId, onExit }) {
  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0A0A12' }}>
      <ScriptWalk flow={flow} mode="practice" startSectionId={startSectionId} />
      <button
        onClick={onExit}
        style={{
          position: 'absolute', top: 12, right: 12, zIndex: 5,
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '8px 12px', background: '#13131F',
          border: '0.5px solid var(--border)', borderRadius: 9,
          cursor: 'pointer', color: 'var(--text-secondary)',
          fontSize: 12, fontWeight: 500,
        }}
      >
        <XIcon size={13} /> Exit practice
      </button>
    </div>
  )
}

// ── ScriptCanvas ──────────────────────────────────────────────────────────────
export function ScriptCanvas({ flow }) {
  const [practiceSectionId, setPracticeSectionId] = useState(null)

  if (practiceSectionId !== null) {
    return (
      <PracticeView
        flow={flow}
        startSectionId={practiceSectionId}
        onExit={() => setPracticeSectionId(null)}
      />
    )
  }

  return (
    <ReactFlowProvider>
      <CanvasInner flow={flow} onPractice={setPracticeSectionId} />
    </ReactFlowProvider>
  )
}
