import { useState, useMemo } from 'react'
import { buildScriptFlow } from '../../lib/discoveryScript'
import { buildCloserScriptFlow } from '../../lib/closerScript'
import { ScriptWalk } from '../../components/rep/ScriptWalk'

const DEMO_LEAD = { business_name: 'the business', niche: 'service', city: 'your area' }

const TABS = [
  {
    key: 'closer',
    label: 'Closer Script',
    sub: 'Call 2 — walk the locked stack, price, close',
  },
  {
    key: 'setter',
    label: 'Appointment Setting Script',
    sub: 'Call 1 — reps use this to surface pain and book Nate',
  },
]

export default function CloserScript() {
  const [tab, setTab] = useState('closer')

  const setterFlow = useMemo(() => buildScriptFlow(DEMO_LEAD, null), [])
  const closerFlow = useMemo(() => buildCloserScriptFlow(DEMO_LEAD, null), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>

      {/* Header */}
      <div style={{ marginBottom: 12, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Script
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 3 }}>
          Practice the script one line at a time — pick what the prospect says, see what comes next.
        </p>
      </div>

      {/* Sub-tabs — the sub-labels are full sentences meant to read on one
          line each, so this scrolls horizontally rather than wrapping mid-
          sentence (Prompt 298: previously had no overflow handling at all —
          two `whiteSpace:'nowrap'` labels needing 600px+ combined would just
          overflow the page on a 342px-wide phone). Same pattern as the
          Training Center tab bar fix (Prompt 295). */}
      <div className="overflow-x-auto scrollbar-thin" style={{ display: 'flex', gap: 2, borderBottom: '0.5px solid var(--border)', marginBottom: 14, flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flexShrink: 0,
              padding: '10px 18px', background: 'none', cursor: 'pointer',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'border-color 0.12s',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', color: tab === t.key ? 'var(--accent)' : 'var(--text-muted)' }}>
              {t.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap' }}>
              {t.sub}
            </span>
          </button>
        ))}
      </div>

      {/* Practice — fills remaining height. Keyed on tab so switching between
          Closer/Setter remounts ScriptWalk with fresh state instead of reusing
          stale stack/index positions from the other script's step tree. */}
      <div style={{ flex: 1, minHeight: 0, border: '0.5px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-inset)' }}>
        <ScriptWalk key={tab} flow={tab === 'setter' ? setterFlow : closerFlow} mode="practice" />
      </div>
    </div>
  )
}
