import { useState } from 'react'
import { BadgeCheck, RefreshCw, ShieldAlert, ShieldCheck, Upload, Clock3 } from 'lucide-react'
import { Field, Pending, useNote, SampleTag } from './kit'
import { useSampleSettings, useSampleActions } from './data'
import { US_STATES } from '../lib/usStates'
import {
  NPN_OK, MESSAGES, SAMPLE_TRIES, licenceReady, verifiedStates, blockedWhy, applyResult, sampleLookup, expiringSoon, fmtDay,
} from './licenceModel'
import './p878.css'
import './p881.css'

// P878 + P881 — the agent's licence (N-H-07..12, N-D-06). The NPN is checked against the national licence registry;
// the registry's states are listed, and only active life states can be picked for leads, each with a dated yes that
// they can write mortgage protection there. Not found or registry down: try again, or send the licence for a manual
// check (the other setup steps carry on; leads wait). No active life licence: a plain message, the account stays.
// New York: not taking agents yet (Q61). Sample mode uses the sample registry (licenceModel SAMPLE_TRIES); the real
// lookup is src/lib/nipr.js (the nipr-check function), wired by P848.
const stamp = () => 'Nov 7, 2:14 PM'
const stateName = code => US_STATES.find(s => s.code === code)?.name || code

function Result({ value }) {
  const s = value.status
  if (s === 'unchecked') return null
  const good = s === 'verified'
  const wait = ['review', 'mismatch', 'duplicate'].includes(s)
  return (
    <div className={`lic-res ${good ? 'is-good' : wait ? 'is-wait' : 'is-warn'}`} role="status">
      {good ? <ShieldCheck size={16} aria-hidden="true" /> : wait ? <Clock3 size={16} aria-hidden="true" /> : <ShieldAlert size={16} aria-hidden="true" />}
      <div>
        <b>{good ? `Verified: ${value.name || 'licence found'}` : s === 'no_life' ? 'No active life licence' : s === 'not_found' ? 'NPN not found'
          : s === 'registry_down' ? 'Registry not answering' : s === 'rejected' ? 'Not verified' : 'Being checked by hand'}</b>
        <p>{MESSAGES[s]}</p>
        {value.checkedAt && <small>Checked {value.checkedAt}</small>}
      </div>
    </div>
  )
}

// N-H-09: not found / registry down → send the licence with an upload; it goes to an admin.
function ReviewBox({ value, onChange }) {
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const send = () => onChange({ ...value, status: 'review', review: { reason: value.status, file: file?.name || null, note, sentAt: stamp() } })
  return (
    <div className="lic-review">
      <b>Send your licence for a manual check</b>
      <p className="tp-sub">Upload your state licence (a photo or PDF). An admin checks it, usually within a day. You can finish the other setup steps meanwhile; leads start once it{'’'}s verified.</p>
      <label className="lic-file"><Upload size={15} aria-hidden="true" /><span>{file ? file.name : 'Choose a file'}</span>
        <input type="file" accept="application/pdf,image/*" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
      <Field label="Anything we should know? (optional)"><input value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. new licence issued last week" /></Field>
      <button type="button" className="tp-btn ov-ghost" disabled={!file} onClick={send}><Upload size={15} />Send for review</button>
    </div>
  )
}

