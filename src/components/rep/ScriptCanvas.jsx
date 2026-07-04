import { useCallback, useMemo, useState, useRef } from 'react'
import {
  ReactFlow, ReactFlowProvider, Background, Controls,
  Handle, Position, MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { X as XIcon } from 'lucide-react'
import { ScriptWalk } from './ScriptWalk'
import { CATEGORY_COLORS } from '../../lib/discoveryScript'

// ── ScriptCanvas ─────────────────────────────────────────────────────────────
// Interactive zoomable map of the call script. Prompt 61 changes:
//   - Full page height (height: 100% in the canvas container)
//   - No node dragging (nodesDraggable={false})
//   - Clicking any node replaces the canvas with a ScriptWalk practice view
//     starting from that node's section; Exit returns to the canvas.
//
// Prompt 206 layout rework: the old fixed COL/ROW grid overlapped tall nodes
// (v3's long SAY lines wrap far past a fixed row height) and left big gaps
// after short ones. Layout is now a real auto-layout pass:
//   - each node's height is ESTIMATED from its actual text length (mirroring
//     the node components' CSS: width, font size, line height, clamp), so
//     spacing is driven by real content, not constants;
//   - each section (opener included — its full v3 decision tree used to be
//     invisible, only its first line rendered) is laid out by dagre (tidy
//     layered DAG layout), then the section blocks are arranged left-to-right
//     in actual call order with the Close funnel centered below;
//   - identical repeated subtrees inside a section (the script DSL inlines
//     e.g. the opener's qualifier subtree 4×) are DEDUPED by content hash —
//     later occurrences draw an edge back to the first placement instead of
//     re-laying an identical copy, so the graph shows the true call DAG.

const NODE_W = 240
const HEADER_W = 300
const SECTION_GAP = 170  // horizontal gap between section blocks
const CLOSE_GAP_Y = 180  // below the tallest section block → close header
const SAY_CLAMP = 5      // long SAY lines clamp to 5 lines on canvas (full text in practice mode)

const EDGE_GREY = '#3A3A4A'

function unquote(t) {
  const s = (t || '').trim()
  return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s
}

// Estimated wrapped-line count for text rendered at a given box width and
// font size. Uses a conservative average char width (0.62em) plus word-break
// slack so estimates err TALL — an overestimate costs a little whitespace, an
// underestimate overlaps the node below.
function estLines(text, widthPx, fontSize, clamp) {
  const perLine = Math.max(8, Math.floor(widthPx / (fontSize * 0.62)))
  const lines = Math.max(1, Math.ceil((text || '').length / (perLine * 0.92)))
  return clamp ? Math.min(lines, clamp) : lines
}

// Estimated rendered size per node type — mirrors each component's CSS
// (padding 10/12, tag row ~14px, known font sizes and line heights).
function estSize(type, data) {
  const PAD = 20, TAG = 14
  switch (type) {
    case 'say':
      return { w: NODE_W, h: PAD + TAG + estLines(unquote(data.text), 214, 11.5, SAY_CLAMP) * 17.25 }
    case 'sayFork':
      return {
        w: NODE_W,
        h: PAD + TAG + estLines(unquote(data.text), 214, 11.5, SAY_CLAMP) * 17.25
          + 21 /* divider + margins */ + Math.max(estLines(data.q, 166, 11, 3) * 16, 18),
      }
    case 'fork':
      return { w: NODE_W, h: PAD + Math.max(estLines(data.q, 166, 11, 3) * 16, 18) }
    case 'action':
      return { w: NODE_W, h: PAD + estLines(data.text, 200, 11, 3) * 16 }
    case 'goTo':
      return { w: NODE_W, h: 38 }
    case 'dataCollect':
      return { w: NODE_W, h: PAD + TAG + estLines(data.hint, 214, 10.5) * 15 + (data.fields?.length || 0) * 28 + 24 }
    case 'opener':
      return { w: HEADER_W, h: PAD + 24 + estLines(unquote(data.text), 274, 13) * 19.5 }
    case 'branchHeader':
      return { w: NODE_W, h: PAD + 24 + estLines(data.branch?.trigger, 214, 9.5) * 13 }
    case 'close':
      return { w: HEADER_W, h: PAD + TAG + estLines(data.close?.goal, 274, 11.5) * 17.25 }
    default:
      return { w: NODE_W, h: 60 }
  }
}

const headerNodeId = (sectionId) => (sectionId === 'close' ? 'close-header' : `header-${sectionId}`)
const routeLabel = (flow, target) => {
  const t = flow.byId[target]
  return t?.kind === 'close' ? '→ Close' : `→ ${t?.title || target}`
}
const truncLabel = (l) => (l && l.length > 30 ? l.slice(0, 28).trimEnd() + '…' : l)

// Build React Flow nodes + edges from the derived flow. sectionId is stored
// in each node's data so clicking a node can start ScriptWalk at that section.
function buildGraph(flow) {
  const nodes = []
  const edges = []
  let counter = 0
  const nextId = () => `n${counter++}`

  // Edge color defaults to grey; a fork-option edge carries its response
  // CATEGORY color instead (Prompt 204 fix 4).
  function pushEdge(srcTail, targetId, label, color) {
    const edgeColor = srcTail.color ?? color ?? EDGE_GREY
    edges.push({
      id: `e${counter++}`,
      source: srcTail.id,
      target: targetId,
      label: truncLabel(srcTail.label ?? label) || undefined,
      type: 'smoothstep',
      style: { stroke: edgeColor, strokeWidth: 1.5 },
      labelStyle: { fontSize: 10, fill: edgeColor === EDGE_GREY ? '#9090AA' : edgeColor, fontWeight: 600 },
      labelBgStyle: { fill: '#13131F' },
      labelBgPadding: [5, 3],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeColor },
    })
  }

  // Lay out ONE section as its own dagre subgraph. Returns the block's
  // dimensions; node positions land in `nodes` offset by (offsetX, offsetY)
  // once the block's placement is known (deferred via a records list).
  function layoutSection(section, headerType, headerData, accent) {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 72, marginx: 8, marginy: 8 })
    g.setDefaultEdgeLabel(() => ({}))

    const records = []  // { id, type, data }
    const memo = new Map()  // content hash of a step-sequence slice → nodeId

    function addNode(type, data) {
      const id = nextId()
      const { w, h } = estSize(type, data)
      records.push({ id, type, data: { ...data, estH: h } })
      g.setNode(id, { width: w, height: h })
      return id
    }
    // Header first so dagre ranks it at the top.
    const hid = headerNodeId(section.id)
    {
      const { w, h } = estSize(headerType, headerData)
      records.push({ id: hid, type: headerType, data: { ...headerData, estH: h } })
      g.setNode(hid, { width: w, height: h })
    }

    function connect(tails, targetId) {
      for (const t of tails) {
        pushEdge(t, targetId)
        if (g.hasNode(t.id)) g.setEdge(t.id, targetId)
      }
    }

    // Walk a step sequence, emitting nodes + edges. Dedup: before placing
    // steps[si..], hash the remaining slice — if an identical slice was
    // already placed in this section, edge into its first node and stop.
    function emitChain(steps, incomingTails, si = 0) {
      let tails = incomingTails
      while (si < steps.length) {
        const sliceKey = JSON.stringify(steps.slice(si))
        if (memo.has(sliceKey)) {
          connect(tails, memo.get(sliceKey))
          return []
        }
        const step = steps[si]

        if (step.type === 'route') {
          const targetSection = flow.byId[step.target]
          if (targetSection && targetSection.kind !== 'close') {
            // Terminal "Go to X" pill — no long cross-canvas arrow. Clicking
            // it starts practice at the target section.
            const id = addNode('goTo', { label: routeLabel(flow, step.target), targetSectionId: step.target, accent, sectionId: section.id })
            memo.set(sliceKey, id)
            connect(tails, id)
          } else {
            // Funnel edge to the close header (cross-section, not in dagre).
            for (const t of tails) pushEdge(t, headerNodeId('close'), t.label ?? routeLabel(flow, step.target))
          }
          return []
        }

        if (step.type === 'fork' || step.type === 'say' || step.type === 'action' || step.type === 'data_collect') {
          let nodeId, fork = null, nextSi = si + 1

          if (step.type === 'say') {
            // Peek past interstitial actions for an adjacent fork → combined node.
            let j = si + 1
            while (j < steps.length && steps[j]?.type === 'action') j++
            if (steps[j]?.type === 'fork') {
              fork = steps[j]
              nodeId = addNode('sayFork', { text: step.text, sub: step.sub, q: fork.q, accent, sectionId: section.id })
              nextSi = j + 1
            } else {
              nodeId = addNode('say', { text: step.text, sub: step.sub, accent, sectionId: section.id })
            }
          } else if (step.type === 'fork') {
            fork = step
            nodeId = addNode('fork', { q: step.q, accent, sectionId: section.id })
          } else if (step.type === 'data_collect') {
            nodeId = addNode('dataCollect', { fields: step.fields, label: step.label, hint: step.hint, accent, sectionId: section.id })
          } else {
            nodeId = addNode('action', { text: step.text, sub: step.sub, accent, sectionId: section.id })
          }

          memo.set(sliceKey, nodeId)
          connect(tails, nodeId)

          if (fork) {
            const passthrough = []
            for (const opt of fork.options) {
              const optColor = CATEGORY_COLORS[opt.category]
              const tail = { id: nodeId, label: opt.label, color: optColor }
              if (!opt.steps || opt.steps.length === 0) passthrough.push(tail)
              else passthrough.push(...emitChain(opt.steps, [tail]))
            }
            tails = passthrough
          } else {
            tails = [{ id: nodeId }]
          }
          si = nextSi
          continue
        }

        si++  // unknown step type — skip
      }
      return tails
    }

    emitChain(section.steps, [{ id: hid }])
    dagre.layout(g)

    // dagre returns centers; convert to top-left, collect block extents.
    let maxX = 0, maxY = 0
    const placed = records.map(r => {
      const gn = g.node(r.id)
      const x = gn.x - gn.width / 2
      const y = gn.y - gn.height / 2
      maxX = Math.max(maxX, x + gn.width)
      maxY = Math.max(maxY, y + gn.height)
      return { ...r, x, y }
    })
    return { placed, width: maxX, height: maxY }
  }

  // Sections in actual call order, left → right: the opener's full decision
  // tree, then Vitals → Pain → Handoff → Objections. Close centered below.
  const openerLine = flow.opener.steps[0]?.text || flow.opener.goal
  const blocks = []
  blocks.push(layoutSection(
    { ...flow.opener, steps: flow.opener.steps.slice(1) },  // first line lives in the header card
    'opener', { text: openerLine, accent: flow.opener.color, sectionId: 'opener' }, flow.opener.color,
  ))
  for (const b of flow.branches) {
    blocks.push(layoutSection(b, 'branchHeader', { branch: b, sectionId: b.id }, b.color))
  }

  let offsetX = 0
  let maxBlockH = 0
  for (const blk of blocks) {
    for (const r of blk.placed) {
      nodes.push({ id: r.id, type: r.type, position: { x: r.x + offsetX, y: r.y }, data: { dim: false, active: false, pickable: false, ...r.data } })
    }
    offsetX += blk.width + SECTION_GAP
    maxBlockH = Math.max(maxBlockH, blk.height)
  }
  const totalW = offsetX - SECTION_GAP

  // Close block, centered horizontally, below everything — the funnel target.
  const closeBlk = layoutSection(flow.close, 'close', { close: flow.close, sectionId: 'close' }, flow.close.color)
  const closeX = totalW / 2 - closeBlk.width / 2
  const closeY = maxBlockH + CLOSE_GAP_Y
  for (const r of closeBlk.placed) {
    nodes.push({ id: r.id, type: r.type, position: { x: r.x + closeX, y: r.y + closeY }, data: { dim: false, active: false, pickable: false, ...r.data } })
  }

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

