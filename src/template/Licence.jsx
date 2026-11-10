import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { useNote } from './kit'
import { useSampleSettings, useSampleActions } from './data'
import { US_STATES } from '../lib/usStates'
import { LICENCE_LIMITS, NOT_TAKING, LICENSED_WORDS, asPick, pickCount, pickReady } from './licenceModel'
import './p878.css'
import './p881.css'
import { clockNow } from './leadLifecycle'

// The agent's licence states (setup and Settings). P878/P881's registry check (licenceModel, src/lib/nipr.js) stays
// built but off for launch.
// The tick's time on the agent's clock (sample: the sample clock).
const stampNow = () => { const w = clockNow(); const h = Number(w.slice(11, 13)); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(w.slice(5, 7)) - 1]} ${Number(w.slice(8, 10))}, ${h % 12 || 12}:${w.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}` }
// P848 — Licence states (Brayden, Nov 7 16:04): the full state list (New York not taken yet), pick 3 to 10, then one
// required tick, logged with its time and the states. Leads start right away: no review wait, no upload.
// The registry check and manual review above stay built but off (P881; licence_settings.gate_on stays false).
export function LicenceForm({ value, onChange, limits = LICENCE_LIMITS }) {
  const v = asPick(value)
  const count = pickCount(v, limits)
  const set = states => onChange({ ...v, states, licensed: null })
  const pick = code => {
    if (NOT_TAKING.includes(code)) return
    const on = v.states.includes(code)
    if (!on && v.states.length >= limits.max) return
    set(on ? v.states.filter(x => x !== code) : [...v.states, code].sort())
  }
  const tick = on => onChange({ ...v, licensed: on ? { at: stampNow(), states: [...v.states] } : null })
  return (
    <div className="tp-stack">
      <div className="tp-field"><span>States you{'’'}re licensed in</span>
        <div className="wz-states lic-pickall" role="group" aria-label="States you are licensed in">
          {US_STATES.filter(x => x.code.length === 2).map(x => {
            const off = NOT_TAKING.includes(x.code)
            const on = v.states.includes(x.code)
            const full = !on && v.states.length >= limits.max
            return <button key={x.code} type="button" className={`wz-state${on ? ' is-on' : ''}`} aria-pressed={on} disabled={off || full}
              title={off ? `${x.name}: not taking agents yet` : full ? `Up to ${limits.max} states` : x.name} onClick={() => pick(x.code)}>{x.code}</button>
          })}
        </div>
        <small>{v.states.length} picked · pick {limits.min} to {limits.max}. New York isn{'’'}t open yet.{count === 'few' && v.states.length > 0 ? ` Pick ${limits.min - v.states.length} more.` : ''}</small>
      </div>
      <label className="tp-check lic-tick"><input type="checkbox" checked={!!v.licensed} disabled={count !== 'ok'} onChange={e => tick(e.target.checked)} />
        <span>{LICENSED_WORDS}{v.licensed ? ` · ticked ${v.licensed.at}` : ''}</span></label>
      <small className="tp-sub">Your leads start right away in these states, and only these. Change the states and you tick again.</small>
    </div>
  )
}

// Settings > Licence.
export function LicenceCard() {
  const { data: s } = useSampleSettings()
  const { saveLicence } = useSampleActions()
  const note = useNote()
  const saved = asPick(s.licence)
  const [draft, setDraft] = useState(saved)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const ready = pickReady(draft)
  return (
    <>
      <header className="fx-form-h"><h2>Licence</h2><p>Leads, bookings and live calls only come from the states you pick.{pickReady(saved) ? '' : ' Pick your states and tick the box to start leads.'}</p></header>
      <LicenceForm value={draft} onChange={setDraft} />
      <footer className="fx-form-f">
        <button type="button" className="tp-btn ov-ghost" disabled={!dirty} onClick={() => setDraft(saved)}>Discard</button>
        <button type="button" className="tp-primary fx-accent" disabled={!dirty || !ready} onClick={() => { saveLicence(draft); note('States saved. Leads come from these states only') }}><BadgeCheck size={15} />Save states</button>
      </footer>
    </>
  )
}
