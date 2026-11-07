import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { Field, Pending, useNote } from './kit'
import { useSampleSettings, useSampleActions } from './data'
import { US_STATES } from '../lib/usStates'
import { NOT_TAKING, licenceReady } from './licenceModel'
import './p878.css'

// P878 — the agent's licence (N-H-11, N-D-06): NPN, the states they're licensed in, and a dated yes per state that they
// can write mortgage protection there. Leads only come from those states, and Submit checks a sale's state against
// them. No New York agents for now (Brayden, Q61). The NPN check against the national registry comes with P881.
const stamp = () => 'Nov 2, 2:14 PM'

export function LicenceForm({ value, onChange }) {
  const pick = code => {
    const has = value.states.includes(code)
    const states = has ? value.states.filter(s => s !== code) : [...value.states, code].sort()
    const attested = { ...value.attested }
    if (has) delete attested[code]
    onChange({ ...value, states, attested })
  }
  const attest = (code, on) => {
    const attested = { ...value.attested }
    if (on) attested[code] = stamp(); else delete attested[code]
    onChange({ ...value, attested })
  }
  return (
    <div className="tp-stack">
      <Field label="Your NPN (National Producer Number)" hint="We check it against the national licence registry. Only verified states get leads.">
        <input value={value.npn} inputMode="numeric" maxLength={10} onChange={e => onChange({ ...value, npn: e.target.value.replace(/\D/g, '') })} placeholder="8 to 10 digits" />
      </Field>
      <div className="tp-field"><span>States you{'’'}re licensed in</span>
        <div className="su-states" role="group" aria-label="States you're licensed in">
          {US_STATES.map(s => <button key={s.code} type="button" title={NOT_TAKING.includes(s.code) ? 'Not taking agents in this state yet' : s.name} disabled={NOT_TAKING.includes(s.code)} aria-pressed={value.states.includes(s.code)} className={`su-state${value.states.includes(s.code) ? ' is-on' : ''}`} onClick={() => pick(s.code)}>{s.code}</button>)}
        </div>
        <small>We{'’'}re not taking agents in New York yet.</small>
      </div>
      {value.states.length > 0 && (
        <div className="tp-field"><span>Can you write mortgage protection in each?</span>
          <div className="su-attest">
            {value.states.map(code => (
              <label key={code} className="tp-check"><input type="checkbox" checked={!!value.attested[code]} onChange={e => attest(code, e.target.checked)} />
                <span>{US_STATES.find(s => s.code === code)?.name}: yes, I can write mortgage protection here{value.attested[code] ? ` · confirmed ${value.attested[code]}` : ''}</span></label>
            ))}
          </div>
          <small>Each yes is saved with the time you gave it.</small>
        </div>
      )}
      <Pending>Licence attestation wording pending</Pending>
    </div>
  )
}


// Settings > Licence.
export function LicenceCard() {
  const { data: s } = useSampleSettings()
  const { saveLicence } = useSampleActions()
  const note = useNote()
  const [draft, setDraft] = useState(s.licence)
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.licence)
  return (
    <>
      <header className="fx-form-h"><h2>Licence</h2><p>Leads only come from states you{'’'}re licensed in. {s.licence.verified}.</p></header>
      <LicenceForm value={draft} onChange={setDraft} />
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setDraft(s.licence)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || !licenceReady(draft)} onClick={() => { saveLicence(draft); note('Licence saved') }}><BadgeCheck size={15} />Save licence</button>
      </footer>
    </>
  )
}