// Long SAY lines clamp on the canvas (SAY_CLAMP lines, full text on hover
// via title + always in practice mode) so node heights stay predictable and
// the layout estimator can't be blown out by one long paragraph.
const clampStyle = (lines) => ({
  display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden',
})

function SayNode({ data }) {
  return (
    <div style={shell(data, data.accent)}>
      <Handles />
      <Tag color={data.accent}>{data.sub ? 'Then say' : 'Say'}</Tag>
      <p title={unquote(data.text)} style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-primary)', lineHeight: 1.5, margin: 0, ...clampStyle(SAY_CLAMP) }}>
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
        <span title={data.text} style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45, ...clampStyle(3) }}>{data.text}</span>
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
      <p title={unquote(data.text)} style={{ fontSize: 11.5, fontStyle: 'italic', color: 'var(--text-primary)', lineHeight: 1.5, margin: '0 0 10px', borderBottom: '0.5px solid var(--border)', paddingBottom: 10, ...clampStyle(SAY_CLAMP) }}>
        {unquote(data.text)}
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--accent)', background: 'rgba(108,99,255,0.20)', borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap' }}>if/else</span>
        {data.q && <span title={data.q} style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45, ...clampStyle(3) }}>{data.q}</span>}
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
        <span title={data.q} style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45, ...clampStyle(3) }}>{data.q}</span>
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
      maxX = Math.max(maxX, n.position.x + HEADER_W)
      maxY = Math.max(maxY, n.position.y + (n.data.estH || 150))
    }
    const margin = 400
    return [[minX - margin, minY - margin], [maxX + margin, maxY + margin]]
  }, [graph.nodes])

  const rfInstance = useRef(null)

  const onNodeClick = useCallback((_evt, node) => {
    onPractice(node.data.targetSectionId || node.data.sectionId || 'opener')
  }, [onPractice])

  const onInit = useCallback((instance) => {
    rfInstance.current = instance
    setTimeout(() => instance.fitView({ padding: 0.15 }), 50)
  }, [])

  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 14, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0A0A12' }}>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.18}
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
