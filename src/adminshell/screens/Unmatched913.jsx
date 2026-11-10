import { Link } from 'react-router-dom'
import { TriangleAlert, Shuffle, ChevronRight, MapPin, Megaphone } from 'lucide-react'
import { useAdmDay, useAdmAgents, useAdmActions } from '../data'
import { Avatar, Drawer, useNote } from '../../template/kit'
import { useKeep } from '../../template/motion'
import { ap } from '../paths'
import { pickOrder } from '../p879'
import { UNMATCHED_WHY, unmatchedLine } from '../../lib/leadMatch'

// P913 — a lead that matched no agent (no agent ID in the ad link, and no Meta campaign ID that points at an agent,
// src/lib/leadMatch.js) raises this alert for admins. It should almost never happen: it is the safety net for a real
// paid lead that arrives with neither (a new ad set up without the agent link), so the lead isn't lost.
// P934 (Brayden, Nov 10): no sample or test lead ever trips it. The rail's Route a lead button is gone: the alert is a
// row in the notifications; clicking it slides in the lead with a "Pick the agent" list (the agents on the campaign
// it came from first, then those licensed in its state), and one click routes it. The routing (assignLead) is the same.

// The notifications row. Nothing when every lead matched.
export function UnmatchedAlert({ className = '', onOpen }) {
  const { data: day } = useAdmDay()
  const rows = day.unassigned
  if (!rows.length) return null
  return (
    <button type="button" className={`adm-unmatched adm-unmatched-row ${className}`} role="alert" aria-label={unmatchedLine(rows.length)} onClick={onOpen}>
      <TriangleAlert size={16} aria-hidden="true" />
      <span className="tp-grow"><b>{unmatchedLine(rows.length)}</b><small>{rows.map(l => l.name).join(', ')}</small></span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  )
}

// The slide-in: each unmatched lead and the agents to pick from. One click on an agent routes the lead (Assign).
export function RouteLeadDrawer({ open, onClose }) {
  const { data: day } = useAdmDay()
  const { data: agents } = useAdmAgents()
  const { assignLead } = useAdmActions()
  const note = useNote()
  const keep = useKeep(open)
  if (!keep) return null
  const rows = day.unassigned
  const route = (l, a) => {
    assignLead(l.id, a.id)
    note(`${l.name} assigned to ${a.name}. Logged.`)
    if (rows.length <= 1) onClose()
  }
  return (
    <Drawer open={open} onClose={onClose} title="Pick the agent" sub={rows.length ? unmatchedLine(rows.length) : 'Every lead matched an agent by its ad link or its campaign.'}>
      {rows.map(l => (
        <section key={l.id} className="adm-route" aria-label={`Route ${l.name}`}>
          <Link to={ap('leads', l.id)} className="adm-unmatched-who" onClick={onClose}>
            <b>{l.name}</b>
            <small><MapPin size={12} aria-hidden="true" /> {l.product} · {l.city}, {l.state} · came {l.came.replace('Today, ', 'today ')}</small>
            <small className="adm-unmatched-why">{l.why ? UNMATCHED_WHY[l.why] || l.why : UNMATCHED_WHY.missing}</small>
          </Link>
          <ul className="tp-list adm-route-list">{pickOrder(agents, l).map(a => (
            <li key={a.id}><button type="button" className="fx-mrow" onClick={() => route(l, a)}>
              <Avatar name={a.name} />
              <span className="tp-grow"><b>{a.name}</b><small>{a.why === 'campaign' ? <><Megaphone size={11} aria-hidden="true" /> On this ad campaign · </> : ''}Licensed in {a.states.join(', ')}</small></span>
              <span className="fx-pillbtn"><Shuffle size={13} aria-hidden="true" />Assign</span>
            </button></li>
          ))}</ul>
        </section>
      ))}
    </Drawer>
  )
}
