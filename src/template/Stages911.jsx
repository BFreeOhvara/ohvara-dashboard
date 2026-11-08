import { Check, Minus, ShieldCheck, Archive, CalendarClock } from 'lucide-react'
import { stagesOf } from '../lib/clientStages.js'
import { Block } from './Record'
import './p911.css'

// P911 — the stage checklist for a Working client, read-only (the agent's drawer and the VA's client view; VAs move
// steps from their calls). Each step: done ✓ with its date, current (highlighted, with the next booked call), upcoming
// (grey) or skipped (n/a). It ends at Protected, or Closed with the reason when a save couldn't be made. Rules:
// lib/clientStages.js.
export function StageChecklist({ c, who = 'agent' }) {
  const s = stagesOf(c)
  return (
    <ol className="sl-list" aria-label={`${s.label}: ${s.closed ? 'closed' : s.complete ? 'done' : `stage ${s.at} of ${s.of}`}`}>
      {s.steps.map((st, i) => (
        <li key={st.key} className={`sl-step is-${st.state}`} aria-current={st.state === 'current' ? 'step' : undefined}>
          <span className="sl-dot" aria-hidden="true">{st.state === 'done' ? <Check size={14} strokeWidth={2.6} /> : st.state === 'skipped' ? <Minus size={14} /> : i + 1}</span>
          <span className="sl-t">
            <b>{st.label}</b>
            <small>
              {st.state === 'done' && (st.at ? `Done ${st.at}` : 'Done')}
              {st.state === 'current' && (st.next ? <><CalendarClock size={12} aria-hidden="true" />Booked {st.next}</> : who === 'va' ? 'Now' : 'Our team is on it')}
              {st.state === 'upcoming' && (st.sub || 'Up next')}
              {st.state === 'skipped' && 'Not needed (n/a)'}
            </small>
          </span>
          {st.state === 'current' && <span className="sl-now">Now</span>}
        </li>
      ))}
      <li className={`sl-step sl-end is-${s.closed ? 'closed' : s.complete ? 'done' : 'upcoming'}`}>
        <span className="sl-dot" aria-hidden="true">{s.closed ? <Archive size={14} /> : <ShieldCheck size={14} />}</span>
        <span className="sl-t"><b>{s.closed ? 'Closed' : 'Protected'}</b><small>{s.closed || (s.complete ? 'Back in the green' : 'When every step is done')}</small></span>
      </li>
    </ol>
  )
}

// The checklist as a drawer block: the journey's name, "Stage 3 of 5".
export function StageBlock({ c, who }) {
  const s = stagesOf(c)
  return (
    <Block title={s.label} aside={<span className="sl-count">{s.closed ? 'Closed' : s.complete ? 'Done' : `Stage ${s.at} of ${s.of}`}</span>}>
      <StageChecklist c={c} who={who} />
    </Block>
  )
}
