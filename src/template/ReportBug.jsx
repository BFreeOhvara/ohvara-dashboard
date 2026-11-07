import { useState } from 'react'
import { CheckCircle2, Paperclip, Send, X } from 'lucide-react'
import { Drawer, Field, useAccount } from './kit'
import { bugContext, bugText, addSampleBug } from './bugReport'
import { sendBugReport } from '../lib/sendBugReport'
import './reportbug.css'

// P876 — the Report a bug pop-up, from Help & Support in all three portals. Three things to fill (what happened, what
// you expected, an optional screenshot or file); the page, time, browser, screen size and sender are captured for
// them. Signed in for real it saves for real (lib/sendBugReport, the P711 path); on sample info it goes to the sample
// store that admin's Bug reports list reads. `role` = 'Agent' | 'Fulfillment' | 'Admin'.
const MAX_FILE = 10 * 1024 * 1024

export function ReportBug({ open, onClose, role }) {
  if (!open) return null
  return <Form onClose={onClose} role={role} />
}

function Form({ onClose, role }) {
  const account = useAccount()
  const [happened, setHappened] = useState('')
  const [expected, setExpected] = useState('')
  const [file, setFile] = useState(null)
  const [state, setState] = useState('edit') // edit | sending | sent
  const [err, setErr] = useState('')
  const tooBig = file && file.size > MAX_FILE
  const ready = happened.trim().length >= 3 && !tooBig && state === 'edit'

  const send = async () => {
    if (!ready) return
    const ctx = bugContext(window, { name: account.name, role })
    setState('sending'); setErr('')
    try {
      if (account.live) await sendBugReport({ description: bugText({ happened, expected }, ctx), file, pageUrl: ctx.page })
      else addSampleBug({ happened, expected, file }, ctx)
      setState('sent')
    } catch (e) {
      setErr(e?.message || 'It didn’t send. Try again.'); setState('edit')
    }
  }

  if (state === 'sent') {
    return (
      <Drawer open center onClose={onClose} title="Report a bug" footer={<button type="button" className="tp-primary fx-accent" data-first onClick={onClose}>Done</button>}>
        <p className="fx-bug-thanks"><CheckCircle2 size={18} aria-hidden="true" /><b>Thanks, we've got it.</b></p>
        <p className="tp-sub">The Ohvara team sees it in Bug reports.</p>
      </Drawer>
    )
  }
  return (
    <Drawer open center onClose={onClose} title="Report a bug" sub="Tell us what went wrong. We add the page, the time, your browser and screen size for you."
      footer={<><button type="button" className="tp-primary fx-accent" disabled={!ready} onClick={send}><Send size={15} />{state === 'sending' ? 'Sending…' : 'Send'}</button><button type="button" className="tp-btn ov-ghost" onClick={onClose}>Cancel</button></>}>
      <Field label="What happened?"><textarea className="tp-input fx-ta" rows={3} autoFocus value={happened} onChange={e => setHappened(e.target.value)} placeholder="What you were doing, and what went wrong" /></Field>
      <Field label="What did you expect?" hint="Optional"><textarea className="tp-input fx-ta" rows={2} value={expected} onChange={e => setExpected(e.target.value)} placeholder="What should have happened" /></Field>
      <div className="tp-field"><span>Screenshot or file <small className="tp-sub">Optional</small></span>
        {file ? (
          <span className="fx-bug-file"><Paperclip size={14} aria-hidden="true" /><b>{file.name}</b>{tooBig && <small className="fx-bug-err">Over 10 MB. Pick a smaller one.</small>}
            <button type="button" className="fx-x" aria-label={`Remove ${file.name}`} onClick={() => setFile(null)}><X size={14} /></button></span>
        ) : (
          <label className="fx-pillbtn fx-bug-pick"><Paperclip size={14} aria-hidden="true" />Attach a screenshot or file
            <input type="file" accept="image/*,.pdf,.txt,.csv,.mp4,.mov" className="sr-only" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        )}
      </div>
      {err && <p className="fx-bug-err" role="alert">{err}</p>}
    </Drawer>
  )
}
