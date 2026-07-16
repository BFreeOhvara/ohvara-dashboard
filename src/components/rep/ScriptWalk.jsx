import { useState, useMemo, useRef, useCallback } from 'react'
import { ChevronRight, ChevronLeft, RotateCcw, CornerDownRight, ArrowRight, CheckCircle2, CalendarCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { CATEGORY_COLORS, OUTCOME_COLORS, extractSetStatus } from '../../lib/discoveryScript'

// In live mode, action steps (coaching notes) are skipped transparently — they
// should never appear as standalone pages a rep might accidentally read aloud.
function applyLiveSkip(ns) {
  let t = ns[ns.length - 1]
  while (t.index < t.steps.length && t.steps[t.index]?.type === 'action') {
    t.index++
    while (ns.length > 1 && t.index >= t.steps.length) {
      ns.pop()
      t = ns[ns.length - 1]
      t.index++
    }
  }
}

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

export function ScriptWalk({ flow, mode = 'live', leadId, startSectionId, onDataCollect }) {
  const start = useMemo(() => {
    const sid = (startSectionId && flow.byId[startSectionId]) ? startSectionId : 'opener'
    const sec = flow.byId[sid]
    return { sectionId: sid, stack: [{ steps: sec.steps, index: 0 }] }
  }, [flow, startSectionId])
  const [state, setState] = useState(start)
  const [history, setHistory] = useState([])
  const [capturedValues, setCapturedValues] = useState({})
  const saveTimers = useRef({})

  const captureField = useCallback((field, value) => {
    setCapturedValues(prev => ({ ...prev, [field]: value }))
    // Debounced save to lead record (600 ms)
    clearTimeout(saveTimers.current[field])
    saveTimers.current[field] = setTimeout(async () => {
      if (!leadId || mode !== 'live') return
      const parsed = value === '' ? null : Number(value)
      try {
        await supabase.from('leads').update({ [field]: parsed }).eq('id', leadId)
        onDataCollect?.({ [field]: parsed })
      } catch (err) {
        console.error('[ScriptWalk] capture save failed:', err)
      }
    }, 600)
  }, [leadId, mode, onDataCollect])

  // Local-only capture (no DB column, no Supabase save) — used to echo back
  // exactly what the setter typed for a `capture.multiplier` field (e.g. the
  // raw daily missed-call count) while the converted value goes to captureField.
  const captureLocal = useCallback((field, value) => {
    setCapturedValues(prev => ({ ...prev, [field]: value }))
  }, [])

  // Replace in-call placeholders with captured values at render time.
  // [their number] is the raw daily missed-call count (as the setter typed
  // it); [monthly]/[annual] use a workweek-based formula (daily × 5 workdays
  // × 4 weeks × ticket, then ×12 for annual) — Prompt 210. calls_missed_per_week
  // (the real recommend-stack pricing input) also moved to daily × 5 — Prompt
  // 211, Brayden's explicit call — so both the spoken pain number and the
  // real quoted price now share the same workweek basis.
  function renderText(text) {
    const ticket = capturedValues.avg_ticket !== undefined && capturedValues.avg_ticket !== ''
      ? Number(capturedValues.avg_ticket) : null
    const missedDay = capturedValues.calls_missed_per_day !== undefined && capturedValues.calls_missed_per_day !== ''
      ? Number(capturedValues.calls_missed_per_day) : null
    const monthly = missedDay != null && ticket != null ? Math.round(missedDay * 5 * 4 * ticket) : null
    const annual = monthly != null ? monthly * 12 : null
    return text
      .replace(/\[their number\]/gi, missedDay != null ? String(missedDay) : '[their number]')
      .replace(/\[monthly\]/gi, monthly != null ? monthly.toLocaleString() : '[monthly]')
      .replace(/\[annual\]/gi, annual != null ? annual.toLocaleString() : '[annual]')
      .replace(/\[\$ticket\]/gi, ticket != null ? `$${ticket}` : '[$ticket]')
      .replace(/\[their estimate\]/gi, ticket != null ? `$${ticket}` : '[their estimate]')
  }

  const section = flow.byId[state.sectionId]
  const top = state.stack[state.stack.length - 1]
  const baseExhausted = state.stack.length === 1 && top.index >= top.steps.length
  const atChooser = false
  const atTerminal = baseExhausted
  const step = !baseExhausted ? top.steps[top.index] : null
  const accent = section.color

  function commit(next) {
    setHistory(h => [...h, state])
    setState(next)
  }
  function cloneStack() {
    return state.stack.map(f => ({ steps: f.steps, index: f.index }))
  }
  // If the step at the top of the stack is a route with a known target,
  // jump to that section automatically — no button required.
  function followRouteIfNeeded(ns, currentState) {
    const t = ns[ns.length - 1]
    const s = t.steps[t.index]
    if (s?.type !== 'route') return null
    const target = flow.byId[s.target]
    if (!target) return null
    const ns2 = [{ steps: target.steps, index: 0 }]
    if (mode === 'live') applyLiveSkip(ns2)
    setHistory(h => [...h, currentState])
    setState({ sectionId: s.target, stack: ns2 })
    return true
  }

  // Jump the top frame's index straight to `targetIndex` (used by advance()
  // for +1, and by a screen-break say-chain's Next to skip past every line
  // in the merged block at once instead of one at a time).
  function advanceTo(targetIndex) {
    const ns = cloneStack()
    let t = ns[ns.length - 1]
    t.index = targetIndex
    // popping an exhausted option frame steps the parent past its fork
    while (ns.length > 1 && t.index >= t.steps.length) {
      ns.pop()
      t = ns[ns.length - 1]
      t.index++
    }
    if (mode === 'live') applyLiveSkip(ns)
    if (followRouteIfNeeded(ns, state)) return
    commit({ ...state, stack: ns })
  }
  function advance() {
    advanceTo(top.index + 1)
  }
  function chooseOption(opt) {
    if (!opt.steps || !opt.steps.length) return advance()
    const ns = cloneStack()
    ns.push({ steps: opt.steps, index: 0 })
    if (mode === 'live') applyLiveSkip(ns)
    if (followRouteIfNeeded(ns, state)) return
    commit({ ...state, stack: ns })
  }
  function navigateTo(id) {
    const ns = [{ steps: flow.byId[id].steps, index: 0 }]
    if (mode === 'live') applyLiveSkip(ns)
    commit({ sectionId: id, stack: ns })
  }
  // Jump from a combined say+fork screen: advance past both the say step (at
  // top.index) and the fork step (at forkIdx), then enter the chosen option.
  // Must also check followRouteIfNeeded (Prompt 209 fix) — an option whose
  // first step is a route (e.g. the qualifier's [GOOD] path straight to
  // Vitals) used to land on a standalone "Go to Vitals" RouteCard here
  // because this path never called it, unlike advance()/chooseOption().
  function advanceThenPick(forkIdx, opt) {
    const ns = cloneStack()
    let t = ns[ns.length - 1]
    t.index = forkIdx + 1
    while (ns.length > 1 && t.index >= t.steps.length) {
      ns.pop()
      t = ns[ns.length - 1]
      t.index++
    }
    if (opt.steps?.length) ns.push({ steps: opt.steps, index: 0 })
    if (mode === 'live') applyLiveSkip(ns)
    if (followRouteIfNeeded(ns, state)) return
    commit({ ...state, stack: ns })
  }
  function back() {
    if (!history.length) return
    setState(history[history.length - 1])
    setHistory(h => h.slice(0, -1))
  }
  function restart() {
    setHistory([])
    setState({ sectionId: 'opener', stack: [{ steps: flow.opener.steps, index: 0 }] })
  }

  // A run of consecutive plain-SAY steps immediately followed by a fork shows
  // as one combined screen — every line in the run plus the fork's options,
  // zero intermediate taps between passive lines and the actual decision
  // point (Prompt 213: generalized from Prompt 204's single-say version,
  // which only looked one step ahead and left multi-line runs — e.g. Pain's
  // do-the-math + reflection-ask, Handoff's 3-line pitch — needing an extra
  // "Next" tap before reaching the fork). Chains that end in a route/action/
  // data_collect instead of a fork are deliberately NOT merged here: Vitals'
  // three capture questions and Close's outro are paced one line at a time
  // on purpose, not an instance of this bug.
  //
  // A step authored with a trailing `[[BREAK]]` (Prompt 215) caps the run
  // right there instead of letting it reach the fork — Handoff's 3-line
  // pitch is long enough that reading it as one block feels like too much,
  // so it splits into bridge+pitch (one merged block, plain Next) then the
  // ask (its own merged-with-fork screen) rather than all 3 on one screen.
  let sayChainForFork = null
  let sayChainPlain = null
  if (step?.type === 'say') {
    let i = top.index
    let brokeEarly = false
    while (i < top.steps.length && top.steps[i]?.type === 'say') {
      const brk = top.steps[i].screenBreak
      i++
      if (brk) { brokeEarly = true; break }
    }
    if (!brokeEarly && top.steps[i]?.type === 'fork') {
      sayChainForFork = { says: top.steps.slice(top.index, i), fork: top.steps[i], forkIdx: i }
    } else if (brokeEarly) {
      sayChainPlain = { says: top.steps.slice(top.index, i), nextIndex: i }
    }
  }

  // A say line immediately followed by its terminal `▸ Set status X` action
  // (no fork in between, action is the LAST step of this path) merges onto
  // one screen — the "Next"-to-a-mostly-blank-action-screen tap added
  // nothing new to read (Prompt 248). Deliberately only the ONE
  // immediately-preceding say line, not a full run: Close's 2-line outro
  // still paces its first line one at a time per the sayChainForFork/Plain
  // comment above — only the very last line, right before the outcome,
  // folds into the terminal card with it. An action with NO preceding say
  // at all (a fork option whose entire body is the action, e.g. "Still
  // shuts it down") gets the same merged-terminal treatment on its own.
  const sayBeforeTerminal = (!sayChainForFork && !sayChainPlain && step?.type === 'say'
    && top.steps[top.index + 1]?.type === 'action' && top.index + 1 === top.steps.length - 1)
    ? { say: step, action: top.steps[top.index + 1] }
    : null
  const standaloneTerminalAction = (step?.type === 'action' && top.index === top.steps.length - 1)
    ? step
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* Track header — which part of the tree the rep is on. Hidden in the
          live Call modal (Prompt 49 — the "Fixed Opener / Same words" card was
          clutter mid-call); kept for the practice walk. */}
      {mode !== 'live' && (
        <div style={{ flexShrink: 0, padding: '12px 18px 10px', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 20, height: 20, borderRadius: 6, background: accent, color: '#0E0E1A', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} />
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
          sayBeforeTerminal
            ? <TerminalCard says={[sayBeforeTerminal.say]} action={sayBeforeTerminal.action} accent={accent} mode={mode} isClose={section.kind === 'close'} onRestart={restart} renderText={renderText} capturedValues={capturedValues} onCapture={captureField} onCaptureLocal={captureLocal} />
            : sayChainForFork
              ? <SayWithFork says={sayChainForFork.says} fork={sayChainForFork.fork} accent={accent} capturedValues={capturedValues} onCapture={captureField} onCaptureLocal={captureLocal} renderText={renderText} onPick={opt => advanceThenPick(sayChainForFork.forkIdx, opt)} />
              : sayChainPlain
                ? <SayChain says={sayChainPlain.says} accent={accent} capturedValues={capturedValues} onCapture={captureField} onCaptureLocal={captureLocal} renderText={renderText} onNext={() => advanceTo(sayChainPlain.nextIndex)} />
                : <SayCard step={step} accent={accent} capturedValues={capturedValues} onCapture={captureField} onCaptureLocal={captureLocal} renderText={renderText} onNext={advance} />
        )}

        {step && step.type === 'action' && (
          standaloneTerminalAction
            ? <TerminalCard says={[]} action={standaloneTerminalAction} accent={accent} mode={mode} isClose={section.kind === 'close'} onRestart={restart} />
            : <ActionCard step={step} accent={accent} onNext={advance} />
        )}

        {step && step.type === 'data_collect' && (
          <DataCollectCard step={step} accent={accent} leadId={leadId} mode={mode} onNext={advance} onDataCollect={onDataCollect} />
        )}

        {step && step.type === 'route' && (
          <RouteCard step={step} accent={accent} flow={flow} onGo={() => navigateTo(step.target)} />
        )}

      </div>

      {/* Controls — Back / Restart */}
      <div style={{ flexShrink: 0, padding: '10px 18px', borderTop: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-inset)' }}>
        <button
          onClick={back}
          disabled={!history.length}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: history.length ? 'var(--accent-dim)' : 'none', border: `0.5px solid ${history.length ? 'var(--accent-border)' : 'transparent'}`, borderRadius: 8, cursor: history.length ? 'pointer' : 'not-allowed', color: history.length ? 'var(--accent)' : 'var(--text-muted)', fontSize: 12, fontWeight: 500, opacity: history.length ? 1 : 0.4, padding: '5px 10px' }}
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

// One capture input for a say step's `capture` config — multiplier fields
// echo the raw typed value locally while the converted value is what's saved.
function CaptureInput({ capture, capturedValues, onCapture, onCaptureLocal }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', fontWeight: 600 }}>
        {capture.label}
      </label>
      <input
        type="number"
        min="0"
        value={capture.multiplier
          ? (capturedValues?.[capture.rawField || (capture.field + '_raw')] ?? '')
          : (capturedValues?.[capture.field] ?? '')}
        onChange={e => {
          const v = e.target.value
          if (capture.multiplier) {
            onCaptureLocal?.(capture.rawField || (capture.field + '_raw'), v)
            onCapture?.(capture.field, v === '' ? '' : String(Math.round(Number(v) * capture.multiplier)))
          } else {
            onCapture?.(capture.field, v)
          }
        }}
        placeholder={capture.placeholder}
        style={{ height: 40, padding: '0 12px', background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 15, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
      />
    </div>
  )
}

// One or more spoken lines as a single continuous card (Prompt 215) — a
// merged chain reads as one moment, not N stacked bordered boxes. The lines
// join into one flat string with a plain space (Prompt 216) so they render
// as a single flowing paragraph, not separate <p> blocks with a visible gap.
function SayBlock({ says, accent, renderText }) {
  const text = says.map(s => renderText ? renderText(s.text) : s.text).join(' ')
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderLeft: `3px solid ${accent}`, borderRadius: 12, padding: '18px 20px' }}>
      <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{text}</p>
    </div>
  )
}

