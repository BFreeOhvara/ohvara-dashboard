import { useState, useMemo } from 'react'
import { ChevronRight, ChevronLeft, RotateCcw, CornerDownRight, ArrowRight, CheckCircle2, CalendarCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// ── ScriptWalk ───────────────────────────────────────────────────────────────
// The guided, one-line-at-a-time call experience. Reads a flow from
// buildScriptFlow() (a pure derivation of the shared DISCOVERY_SCRIPT) and walks
// the rep through it a single step at a time: read the line, tap what the
// prospect did, the next line appears. Same component drives the live Call modal
// (mode="live") and the Training Center practice tab (mode="practice").
//
// Navigation is a stack of frames { steps, index }. The active step is the top
// frame's current step. Forks push an option frame; when it exhausts we pop and
// step past the fork in the parent. Routes (→ CLOSE / run BRANCH A) hard-jump to
// another block. An undo history backs the Back button.

export function ScriptWalk({ flow, mode = 'live', leadId }) {
  const start = useMemo(
    () => ({ sectionId: 'opener', stack: [{ steps: flow.opener.steps, index: 0 }] }),
    [flow]
  )
  const [state, setState] = useState(start)
  const [history, setHistory] = useState([])

  const section = flow.byId[state.sectionId]
  const top = state.stack[state.stack.length - 1]
  const baseExhausted = state.stack.length === 1 && top.index >= top.steps.length
  const atChooser = baseExhausted && state.sectionId === 'opener'
  const atTerminal = baseExhausted && state.sectionId !== 'opener'
  const step = !baseExhausted ? top.steps[top.index] : null
  const accent = section.color

  function commit(next) {
    setHistory(h => [...h, state])
    setState(next)
  }
  function cloneStack() {
    return state.stack.map(f => ({ steps: f.steps, index: f.index }))
  }
  function advance() {
    const ns = cloneStack()
    let t = ns[ns.length - 1]
    t.index++
    // popping an exhausted option frame steps the parent past its fork
    while (ns.length > 1 && t.index >= t.steps.length) {
      ns.pop()
      t = ns[ns.length - 1]
      t.index++
    }
    commit({ ...state, stack: ns })
  }
  function chooseOption(opt) {
    if (!opt.steps || !opt.steps.length) return advance()
    const ns = cloneStack()
    ns.push({ steps: opt.steps, index: 0 })
    commit({ ...state, stack: ns })
  }
  function navigateTo(id) {
    commit({ sectionId: id, stack: [{ steps: flow.byId[id].steps, index: 0 }] })
  }
  function back() {
    if (!history.length) return
    setState(history[history.length - 1])
    setHistory(h => h.slice(0, -1))
  }
  function restart() {
    commit({ sectionId: 'opener', stack: [{ steps: flow.opener.steps, index: 0 }] })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Track header — which part of the tree the rep is on. Hidden in the
          live Call modal (Prompt 49 — the "Fixed Opener / Same words" card was
          clutter mid-call); kept for the practice walk. */}
      {mode !== 'live' && (
        <div style={{ flexShrink: 0, padding: '12px 18px 10px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 20, height: 20, borderRadius: 6, background: accent, color: '#0E0E1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {section.short}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.title}</p>
            {section.trigger && <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{section.trigger}</p>}
          </div>
          {mode === 'practice' && <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Practice</span>}
        </div>
      )}

      {/* Stage — the current step, the response chooser, or the terminal card */}
      <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column' }}>

        {atChooser && (
          <Chooser accent={accent} branches={flow.branches} onPick={navigateTo} />
        )}

        {atTerminal && (
          <Terminal section={section} mode={mode} onRestart={restart} />
        )}

        {step && step.type === 'fork' && (
          <Fork step={step} accent={accent} onPick={chooseOption} />
        )}

        {step && step.type === 'say' && (
          <SayCard step={step} accent={accent} onNext={advance} />
        )}

        {step && step.type === 'action' && (
          <ActionCard step={step} accent={accent} onNext={advance} />
        )}

        {step && step.type === 'data_collect' && (
          <DataCollectCard step={step} accent={accent} leadId={leadId} mode={mode} onNext={advance} />
        )}

        {step && step.type === 'route' && (
          <RouteCard step={step} accent={accent} flow={flow} onGo={() => navigateTo(step.target)} />
        )}

        {/* Coach note for the current track — hidden in the live Call modal
            (Prompt 49); kept for the practice walk. */}
        {mode !== 'live' && section.tips && !atChooser && (
          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.55, margin: '16px 4px 0' }}>
            💡 {section.tips}
          </p>
        )}
      </div>

      {/* Controls — Back / Restart */}
      <div style={{ flexShrink: 0, padding: '10px 18px', borderTop: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0C0C16' }}>
        <button
          onClick={back}
          disabled={!history.length}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: history.length ? 'pointer' : 'not-allowed', color: history.length ? 'var(--text-secondary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 500, opacity: history.length ? 1 : 0.5, padding: 4 }}
        >
          <ChevronLeft size={14} /> Back
        </button>
        <button
          onClick={restart}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, fontWeight: 500, padding: 4 }}
        >
          <RotateCcw size={12} /> Start over
        </button>
      </div>
    </div>
  )
}

// One spoken line — the words to read, big and clear, with a Next advance.
function SayCard({ step, accent, onNext }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>
        {step.sub ? 'Then say' : 'Say this'}
      </p>
      <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: '18px 20px' }}>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{step.text}</p>
      </div>
      <NextButton accent={accent} onClick={onNext} label="Next" />
    </div>
  )
}

