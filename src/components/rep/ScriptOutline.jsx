import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, X as XIcon, CornerDownRight } from 'lucide-react'
import { ScriptWalk } from './ScriptWalk'
import { CATEGORY_COLORS } from '../../lib/discoveryScript'

// ── ScriptOutline ────────────────────────────────────────────────────────────
// Prompt 208 — replaces ScriptCanvas (the React Flow node-graph "map" view).
// Two rounds of canvas layout fixes (Prompts 204, 206) still left connector
// lines crossing through boxes on Brayden's real screenshots, even after a
// zero-node-overlap auto-layout pass — a drawn line can cross an unrelated
// box's interior without the boxes themselves overlapping. Brayden's call:
// stop drawing connector lines at all. This is a plain nested text outline —
// hierarchy is indentation only, so nothing can visually cross or overlap,
// by construction.
//
// Practice mode itself (ScriptWalk, one-line-at-a-time) is UNTOUCHED — this
// component only replaces the "see the whole script at once" surface.
// Clicking any row enters practice at that row's section, same contract the
// canvas provided (both only ever supported section-level granularity, not
// mid-section node targeting — ScriptWalk's API has no such thing).

// Strip surrounding double-quotes if the entire string is quoted.
function unquote(t) {
  const s = (t || '').trim()
  return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s
}

// Flatten one section's step tree into a linear list of display rows.
// Depth drives indentation; no coordinates, no drawn connectors.
//
// Dedup (same problem Prompt 206 solved for the canvas): the script DSL
// inlines identical subtrees everywhere they're reachable (e.g. the opener's
// qualifier subtree is reachable via 3 different paths — it's copy-pasted 3x
// in the raw script, not referenced). Before walking a step sequence, hash
// its content; if an identical sequence was already rendered earlier in this
// section, emit a short "same as above" reference instead of repeating it.
function flattenSection(steps) {
  const rows = []
  const memo = new Map()

  function anchorLabel(stepsArr) {
    for (const s of stepsArr) {
      if (s.type === 'say') return unquote(s.text)
      if (s.type === 'fork') return s.q
      if (s.type === 'action') return s.text
      if (s.type === 'route') return s.text
    }
    return null
  }

  function walk(stepsArr, depth) {
    if (!stepsArr || !stepsArr.length) return
    const key = JSON.stringify(stepsArr)
    if (memo.has(key)) {
      rows.push({ type: 'dedupRef', depth, anchor: memo.get(key) })
      return
    }
    memo.set(key, anchorLabel(stepsArr))

    for (const step of stepsArr) {
      if (step.type === 'say') {
        rows.push({ type: 'say', depth, text: step.text, sub: step.sub, capture: step.capture })
      } else if (step.type === 'action') {
        rows.push({ type: 'action', depth, text: step.text })
      } else if (step.type === 'route') {
        rows.push({ type: 'route', depth, text: step.text })
      } else if (step.type === 'data_collect') {
        rows.push({ type: 'capture', depth, label: step.label, hint: step.hint, fields: step.fields })
      } else if (step.type === 'fork') {
        rows.push({ type: 'forkQuestion', depth, text: step.q })
        for (const opt of step.options) {
          rows.push({ type: 'option', depth: depth + 1, text: opt.label, category: opt.category })
          walk(opt.steps, depth + 2)
        }
      }
    }
  }

  walk(steps, 0)
  return rows
}

const INDENT = 18

