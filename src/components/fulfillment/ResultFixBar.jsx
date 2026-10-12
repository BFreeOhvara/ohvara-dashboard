import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Undo2 } from 'lucide-react'
import { useCorrectResult } from '../../hooks/usePolicies'
import { RESULT_TEXT, otherResult } from '../../lib/fulfillmentCall'

// Prompt 750 — the quick-fix bar (state: hooks/useResultFix.js). It names
// the result just recorded and offers the other one.
// `inline` sits in the drawer footer; otherwise it floats at the page bottom.
// Keyed by the result it offers to fix, so a new result starts fresh.
export function ResultFixBar({ ctl, inline = false }) {
  return ctl.fix ? <Bar key={ctl.fix.key} ctl={ctl} inline={inline} /> : null
}

function Bar({ ctl, inline }) {
  const { fix, hold, close, arm } = ctl
  const correct = useCorrectResult()
  const [changed, setChanged] = useState(null)

  const to = otherResult(fix.result)
  const change = () => correct.mutate({ id: fix.id, to }, {
    onSuccess: () => { setChanged(to); arm(2500) },
  })
  const bar = (
    <div role="status" className={`ov-card mc-fix${inline ? ' is-inline' : ''}${fix.leaving ? ' is-leaving' : ''}`}
      onMouseEnter={() => hold(true)} onMouseLeave={() => hold(false)}>
      {changed ? (
        <span className="mc-fix-text"><Check size={15} strokeWidth={2.6} style={{ color: 'var(--ov-st-cancelled)' }} />Changed to {RESULT_TEXT[changed]}</span>
      ) : (
        <>
          <span className="mc-fix-text">Marked {fix.result === 'cancelled' ? 'cancelled' : 'No answer'}</span>
          <span className="mc-fix-sep">·</span>
          <button type="button" className="mc-link mc-fix-act" onClick={change} disabled={correct.isPending}>
            <Undo2 size={14} strokeWidth={2.3} />{correct.isPending ? 'Changing…' : `Change to ${RESULT_TEXT[to]}`}
          </button>
          {correct.error && <span className="mc-fix-err">Couldn't change it: {correct.error.message || 'try again'}</span>}
        </>
      )}
      <button type="button" className="mc-fix-x" aria-label="Dismiss" onClick={close}>×</button>
    </div>
  )
  return inline ? bar : createPortal(<div className="mc-fix-wrap">{bar}</div>, document.body)
}
