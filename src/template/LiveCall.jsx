import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming, BadgeCheck, CalendarClock, Ban, GripVertical } from 'lucide-react'
import { paths } from './paths'
import { liveAt, liveFacts, agentStatus, RESULT_STATUS } from './agentView'
import { dayLabel, timeLabel, clockNow } from './leadLifecycle'
import { OutcomePrompt } from './LeadOutcome'
import { canDrag } from './leadDrag'
import './live910.css'

// P910 — a live call is never a column. While it rings and once it connects, it's pinned at the top of Leads with
// everything the AI collected (name, phone, age band, city, state, what they want, notes). The agent answers on their
// phone; the card is only for the result: Sold · Follow up · Not interested, any time during or after the call. Once
// marked it moves to that status and the card goes away. P917: it says "Live call" only (no Answer), in the live call's
// own lilac, and until it's marked it's also in Your to-dos (leadLifecycle.js liveToMark); the Overview has no cards.
// P929: each result in its own status colour from the Leads board (agentView AGENT_STATUSES via RESULT_STATUS).
const RESULTS = [['sold', 'Sold', BadgeCheck], ['follow_up', 'Follow up', CalendarClock], ['not_interested', 'Not interested', Ban]].map(r => [...r, agentStatus(RESULT_STATUS[r[0]]).tone])

function whenOf(l) {
  if (l.stage === 'ringing') return 'Ringing now'
  const at = liveAt(l)
  if (!at) return 'Live call'
  const today = at.slice(0, 10) === clockNow().slice(0, 10)
  return `${today ? 'Today' : dayLabel(at)}, ${timeLabel(at)}`
}

// P978: on the desktop Leads board a live call the agent took (not one still ringing) can be dragged onto Sold, Follow up
// or Not interested (onGrab, ResultDrag.jsx); the result buttons stay.
export function LiveCallCard({ l, i = 0, compact = false, onGrab = null }) {
  const [pick, setPick] = useState(null)
  const ringing = l.stage === 'ringing'
  const name = `${l.first_name} ${l.last_name}`
  const facts = liveFacts(l)
  const drag = !!onGrab && canDrag(l)
  return (
    <article className={`lv-card${ringing ? ' is-ringing' : ''}${compact ? ' is-compact' : ''}${drag ? ' ldg-can' : ''}`} style={{ '--i': i }} data-live={l.stage} data-drag={drag ? 'yes' : undefined} aria-label={`Live call, ${name}`}
      onPointerDown={drag ? e => onGrab(e, l) : undefined} onDragStart={drag ? e => e.preventDefault() : undefined}>
      {drag && <span className="ldg-grip" aria-hidden="true"><GripVertical size={14} /></span>}
      <header className="lv-top">
        <span className="lv-k"><PhoneIncoming size={14} aria-hidden="true" />Live call</span>
        <span className="lv-when">{ringing && <i className="lv-pulse" aria-hidden="true" />}{whenOf(l)}</span>
      </header>
      <Link to={paths.lead(l.id)} className="lv-name"><h3>{name}</h3></Link>
      <dl className="lv-facts">{facts.map(([k, v]) => <div key={k} className={k === 'Notes' || k === 'Wants' ? 'is-wide' : ''}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="lv-acts" role="group" aria-label={`How did it go with ${l.first_name}?`}>
        {RESULTS.map(([k, label, Icon, tone]) => (
          <button key={k} type="button" className={`lv-res is-${tone}`} data-result={k} onClick={() => setPick(k)}><Icon size={15} aria-hidden="true" />{label}</button>
        ))}
      </div>
      {pick && <OutcomePrompt lead={l} start={pick} onClose={() => setPick(null)} />}
    </article>
  )
}

// The pinned row: every live call ringing or waiting for a result, newest first.
export function LiveCalls({ calls, compact = false, onGrab = null }) {
  if (!calls.length) return null
  return (
    <section className={`lv-pin${compact ? ' is-compact' : ''}`} aria-label={`Live calls, ${calls.length}`}>
      {calls.map((l, i) => <LiveCallCard key={l.id} l={l} i={i} compact={compact} onGrab={onGrab} />)}
    </section>
  )
}
