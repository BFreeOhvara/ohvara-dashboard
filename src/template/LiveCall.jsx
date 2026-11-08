import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming, Phone, BadgeCheck, CalendarClock, Ban } from 'lucide-react'
import { useSampleActions } from './data'
import { useNote } from './kit'
import { paths } from './paths'
import { liveAt, liveFacts } from './agentView'
import { dayLabel, timeLabel, clockNow } from './leadLifecycle'
import { OutcomePrompt } from './LeadOutcome'
import './live910.css'

// P910 — a live call is never a column. While it rings and once it connects, it's pinned at the top of Leads and the
// Overview with everything the AI collected (name, phone, age band, city, state, what they want, notes). The agent
// taps a result any time during or after the call: Sold · Follow up · Not interested. Once marked it moves to that
// status and the card goes away. Unmarked after its day, it's also in Your to-dos (leadLifecycle.js liveToMark).
const RESULTS = [['sold', 'Sold', BadgeCheck, 'green'], ['follow_up', 'Follow up', CalendarClock, 'teal'], ['not_interested', 'Not interested', Ban, 'mute']]

function whenOf(l) {
  if (l.stage === 'ringing') return 'Ringing now'
  const at = liveAt(l)
  if (!at) return 'Live call'
  const today = at.slice(0, 10) === clockNow().slice(0, 10)
  return `${today ? 'Today' : dayLabel(at)}, ${timeLabel(at)}`
}

export function LiveCallCard({ l, i = 0, compact = false }) {
  const { moveLead } = useSampleActions()
  const note = useNote()
  const [pick, setPick] = useState(null)
  const ringing = l.stage === 'ringing'
  const name = `${l.first_name} ${l.last_name}`
  const facts = liveFacts(l)
  const answer = () => { moveLead(l.id, 'showed'); note(`You took the call with ${l.first_name}. The team dropped off. Pick the result any time`) }
  return (
    <article className={`lv-card${ringing ? ' is-ringing' : ''}${compact ? ' is-compact' : ''}`} style={{ '--i': i }} data-live={l.stage} aria-label={`Live call, ${name}`}>
      <header className="lv-top">
        <span className="lv-k"><PhoneIncoming size={14} aria-hidden="true" />{ringing ? 'Live transfer' : 'Live call'}</span>
        <span className="lv-when">{ringing && <i className="lv-pulse" aria-hidden="true" />}{whenOf(l)}</span>
      </header>
      <Link to={paths.lead(l.id)} className="lv-name"><h3>{name}</h3></Link>
      <dl className="lv-facts">{facts.map(([k, v]) => <div key={k} className={k === 'Notes' || k === 'Wants' ? 'is-wide' : ''}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="lv-acts" role="group" aria-label={ringing ? 'Answer the call' : `How did it go with ${l.first_name}?`}>
        {ringing
          ? <button type="button" className="tp-primary fx-accent" onClick={answer}><Phone size={15} aria-hidden="true" />Answer</button>
          : RESULTS.map(([k, label, Icon, tone]) => (
            <button key={k} type="button" className={`lv-res is-${tone}`} data-result={k} onClick={() => setPick(k)}><Icon size={15} aria-hidden="true" />{label}</button>
          ))}
      </div>
      {pick && <OutcomePrompt lead={l} start={pick} onClose={() => setPick(null)} />}
    </article>
  )
}

// The pinned row: every live call ringing or waiting for a result, newest first.
export function LiveCalls({ calls, compact = false }) {
  if (!calls.length) return null
  return (
    <section className={`lv-pin${compact ? ' is-compact' : ''}`} aria-label={`Live calls, ${calls.length}`}>
      {calls.map((l, i) => <LiveCallCard key={l.id} l={l} i={i} compact={compact} />)}
    </section>
  )
}
