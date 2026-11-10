import { TriangleAlert, MessageSquareText } from 'lucide-react'
import { briefLines } from '../brief'
import './before923.css'

// P923 — the box at the top of a hand-off call, a cancel-the-old-policy call and the live call view: what the agent
// said on Submit for servicing under "Before our team calls" (lib brief.js). The replacement first, then the agent's
// note in their words. Nothing to say, no box.
export function BeforeCall({ client, agent, oldCarrier = null, cancelBy = null, compact = false }) {
  const b = briefLines(client?.brief, { oldCarrier, cancelBy })
  if (!b.any) return null
  const who = agent ? agent.split(' ')[0] : 'The agent'
  return (
    <section className={`bc-box${compact ? ' is-compact' : ''}`} aria-label="Before you call">
      {b.replace && (
        <p className="bc-line is-replace">
          <span className="bc-ic" aria-hidden="true"><TriangleAlert size={compact ? 14 : 16} /></span>
          <span><b>{b.replace}</b>{b.detail && <small>Old policy: {b.detail}</small>}</span>
        </p>
      )}
      {b.note && (
        <p className="bc-line is-note">
          <span className="bc-ic" aria-hidden="true"><MessageSquareText size={compact ? 14 : 16} /></span>
          <span><small>{who} says</small><q>{b.note}</q></span>
        </p>
      )}
    </section>
  )
}
