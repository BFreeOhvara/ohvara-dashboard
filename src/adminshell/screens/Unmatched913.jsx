import { useState } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert, Shuffle } from 'lucide-react'
import { useAdmDay, useAdmAgents, useAdmActions } from '../data'
import { useNote } from '../../template/kit'
import { Dropdown } from '../kit'
import { ap } from '../paths'
import { assignable } from '../p879'
import { UNMATCHED_WHY, unmatchedLine } from '../../lib/leadMatch'

// P913 — a lead that matched no agent (no agent ID in the ad link, and no Meta campaign ID that points at an agent,
// src/lib/leadMatch.js) is not a section on Leads any more: it raises this alert for admins, on the Overview's Needs
// you, in the bell and behind the rail's Route a lead. "1 lead couldn't be matched to an agent. Pick one." Each row
// has the lead, an agent picker (licensed in its state first) and Assign. It should almost never happen.
export function UnmatchedAlert({ className = '', onDone }) {
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { assignLead } = useAdmActions()
  const note = useNote()
  const [pick, setPick] = useState({})
  const rows = day.unassigned
  if (!rows.length) return null
  return (
    <section className={`adm-unmatched ${className}`} role="alert" aria-label={unmatchedLine(rows.length)}>
      <p className="adm-unmatched-h"><TriangleAlert size={15} aria-hidden="true" /><b>{unmatchedLine(rows.length)}</b></p>
      <ul className="adm-unmatched-rows">{rows.map(l => {
        const fits = assignable(agents, l)
        const options = (fits.length ? fits : agents).map(a => ({ value: a.id, label: a.name, sub: `Licensed in ${a.states.join(', ')}` }))
        const to = pick[l.id] || options[0]?.value
        const go = () => {
          assignLead(l.id, to)
          note(`${l.name} assigned to ${agents.find(a => a.id === to)?.name}. Logged.`)
          onDone?.()
        }
        return (
          <li key={l.id}>
            <Link to={ap('leads', l.id)} className="adm-unmatched-who" onClick={() => onDone?.()}>
              <b>{l.name}</b>
              <small>{l.product} · {l.city}, {l.state} · came {l.came.replace('Today, ', 'today ')}</small>
              <small className="adm-unmatched-why">{l.why ? UNMATCHED_WHY[l.why] || l.why : UNMATCHED_WHY.missing}</small>
            </Link>
            <Dropdown className="adm-dd-sm" label={`Agent for ${l.name}`} value={to} options={options} onChange={v => setPick({ ...pick, [l.id]: v })} />
            <button type="button" className="tp-primary fx-accent" disabled={!to} onClick={go}><Shuffle size={15} />Assign</button>
          </li>
        )
      })}</ul>
    </section>
  )
}
