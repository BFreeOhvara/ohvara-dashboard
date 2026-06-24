import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
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
// option widths; a chain's width is the max width of any step in it. A route
// to another branch is INLINED (Prompt 53, Change 1), so it contributes that
// branch's full width here; `visited` guards against any cyclic route.
function measureSteps(steps, flow, visited) {
  let w = 1
  for (const s of steps) {
    if (s.type === 'fork') {
      let fw = 0
      for (const opt of s.options) fw += Math.max(1, measureSteps(opt.steps, flow, visited))
      w = Math.max(w, fw)
    } else if (s.type === 'route' && flow?.byId[s.target]?.kind === 'branch') {
      const seen = visited || new Set()
      if (!seen.has(s.target)) {
        w = Math.max(w, measureSteps(flow.byId[s.target].steps, flow, new Set([...seen, s.target])))
      }
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

    for (const step of steps) {
      if (step.type === 'route') {
        const targetSection = flow.byId[step.target]
        if (targetSection?.kind === 'branch' && !visited.has(step.target)) {
          // Inline the target branch's steps — no looping back-ref edge.
          // Inlined nodes carry the target branch's sectionId so clicking
          // them starts practice at that branch (Prompt 53, Change 1).
          const r = placeSteps(targetSection.steps, bandLeftPx, bandCols, y, tails, label, accent, new Set([...visited, step.target]), step.target)
          tails = r.tails
          y = r.endY
          label = null
          continue
        }
        // forward route (to close, or a guard-tripped cyclic branch)
        const tgt = headerNodeId(step.target)
        for (const t of tails) pushEdge(t, tgt, label ?? routeLabel(flow, step.target))
        label = null
        tails = []
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
        continue
      }

      if (step.type === 'data_collect') {
        const id = nextId()
        makeNode(id, 'dataCollect', { fields: step.fields, label: step.label, hint: step.hint, accent }, centerX, y, sectionId)
        for (const t of tails) pushEdge(t, id, label)
        label = null
        tails = [{ id }]
        y += ROW
        continue
      }

      // say / action — a single node
      const id = nextId()
      makeNode(id, step.type, { text: step.text, sub: step.sub, accent }, centerX, y, sectionId)
      for (const t of tails) pushEdge(t, id, label)
      label = null
      tails = [{ id }]
      y += ROW
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
      <p style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
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
        <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>{data.text}</span>
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

function ForkNode({ data }) {
  return (
    <div style={shell(data, 'var(--accent)', { background: 'rgba(108,99,255,0.10)', border: data.active || data.pickable ? undefined : '1px solid rgba(108,99,255,0.30)' })}>
      <Handles />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--accent)', background: 'rgba(108,99,255,0.20)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap' }}>if/else</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{data.q}</span>
      </div>
    </div>
  )
}

function OpenerNode({ data }) {
  return (
    <div style={shell(data, data.accent, { width: 300, borderLeft: `3px solid ${data.accent}` })}>
      <Handles />
      <Tag color={data.accent}>Opener · same every call</Tag>
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
      <p style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{c.goal}</p>
    </div>
  )
}

const nodeTypes = {
  say: SayNode,
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

  const onNodeClick = useCallback((_evt, node) => {
    onPractice(node.data.sectionId || 'opener')
  }, [onPractice])

  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0A0A12' }}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesFocusable={false}
        nodesDraggable={false}
      >
        <Background color="#1C1C2A" gap={22} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable zoomable
          maskColor="rgba(8,8,16,0.7)"
          style={{ background: '#0E0E1A', border: '0.5px solid var(--border)' }}
          nodeColor={n => (n.type === 'branchHeader' || n.type === 'fork' ? '#6C63FF' : '#2A2A3A')}
        />
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