// One spoken line — the words to read, big and clear, with a Next advance.
function SayCard({ step, accent, onNext, capturedValues, onCapture, onCaptureLocal, renderText }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>
        {step.sub ? 'Then say' : 'Say this'}
      </p>
      <SayBlock says={[step]} accent={accent} renderText={renderText} />
      {step.capture && (
        <CaptureInput capture={step.capture} capturedValues={capturedValues} onCapture={onCapture} onCaptureLocal={onCaptureLocal} />
      )}
      <NextButton accent={accent} onClick={onNext} label="Next" />
    </div>
  )
}

// A merged run of 2+ SAY lines capped by an authored [[BREAK]] before it
// reaches a fork (Prompt 215) — one continuous block, ending in a plain Next
// that skips past the whole run at once rather than one line at a time.
function SayChain({ says, accent, onNext, capturedValues, onCapture, onCaptureLocal, renderText }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>
        {says[0].sub ? 'Then say' : 'Say this'}
      </p>
      <SayBlock says={says} accent={accent} renderText={renderText} />
      {says.map((s, i) => s.capture && (
        <CaptureInput key={i} capture={s.capture} capturedValues={capturedValues} onCapture={onCapture} onCaptureLocal={onCaptureLocal} />
      ))}
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
function DataCollectCard({ step, accent, leadId, mode, onNext, onDataCollect }) {
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
        onDataCollect?.(patch)
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

// A decision point — the prospect responded, tap which way it went. Each
// option is colored by its response CATEGORY (good/hesitant/bad), not a
// verbatim quote — untagged options fall back to the section's accent.
function Fork({ step, accent, onPick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>What did they do?</p>
      <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{step.q}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
        {step.options.map((opt, i) => {
          const c = CATEGORY_COLORS[opt.category] || accent
          return (
            <button
              key={i}
              onClick={() => onPick(opt)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left', padding: '14px 16px', background: 'var(--bg-elevated)', border: `1px solid ${c}`, borderLeft: `3px solid ${c}`, borderRadius: 11, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14.5, fontWeight: 500, transition: 'filter 120ms ease' }}
              onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
            >
              {opt.label}
              <ChevronRight size={16} color={c} style={{ flexShrink: 0 }} />
            </button>
          )
        })}
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

// A trailing say-line (if any) merged with its terminal `▸ Set status X`
// action onto ONE screen (Prompt 248) — replaces the old say-screen →
// blank-action-screen → separate Terminal-screen sequence for every path
// that ends this way. `says` is empty for a fork option whose entire body
// was the action (no line to say). Colored by the SPECIFIC action just
// reached via extractSetStatus/OUTCOME_COLORS — not `section.outcome`
// (Terminal's source above), which scans the whole section and can report
// the wrong outcome on a section with more than one kind of ending (e.g.
// Opener ends in both Not Interested and Follow-Up depending on path). The
// button stays the same generic "Start over" Terminal already had — no new
// label, no new status-write side effect (Brayden's explicit constraint).
// Pre-tinted background tokens paired with OUTCOME_COLORS' solid colors —
// `color + '14'`-style alpha-suffix concatenation onto a `var(--x)` string
// is invalid CSS (the whole declaration silently drops, background renders
// transparent) — confirmed live via getComputedStyle while building this;
// the codebase has this same broken pattern elsewhere already (ActionCard's
// "Do this" box, Terminal's icon circle, MyCalls' grade badges) but fixing
// those is out of scope here. These `-dim` tokens are real, pre-defined
// custom properties (index.css) already used correctly elsewhere (e.g.
// MyCalls' GRADE_DIM) — safe to reference directly.
const OUTCOME_DIM = {
  'Appointment Booked': 'var(--success-dim)',
  'Follow-Up': 'var(--warning-dim)',
  'Not Interested': 'var(--danger-dim)',
}

function TerminalCard({ says, action, accent, mode, isClose, onRestart, renderText, capturedValues, onCapture, onCaptureLocal }) {
  const outcome = isClose ? 'Appointment Booked' : extractSetStatus(action.text)
  const color = OUTCOME_COLORS[outcome] || accent
  const dim = OUTCOME_DIM[outcome] || 'var(--accent-dim)'
  const message = isClose
    ? mode === 'live'
      ? 'Once they pick a time, set Appointment Booked on the left, enter the time, and hit Done.'
      : 'This is where you book Nate — set the appointment and you’re done.'
    : outcome
      ? mode === 'live'
        ? `Set the status to "${outcome}" on the left and hit Done.`
        : `This path ends on "${outcome}".`
      : 'Set the call outcome and hit Done.'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {says.length > 0 && (
        <>
          <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>
            {says[0].sub ? 'Then say' : 'Say this'}
          </p>
          <SayBlock says={says} accent={accent} renderText={renderText} />
          {says.map((s, i) => s.capture && (
            <CaptureInput key={i} capture={s.capture} capturedValues={capturedValues} onCapture={onCapture} onCaptureLocal={onCaptureLocal} />
          ))}
        </>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center', background: dim, border: `0.5px solid ${color}`, borderRadius: 12, padding: '20px' }}>
        {isClose ? <CalendarCheck size={22} color={color} /> : <CheckCircle2 size={22} color={color} />}
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
          {isClose ? 'Lock the appointment' : (outcome || 'End of this path')}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
          {message}
        </p>
      </div>
      <button
        onClick={onRestart}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--bg-elevated)', border: '0.5px solid var(--border)', borderRadius: 9, padding: '10px 16px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 500 }}
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

// Combined say + fork screen — every consecutive plain-SAY line in the run
// (usually one, sometimes more — see the sayChainForFork comment above) plus
// the response buttons on one screen, so reps never tap through a standalone
// say just to reach the fork. Options are colored by response CATEGORY
// (good/hesitant/bad), same as Fork.
function SayWithFork({ says, fork, accent, onPick, capturedValues, onCapture, onCaptureLocal, renderText }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: 0 }}>
        {says[0].sub ? 'Then say' : 'Say this'}
      </p>
      <SayBlock says={says} accent={accent} renderText={renderText} />
      {says.map((s, i) => s.capture && (
        <CaptureInput key={i} capture={s.capture} capturedValues={capturedValues} onCapture={onCapture} onCaptureLocal={onCaptureLocal} />
      ))}
      <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em', color: accent, fontWeight: 700, margin: '4px 0 0' }}>What did they do?</p>
      {fork.q && <p style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>{fork.q}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 2 }}>
        {fork.options.map((opt, i) => {
          const c = CATEGORY_COLORS[opt.category] || accent
          return (
            <button
              key={i}
              onClick={() => onPick(opt)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textAlign: 'left', padding: '14px 16px', background: 'var(--bg-elevated)', border: `1px solid ${c}`, borderLeft: `3px solid ${c}`, borderRadius: 11, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14.5, fontWeight: 500, transition: 'filter 120ms ease' }}
              onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)' }}
              onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
            >
              {opt.label}
              <ChevronRight size={16} color={c} style={{ flexShrink: 0 }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
