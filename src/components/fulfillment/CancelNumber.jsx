import { useState } from 'react'
import { Check } from 'lucide-react'

// Prompt 784 (dry-run F1) — while call recording is off there's no recording
// to check a cancel against, so Cancelled on the dial-direct path asks for the
// carrier's confirmation number first. The server refuses a cancel without
// one while recording is off (migration 159); the admin sees it on Needs a
// listen before Pay it.
export function CancelNumber({ carrier, busy, saveText = 'Save as cancelled', onSave, onBack }) {
  const [num, setNum] = useState('')
  const ok = num.trim().length > 0
  return (
    <div className="mc-cnum" onClick={e => e.stopPropagation()}>
      <label>
        <span>Confirmation number from {carrier || 'the carrier'}</span>
        <input value={num} onChange={e => setNum(e.target.value)} autoComplete="off" autoFocus
          placeholder="The number the carrier read out"
          onKeyDown={e => { if (e.key === 'Enter' && ok && !busy) onSave(num.trim()) }} />
      </label>
      <p>Calls aren't recorded yet, so this number is the proof. An admin checks it before the cancel is paid.</p>
      <div className="mc-cnum-row">
        <button type="button" className="mc-btn mc-btn-ok" disabled={!ok || busy} onClick={() => onSave(num.trim())}>
          <Check size={16} strokeWidth={2.6} /> {busy ? 'Saving…' : saveText}
        </button>
        <button type="button" className="mc-btn ov-ghost" disabled={busy} onClick={onBack}>Back</button>
      </div>
    </div>
  )
}