// A ▸ action the rep performs (log a note, set a status).
function ActionCard({ step, accent, onNext }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>Do this</p>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: accent + '14', border: `0.5px solid ${accent}55`, borderRadius: 12, padding: '16px 18px' }}>
        <span style={{ color: accent, fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>▸</span>
        <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{step.text}</p>
      </div>
      <NextButton accent={accent} onClick={onNext} label="Next" />
    </div>
  )
}

// Inline data capture (Prompt 53, Change 3) — the rep logs calls-missed/week
// and average ticket mid-call. In live mode "Save & Continue" PATCHes the lead
// then advances; a save failure is logged but never blocks the call. In
// practice mode (no real lead) it just advances.
function DataCollectCard({ step, accent, leadId, mode, onNext }) {
  const [vals, setVals] = useState({})
  const [saving, setSaving] = useState(false)

  async function saveAndContinue() {
    if (mode === 'live' && leadId) {
      setSaving(true)
      const patch = {}
      for (const f of step.fields) {
        const v = vals[f.key]
        patch[f.key] = (v === undefined || v === '') ? null : Number(v)
      }
      try {
        const { error } = await supabase.from('leads').update(patch).eq('id', leadId)
        if (error) throw error
      } catch (err) {
        // Never block a live call — log and advance regardless.
        console.error('[ScriptWalk] data_collect save failed:', err)
      } finally {
        setSaving(false)
      }
    }
    onNext()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>{step.label || 'Log the numbers'}</p>
      {step.hint && (
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{step.hint}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {step.fields.map(f => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.label}</label>
            <input
              type="number"
              min="0"
              value={vals[f.key] ?? ''}
              onChange={e => setVals(v => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              style={{
                height: 44, padding: '0 14px', background: 'var(--bg-elevated)',
                border: '0.5px solid var(--border)', borderRadius: 10,
                fontSize: 16, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
              }}
            />
          </div>
        ))}
      </div>
      <NextButton accent={accent} onClick={saveAndContinue} label={saving ? 'Saving…' : 'Save & Continue'} />
    </div>
  )
}

// A route to another block (→ CLOSE, run BRANCH A) — an explicit jump button.
function RouteCard({ step, accent, flow, onGo }) {
  const target = flow.byId[step.target]
  const label = target?.kind === 'close' ? 'Go to the close' : `Go to ${target?.title || step.target}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>Next move</p>
      <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
        <CornerDownRight size={16} color={accent} style={{ flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', margin: 0 }}>{step.text}</p>
      </div>
      <button
        onClick={onGo}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, background: target?.color || accent, border: 'none', borderRadius: 11, fontSize: 14.5, fontWeight: 600, color: '#0E0E1A', cursor: 'pointer' }}
      >
        {label} <ArrowRight size={16} />
      </button>
    </div>
  )
}

// A decision point — the prospect responded, tap which way it went.
function Fork({ step, accent, onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>What did they do?</p>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{step.q}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
        {step.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onPick(opt)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left', padding: '14px 16px', background: 'var(--bg-elevated)', border: `0.5px solid ${accent}55`, borderRadius: 11, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14.5, fontWeight: 500 }}
            onMouseEnter={e => { e.currentTarget.style.background = accent + '1A'; e.currentTarget.style.borderColor = accent }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = accent + '55' }}
          >
            {opt.label}
            <ChevronRight size={16} color={accent} style={{ flexShrink: 0 }} />
          </button>
        ))}
      </div>
    </div>
  )
}

// The response chooser shown right after the opener — pick the branch.
function Chooser({ accent, branches, onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>How did they respond?</p>
      <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>Tap who you're talking to — the script routes from there.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
        {branches.map(b => (
          <button
            key={b.id}
            onClick={() => onPick(b.id)}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 11, textAlign: 'left', padding: '13px 15px', background: b.dim, border: `0.5px solid ${b.border}`, borderLeft: `3px solid ${b.color}`, borderRadius: 11, cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = b.color + '22' }}
            onMouseLeave={e => { e.currentTarget.style.background = b.dim }}
          >
            <span style={{ width: 20, height: 20, borderRadius: 6, background: b.color, color: '#0E0E1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{b.short}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: b.color }}>{b.title}</span>
              {b.trigger && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1, lineHeight: 1.4 }}>{b.trigger}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// End of a path — tell the rep the outcome to log (or, on the close, to book).
function Terminal({ section, mode, onRestart }) {
  const isClose = section.kind === 'close'
  const outcome = section.outcome
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', textAlign: 'center', margin: 'auto 0', padding: '8px 0' }}>
      <div style={{ width: 46, height: 46, borderRadius: 13, background: (isClose ? 'var(--success)' : section.color) + '22', border: `0.5px solid ${(isClose ? 'var(--success)' : section.color)}55`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {isClose ? <CalendarCheck size={20} color="var(--success)" /> : <CheckCircle2 size={20} color={section.color} />}
      </div>
      <div>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 6px' }}>
          {isClose ? 'Lock the appointment' : 'End of this path'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, maxWidth: 320 }}>
          {isClose
            ? mode === 'live'
              ? 'Once they pick a time, set Appointment Booked on the left, enter the time, and hit Done.'
              : 'This is where you book Nate — set the appointment and you’re done.'
            : outcome
              ? mode === 'live'
                ? `Set the status to "${outcome}" on the left and hit Done.`
                : `This path ends on "${outcome}".`
              : 'Set the call outcome and hit Done.'}
        </p>
      </div>
      <button
        onClick={onRestart}
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 9, padding: '8px 16px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 500 }}
      >
        <RotateCcw size={13} /> Start over
      </button>
    </div>
  )
}

function NextButton({ accent, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: 46, background: accent, border: 'none', borderRadius: 11, fontSize: 14.5, fontWeight: 600, color: '#0E0E1A', cursor: 'pointer', marginTop: 2 }}
    >
      {label} <ChevronRight size={17} />
    </button>
  )
}