export function LicenceForm({ value, onChange, accountName = 'Dana Whitfield' }) {
  const [busy, setBusy] = useState(false)
  const ok = verifiedStates(value)
  const check = () => {
    setBusy(true)
    // Sample: the registry answers at once. Real: checkNpn (src/lib/nipr.js).
    const r = sampleLookup(value.npn, accountName)
    setTimeout(() => { setBusy(false); onChange(applyResult({ ...value, review: null }, r, stamp())) }, 450)
  }
  const pick = code => {
    if (!ok.includes(code)) return
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
  const listed = [...(value.licences || [])].sort((a, b) => (blockedWhy(a) ? 1 : 0) - (blockedWhy(b) ? 1 : 0) || a.state.localeCompare(b.state))
  const soon = expiringSoon(value)
  return (
    <div className="tp-stack">
      <Field label="Your NPN (National Producer Number)" hint="We check it against the national licence registry. Only verified states get leads.">
        <div className="lic-npn">
          <input value={value.npn} inputMode="numeric" maxLength={10} aria-label="Your NPN"
            onChange={e => onChange({ ...value, npn: e.target.value.replace(/\D/g, ''), ...(value.status !== 'unchecked' ? { status: 'unchecked', licences: [], states: [], attested: {}, name: null, review: null } : null) })}
            placeholder="6 to 10 digits" />
          <button type="button" className="tp-primary fx-accent" disabled={!NPN_OK.test(value.npn) || busy} onClick={check}>
            {busy ? <RefreshCw size={15} className="lic-spin" /> : <BadgeCheck size={15} />}{value.status === 'unchecked' ? 'Check NPN' : 'Check again'}</button>
        </div>
      </Field>
      <p className="lic-try"><SampleTag>Sample registry</SampleTag> Try {SAMPLE_TRIES.map(([n, w], i) => <span key={n}>{i ? ', ' : ''}<button type="button" className="tp-link" onClick={() => onChange({ ...value, npn: n, status: 'unchecked', licences: [], states: [], attested: {}, review: null })}>{n}</button> ({w})</span>)}.</p>
      <Result value={value} />
      {(value.status === 'not_found' || value.status === 'registry_down') && <ReviewBox value={value} onChange={onChange} />}
      {value.status === 'review' && value.review && <p className="tp-sub">Sent {value.review.sentAt}{value.review.file ? ` with ${value.review.file}` : ''}.</p>}

      {value.status === 'verified' && (
        <div className="tp-field"><span>States on your licence</span>
          <ul className="lic-states" aria-label="States on your licence">
            {listed.map(l => {
              const why = blockedWhy(l)
              const on = value.states.includes(l.state)
              return (
                <li key={l.state} className={why ? 'is-off' : on ? 'is-on' : ''}>
                  <button type="button" className={`wz-state${on ? ' is-on' : ''}`} disabled={!!why} aria-pressed={on} onClick={() => pick(l.state)}
                    title={why || `Get leads in ${stateName(l.state)}`}>{l.state}</button>
                  <span className="tp-grow"><b>{stateName(l.state)}</b><small>{why || `Active life licence${l.expires_on ? ` · expires ${fmtDay(l.expires_on)}` : ''}`}</small></span>
                  {!why && <small className="lic-pick">{on ? 'Getting leads' : 'Tap to get leads'}</small>}
                </li>
              )
            })}
          </ul>
          <small>Only states with an active life licence can be picked. We re-check every day; if one lapses, it drops off and we tell you.</small>
        </div>
      )}
      {soon.length > 0 && (
        <p className="lic-soon" role="status"><Clock3 size={14} aria-hidden="true" />{soon.map(x => `${stateName(x.state)} expires ${fmtDay(x.on)} (${x.days} days)`).join(' · ')}. Renew it, or leads there stop that day.</p>
      )}
      {value.states.length > 0 && (
        <div className="tp-field"><span>Can you write mortgage protection in each?</span>
          <div className="wz-attest">
            {value.states.map(code => (
              <label key={code} className="tp-check"><input type="checkbox" checked={!!value.attested[code]} onChange={e => attest(code, e.target.checked)} />
                <span>{stateName(code)}: yes, I can write mortgage protection here{value.attested[code] ? ` · confirmed ${value.attested[code]}` : ''}</span></label>
            ))}
          </div>
          <small>Each yes is saved with the time you gave it.</small>
        </div>
      )}
      {value.status === 'verified' && ok.length > 0 && value.states.length === 0 && <p className="tp-sub">Pick at least one state to get leads in.</p>}
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
  const ready = licenceReady(draft)
  const gone = (s.licence.licences || []).filter(l => l.lapsed_at)
  return (
    <>
      <header className="fx-form-h"><h2>Licence</h2><p>Leads, bookings and live calls only come from verified states.{ready ? '' : ' Leads are paused until your licence is verified.'}</p></header>
      {gone.length > 0 && <p className="lic-res is-warn lic-gone" role="status"><ShieldAlert size={15} aria-hidden="true" /><span>{gone.map(l => `${stateName(l.state)} dropped ${fmtDay(l.lapsed_at)}`).join(' · ')}: the registry no longer shows an active licence. Renew it and it comes back on the next daily check.</span></p>}
      <LicenceForm value={draft} onChange={setDraft} accountName={s.profile?.name} />
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setDraft(s.licence)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || !(ready || draft.status === 'review')} onClick={() => { saveLicence(draft); note(draft.status === 'review' ? 'Sent for a manual check' : 'Licence saved') }}><BadgeCheck size={15} />Save licence</button>
      </footer>
    </>
  )
}
