import { TriangleAlert, MessageSquareText } from 'lucide-react'
import { briefLines } from '../brief'
import './before923.css'

// P923 — the box at the top of a hand-off call, a cancel-the-old-policy call and the live call view: what the agent
// said on Submit for servicing under "Before our team calls" (lib brief.js). The replacement first, then the agent's
// note in their words. Nothing to say, no box.
// P931: `note` is the booking's own note, shown in the same box when the agent left none under "Before our team calls".
export function BeforeCall({ client, agent, oldCarrier = null, cancelBy = null, compact = false, note = null, noteBy = null }) {
  const brief = briefLines(client?.brief, { oldCarrier, cancelBy })
  const own = !brief.note && !!note
  const b = own ? { ...brief, note, any: true } : brief
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
          <span><small>{own && noteBy ? noteBy : `${who} says`}</small><q>{b.note}</q></span>
        </p>
      )}
    </section>
  )
}
