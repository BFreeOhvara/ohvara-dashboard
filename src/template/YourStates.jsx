import { useState } from 'react'
import { MapPin, Check } from 'lucide-react'
import { Chip, Drawer } from './kit'
import { useSampleSettings } from './data'
import { US_STATES } from '../lib/usStates'
import { asPick } from './licenceModel'
import { useSaveStates, todayIso, AGENT } from './useStates'
import { MIN_STATES, MAX_STATES, NOT_TAKING, stateDiff, diffWords, flipState, statesBlock, startsOn, dayWords, useStateChanges } from './adStates'
import './p878.css'
import './p881.css'
import './states949.css'

// P949 — Your states (agent Billing, beside Change plan): add, remove or swap the states the ads run in, 3 to 10, no New
// York, with the licence tick for any state that's new. It starts with the next day's ads and the admin gets a to-do to
// update the campaign (adStates.js). The change history sits under it. Settings › Licence saves through the same path.

function History({ list }) {
  if (!list.length) return <p className="tp-sub">No changes yet.</p>
  return (
    <ol className="st-hist" aria-label="State changes">
      {list.map(c => (
        <li key={c.id}>
          <span className="tp-grow"><b>{diffWords(c)}</b><small>Changed {c.at} · {c.states.join(', ')}</small></span>
          {c.done ? <Chip tone="green">Live since {dayWords(c.starts).split(', ')[1]}</Chip> : <Chip tone="blue">Starts {dayWords(c.starts)}</Chip>}
        </li>
      ))}
    </ol>
  )
}

export function StatesDrawer({ open, onClose }) {
  const { data: s } = useSampleSettings()
  const now = asPick(s.licence).states
  const [draft, setDraft] = useState(null)
  const [ticked, setTicked] = useState(false)
  const save = useSaveStates()
  const all = useStateChanges()
  const pick = draft || now
  const { added, removed } = stateDiff(now, pick)
  const block = statesBlock(now, pick, ticked)
  const close = () => { setDraft(null); setTicked(false); onClose() }
  const flip = code => { setDraft(d => flipState(d || now, code)); setTicked(false) }
  const n = pick.length
  return (
    <Drawer open={open} onClose={close} title="Your states" sub={`Your leads only come from these states. Changes start with tomorrow’s leads (${dayWords(startsOn(todayIso()))}).`}
      footer={<>
        <button type="button" className="tp-primary fx-accent" disabled={!!block} data-states-save onClick={() => { save(pick, ticked); close() }}><Check size={15} />Save states</button>
        <button type="button" className="tp-btn ov-ghost" onClick={close}>Cancel</button>
        {block && (added.length || removed.length) ? <small className="st-why" data-states-why>{block}</small> : null}
      </>}>
      <div className="st-now">
        <span className="st-now-h"><MapPin size={15} aria-hidden="true" /><b>{n} {n === 1 ? 'state' : 'states'}</b><small>Pick {MIN_STATES} to {MAX_STATES}. New York isn{'’'}t open yet.</small></span>
        <div className="wz-states lic-pickall st-grid" role="group" aria-label="Your states">
          {US_STATES.filter(x => x.code.length === 2).map(x => {
            const off = NOT_TAKING.includes(x.code)
            const on = pick.includes(x.code)
            const full = !on && n >= MAX_STATES
            const isNew = on && !now.includes(x.code)
            return <button key={x.code} type="button" className={`wz-state${on ? ' is-on' : ''}${isNew ? ' is-new' : ''}`} aria-pressed={on} disabled={off || full}
              title={off ? `${x.name}: not taking agents yet` : full ? `Up to ${MAX_STATES} states` : x.name} onClick={() => flip(x.code)}>{x.code}</button>
          })}
        </div>
      </div>
      {(added.length > 0 || removed.length > 0) && (
        <div className="st-diff" data-states-diff>
          <b>Change: {diffWords({ added, removed })}</b>
          <small>{[added.length && `Leads start coming from ${added.join(', ')}`, removed.length && `stop from ${removed.join(', ')}`].filter(Boolean).join('; ')}, starting {dayWords(startsOn(todayIso()))}. Leads already on your board stay.</small>
        </div>
      )}
      {added.length > 0 && (
        <label className="tp-check lic-tick" data-states-tick>
          <input type="checkbox" checked={ticked} onChange={e => setTicked(e.target.checked)} />
          <span>I{'’'}m licensed for life insurance in every state I added ({added.join(', ')})</span>
        </label>
      )}
      <div className="st-hist-box">
        <h3>Change history</h3>
        <History list={all.filter(c => c.agentId === AGENT.id)} />
      </div>
    </Drawer>
  )
}

