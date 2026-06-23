import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  Handle, Position, MarkerType, useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Play, X as XIcon, RotateCcw, CheckCircle2, CalendarCheck } from 'lucide-react'

// ── ScriptCanvas ─────────────────────────────────────────────────────────────
// Interactive zoomable map of the call script (Prompt 48). Replaces the static
// ScriptFlowchart + the separate Practice tab with a single React Flow canvas:
// every step is a node, every connection a drawn edge, back-references loop
// back as real edges, and click-through practice runs ON the canvas.
//
// Pure derivation of buildScriptFlow() — no duplicated script content. The
// layout engine (measureSteps + placeSteps) walks the same step tree the
// flowchart/walk use and assigns the x/y positions React Flow needs.

const NODE_W = 240
const COL = NODE_W + 70   // horizontal column unit
const ROW = 156           // vertical step unit
const BRANCH_GAP_Y = 210  // opener bottom → branch header row
const CLOSE_GAP_Y = 120   // tallest branch bottom → close header

const EDGE_GREY = '#3A3A4A'
const ACCENT = '#6C63FF'

function unquote(t) {
  const s = (t || '').trim()
  return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s
}

// Subtree width in columns: a linear chain is 1; a fork is the sum of its
// option widths; a chain's width is the max width of any step in it.
function measureSteps(steps) {
  let w = 1
  for (const s of steps) {
    if (s.type === 'fork') {
      let fw = 0
      for (const opt of s.options) fw += Math.max(1, measureSteps(opt.steps))
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

// Build React Flow nodes + edges + an adjacency map (for practice navigation)
// from the derived flow. Deterministic — same flow always lays out identically.
function buildGraph(flow) {
  const nodes = []
  const edges = []
  let counter = 0
  const nextId = () => `n${counter++}`

  function pushEdge(srcTail, targetId, label, kind) {
    const isBack = kind === 'backref'
    edges.push({
      id: `e${counter++}`,
      source: srcTail.id,
      target: targetId,
      sourceHandle: isBack ? 'lsource' : undefined,
      targetHandle: isBack ? 'ltarget' : undefined,
      label: (srcTail.label ?? label) || undefined,
      type: isBack ? 'default' : 'smoothstep',
      animated: isBack,
      style: {
        stroke: isBack ? ACCENT : EDGE_GREY,
        strokeWidth: 1.5,
        ...(isBack ? { strokeDasharray: '5 4' } : null),
      },
      labelStyle: { fontSize: 10, fill: '#9090AA', fontWeight: 600 },
      labelBgStyle: { fill: '#13131F' },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: isBack ? ACCENT : EDGE_GREY },
    })
  }

  function makeNode(id, type, data, x, y) {
    nodes.push({ id, type, position: { x, y }, data: { dim: false, active: false, pickable: false, ...data } })
    return id
  }

  // Lay out a sequence of steps within a horizontal band. incomingTails carry
  // an optional per-tail label (used when an empty fork option must label the
  // edge into the next step). Returns { tails, endY }.
  function placeSteps(steps, bandLeftPx, bandCols, startY, incomingTails, incomingLabel, accent) {
    let tails = incomingTails
    let label = incomingLabel
    let y = startY
    const centerX = bandLeftPx + (bandCols * COL) / 2 - NODE_W / 2

    for (const step of steps) {
      if (step.type === 'route') {
        const isBack = flow.byId[step.target]?.kind === 'branch'
        const tgt = headerNodeId(step.target)
        for (const t of tails) pushEdge(t, tgt, label ?? routeLabel(flow, step.target), isBack ? 'backref' : 'forward')
        label = null
        tails = []          // a route jumps away — nothing continues in this chain
        continue
      }

      if (step.type === 'fork') {
        const id = nextId()
        makeNode(id, 'fork', { q: step.q, accent }, centerX, y)
        for (const t of tails) pushEdge(t, id, label, 'forward')
        label = null

        const optY = y + ROW
        let optLeftCols = 0
        const optTails = []
        let maxEndY = optY
        for (const opt of step.options) {
          const optCols = Math.max(1, measureSteps(opt.steps))
          const optLeftPx = bandLeftPx + optLeftCols * COL
          if (opt.steps.length === 0) {
            // empty option (e.g. close's "IF NO:") — the fork is the tail and
            // this option's label rides the edge into the next post-fork step.
            optTails.push({ id, label: opt.label })
          } else {
            const r = placeSteps(opt.steps, optLeftPx, optCols, optY, [{ id }], opt.label, accent)
            for (const tt of r.tails) optTails.push(tt)
            maxEndY = Math.max(maxEndY, r.endY)
          }
          optLeftCols += optCols
        }
        tails = optTails
        y = maxEndY
        continue
      }

      // say / action — a single node
      const id = nextId()
      makeNode(id, step.type, { text: step.text, sub: step.sub, accent }, centerX, y)
      for (const t of tails) pushEdge(t, id, label, 'forward')
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
    const cols = Math.max(1, measureSteps(b.steps))
    const bandLeftPx = leftCols * COL
    const hx = bandLeftPx + (cols * COL) / 2 - NODE_W / 2
    const hid = headerNodeId(b.id)
    makeNode(hid, 'branchHeader', { branch: b }, hx, BRANCH_GAP_Y)
    pushEdge({ id: 'opener' }, hid, b.short, 'forward')
    const r = placeSteps(b.steps, bandLeftPx, cols, BRANCH_GAP_Y + ROW, [{ id: hid }], null, b.color)
    maxBranchEndY = Math.max(maxBranchEndY, r.endY)
    leftCols += cols
  }
  const totalW = leftCols * COL

  // Opener centered over the full branch row.
  const openerLine = flow.opener.steps[0]?.text || flow.opener.goal
  makeNode('opener', 'opener', { text: openerLine, accent: flow.opener.color }, totalW / 2 - NODE_W / 2, 0)

  // Close centered below the tallest branch, with its own step tree beneath.
  const closeCols = Math.max(1, measureSteps(flow.close.steps))
  const closeY = maxBranchEndY + CLOSE_GAP_Y
  const closeBandLeft = totalW / 2 - (closeCols * COL) / 2
  makeNode('close-header', 'close', { close: flow.close }, totalW / 2 - NODE_W / 2, closeY)
  placeSteps(flow.close.steps, closeBandLeft, closeCols, closeY + ROW, [{ id: 'close-header' }], null, flow.close.color)

  const outgoing = {}
  for (const e of edges) (outgoing[e.source] ||= []).push(e.target)

  return { nodes, edges, outgoing }
}

// ── Node shells ───────────────────────────────────────────────────────────────
const HANDLE = { width: 7, height: 7, opacity: 0, border: 'none', background: 'transparent', minWidth: 0, minHeight: 0 }

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} style={HANDLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE} />
      <Handle type="target" position={Position.Left} id="ltarget" style={{ ...HANDLE, top: '38%' }} />
      <Handle type="source" position={Position.Left} id="lsource" style={{ ...HANDLE, top: '62%' }} />
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
    cursor: active || pickable ? 'pointer' : 'default',
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
  opener: OpenerNode,
  branchHeader: BranchHeaderNode,
  close: CloseNode,
}

// ── Canvas ────────────────────────────────────────────────────────────────────
function CanvasInner({ flow }) {
  const graph = useMemo(() => buildGraph(flow), [flow])
  const baseById = useMemo(() => {
    const m = {}
    for (const n of graph.nodes) m[n.id] = n
    return m
  }, [graph])

  const [positions, setPositions] = useState({})   // drag overrides, keyed by node id
  const [practice, setPractice] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [history, setHistory] = useState([])
  const rf = useReactFlow()

  const pickable = useMemo(() => {
    if (!practice || !activeId) return new Set()
    const outs = graph.outgoing[activeId] || []
    return outs.length > 1 ? new Set(outs) : new Set()
  }, [practice, activeId, graph])

  const atTerminal = practice && activeId && (graph.outgoing[activeId] || []).length === 0

  // Rendered nodes are derived (not stored) so practice highlight/dim flags
  // never need a setState-in-effect — they recompute from practice/activeId,
  // while drag positions persist via the `positions` override map.
  const nodes = useMemo(() => graph.nodes.map(n => {
    const pos = positions[n.id] || n.position
    if (!practice) return positions[n.id] ? { ...n, position: pos } : n
    const active = n.id === activeId
    const pick = pickable.has(n.id)
    return { ...n, position: pos, data: { ...n.data, active, pickable: pick, dim: !active && !pick } }
  }), [graph, positions, practice, activeId, pickable])

  // Frame the focus: a chooser frames its options too; otherwise center the
  // node. Imperative React Flow calls only — no React state set here.
  useEffect(() => {
    if (!practice || !activeId) return
    const ids = pickable.size > 0 ? [activeId, ...pickable] : [activeId]
    const present = ids.filter(id => baseById[id])
    if (pickable.size > 0) {
      rf.fitView({ nodes: present.map(id => ({ id })), duration: 450, padding: 0.35, maxZoom: 1 })
    } else {
      const n = baseById[activeId]
      if (n) rf.setCenter(n.position.x + NODE_W / 2, n.position.y + 50, { zoom: 1, duration: 450 })
    }
  }, [activeId, practice, pickable, baseById, rf])

  const onNodesChange = useCallback((changes) => {
    // Persist only drag position changes; ignore selection/dimension churn.
    setPositions(prev => {
      let next = prev
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          if (next === prev) next = { ...prev }
          next[c.id] = c.position
        }
      }
      return next
    })
  }, [])

  function startPractice() {
    setPractice(true)
    setActiveId('opener')
    setHistory([])
  }
  function exitPractice() {
    setPractice(false)
    setActiveId(null)
    setHistory([])
    rf.fitView({ duration: 450, padding: 0.15 })
  }
  function restart() {
    setHistory(h => (activeId ? [...h, activeId] : h))
    setActiveId('opener')
  }
  function back() {
    setHistory(h => {
      if (!h.length) return h
      setActiveId(h[h.length - 1])
      return h.slice(0, -1)
    })
  }

  const onNodeClick = useCallback((_evt, node) => {
    if (!practice) return
    const outs = graph.outgoing[node.id] || []
    if (node.id === activeId) {
      if (outs.length === 1) {
        setHistory(h => [...h, node.id])
        setActiveId(outs[0])
      }
      // chooser (outs>1): wait for a target pick; terminal (0): no-op
    } else if (pickable.has(node.id)) {
      setHistory(h => [...h, activeId])
      setActiveId(node.id)
    }
  }, [practice, activeId, pickable, graph])

  return (
    <div style={{ position: 'relative', height: 640, borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0A0A12' }}>
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesFocusable={false}
        nodesDraggable
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

      {/* Practice control — floating top-right */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 5, display: 'flex', gap: 8 }}>
        {!practice ? (
          <button
            onClick={startPractice}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent)', border: 'none', borderRadius: 9, cursor: 'pointer', color: 'white', fontSize: 12.5, fontWeight: 600, boxShadow: '0 6px 20px rgba(108,99,255,0.4)' }}
          >
            <Play size={13} fill="white" /> Start Practice
          </button>
        ) : (
          <>
            <button
              onClick={back}
              disabled={!history.length}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 9, cursor: history.length ? 'pointer' : 'not-allowed', color: history.length ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 500, opacity: history.length ? 1 : 0.6 }}
            >
              Back
            </button>
            <button
              onClick={restart}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 9, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}
            >
              <RotateCcw size={12} /> Restart
            </button>
            <button
              onClick={exitPractice}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 9, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500 }}
            >
              <XIcon size={13} /> Exit
            </button>
          </>
        )}
      </div>

      {/* Practice hint / terminal banner — floating bottom-center */}
      {practice && (
        <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 5, maxWidth: 460 }}>
          {atTerminal ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 16px', background: '#13131F', border: `0.5px solid ${baseById[activeId]?.type === 'close' ? 'var(--success)' : 'var(--border)'}`, borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              {baseById[activeId]?.type === 'close'
                ? <CalendarCheck size={16} color="var(--success)" />
                : <CheckCircle2 size={16} color="var(--accent)" />}
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                End of this path — <button onClick={restart} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: 12.5, padding: 0 }}>start over</button> or exit.
              </span>
            </div>
          ) : (
            <div style={{ padding: '8px 14px', background: '#13131F', border: '0.5px solid var(--border)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {pickable.size > 0 ? 'Tap the prospect’s response to continue' : 'Tap the highlighted card to advance'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ScriptCanvas({ flow }) {
  return (
    <ReactFlowProvider>
      <CanvasInner flow={flow} />
    </ReactFlowProvider>
  )
}