function OutlineRow({ row, accent }) {
  const pad = 14 + row.depth * INDENT

  if (row.type === 'say') {
    return (
      <div style={{ padding: '5px 10px 5px', paddingLeft: pad }}>
        <p style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.55, margin: 0, fontStyle: row.sub ? 'italic' : 'normal' }}>
          <span style={{ color: 'var(--text-muted)', fontWeight: 600, fontSize: 10.5, marginRight: 7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {row.sub ? 'then say' : 'say'}
          </span>
          {unquote(row.text)}
        </p>
        {row.capture && (
          <p style={{ fontSize: 10.5, color: 'var(--success)', margin: '2px 0 0', fontStyle: 'italic' }}>
            ⊞ captures: {row.capture.label}
          </p>
        )}
      </div>
    )
  }

  if (row.type === 'action') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 10px', paddingLeft: pad }}>
        <span style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 700, marginTop: 1, flexShrink: 0 }}>▸</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{row.text}</span>
      </div>
    )
  }

  if (row.type === 'route') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 10px', paddingLeft: pad }}>
        <CornerDownRight size={12} color="var(--info)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: 'var(--info)', fontWeight: 500 }}>{row.text}</span>
      </div>
    )
  }

  if (row.type === 'capture') {
    return (
      <div style={{ padding: '4px 10px', paddingLeft: pad }}>
        <span style={{ fontSize: 11, color: 'var(--success)', fontStyle: 'italic' }}>
          ⊞ {row.label || 'Log on the call'}{row.fields?.length ? ` — ${row.fields.map(f => f.label).join(', ')}` : ''}
        </span>
      </div>
    )
  }

  if (row.type === 'forkQuestion') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 10px 2px', paddingLeft: pad }}>
        <span style={{ fontSize: 8.5, fontWeight: 700, color: accent, background: `${accent}22`, borderRadius: 3, padding: '1px 5px', flexShrink: 0, marginTop: 1, whiteSpace: 'nowrap' }}>
          if/else
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{row.text}</span>
      </div>
    )
  }

  if (row.type === 'option') {
    const c = CATEGORY_COLORS[row.category]
    return (
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '3px 10px', paddingLeft: pad }}>
        {c
          ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, flexShrink: 0 }} />
          : <span style={{ width: 6, height: 6, borderRadius: '50%', border: '1px solid var(--text-muted)', flexShrink: 0 }} />}
        <span style={{ fontSize: 12, color: c || 'var(--text-secondary)', fontWeight: 500 }}>{row.text}</span>
      </div>
    )
  }

  if (row.type === 'dedupRef') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 10px', paddingLeft: pad }}>
        <CornerDownRight size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          same path as above — "{(row.anchor || '').length > 60 ? row.anchor.slice(0, 58).trimEnd() + '…' : row.anchor}"
        </span>
      </div>
    )
  }

  return null
}

function SectionBlock({ section, expanded, onToggle, onPractice }) {
  const rows = useMemo(() => flattenSection(section.steps), [section.steps])
  return (
    <div style={{ borderLeft: `3px solid ${section.color}`, background: section.dim, borderRadius: 8, marginBottom: 10, overflow: 'hidden' }}>
      {/* Two SIBLING controls, not nested — a button inside a button is
          invalid HTML and silently breaks the inner click in some browsers. */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px' }}>
        <button
          onClick={onToggle}
          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          {expanded ? <ChevronDown size={14} color={section.color} /> : <ChevronRight size={14} color={section.color} />}
          <span style={{ width: 19, height: 19, borderRadius: 5, flexShrink: 0, background: section.color, color: '#0E0E1A', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {section.short}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: section.color, flexShrink: 0 }}>{section.title}</span>
          {section.trigger && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.trigger}</span>}
        </button>
        <button
          onClick={onPractice}
          style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: section.color, background: 'none', border: `0.5px solid ${section.color}55`, borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
        >
          Practice this section →
        </button>
      </div>
      {expanded && (
        <div style={{ paddingBottom: 8 }}>
          {rows.map((row, i) => <OutlineRow key={i} row={row} accent={section.color} />)}
        </div>
      )}
    </div>
  )
}

// Full-height ScriptWalk practice experience starting from a specific
// section. Exit button returns to the outline. Same shell ScriptCanvas used.
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

export function ScriptOutline({ flow }) {
  const [practiceSectionId, setPracticeSectionId] = useState(null)
  const sections = useMemo(() => [flow.opener, ...flow.branches, flow.close], [flow])
  const [collapsed, setCollapsed] = useState({})

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
    <div className="scrollbar-thin" style={{ height: '100%', overflowY: 'auto', border: '0.5px solid var(--border)', borderRadius: 14, padding: 14, background: '#0A0A12', boxSizing: 'border-box' }}>
      {sections.map(section => (
        <SectionBlock
          key={section.id}
          section={section}
          expanded={!collapsed[section.id]}
          onToggle={() => setCollapsed(c => ({ ...c, [section.id]: !c[section.id] }))}
          onPractice={() => setPracticeSectionId(section.id)}
        />
      ))}
    </div>
  )
}
