import { useState } from 'react'
import { Tag } from 'lucide-react'
import { LeadTypePicker } from '../components/agent/LeadTypePicker'
import { useCoverageTypes, useMyLeadType } from '../hooks/useLeadTypes'
import { typeLabel, effectiveType, switchWords, centralToday } from '../lib/coverageTypes'
import { useNote } from './kit'
import { useDataSource } from './data'
import '../components/agent/signupCheckout.css'

// P1016 — Settings: the kind of leads you get. One type; once leads run, a switch starts the next day (the campaign
// runs a full day on the old one) and goes to GoHighLevel on its own. Agent words never say ads (leadLifecycle.test). Desktop Settings › Licence and the phone's Settings › Lead type.
export function LeadTypeCard({ compact = false }) {
  const { all, visible } = useCoverageTypes(useDataSource() === 'real')
  const mine = useMyLeadType(useDataSource() === 'real')
  const note = useNote()
  const now = effectiveType(mine.key, all)
  const shown = mine.nextKey || now
  // null = not edited (follows what's saved); a key = the agent's unsaved pick.
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const draft = pick ?? shown
  const dirty = draft !== shown
  const pending = switchWords(all, mine.nextKey, mine.nextFrom, centralToday())
  const hiddenNow = !visible.some(t => t.key === now)
  const save = async () => {
    setBusy(true)
    try {
      const r = await mine.save(draft)
      setPick(null)
      note(r?.nextKey ? `Saved. ${switchWords(all, r.nextKey, r.nextFrom, centralToday())}` : `Lead type saved: ${typeLabel(all, draft)}`)
    } catch (e) {
      note(e.message || 'Couldn’t save your lead type')
    } finally { setBusy(false) }
  }
  return (
    <section className="lt-card" aria-labelledby="lt-h" data-testid="lead-type-card">
      {!compact && <header className="fx-form-h"><h2 id="lt-h"><Tag size={17} aria-hidden="true" /> The leads you want</h2>
        <p>Pick one kind of life insurance lead. Every lead you get is that kind. Once your leads are running, a switch starts the next day.</p></header>}
      {compact && <h2 id="lt-h" className="sr-only">The leads you want</h2>}
      <p className="lt-now" data-testid="lead-type-now">
        Now: <b>{typeLabel(all, now)}</b>{hiddenNow ? ' (no longer offered to new picks)' : ''}
        {pending && <span className="lt-next"> · {pending}</span>}
      </p>
      <LeadTypePicker types={visible} value={draft} onChange={setPick} name="settings-lead-type" disabled={busy} />
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty || busy} onClick={() => setPick(null)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || busy} onClick={save} data-testid="lead-type-save">Save lead type</button>
      </footer>
    </section>
  )
}
