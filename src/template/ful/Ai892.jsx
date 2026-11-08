import { Bot, PhoneForwarded, CalendarClock } from 'lucide-react'
import { Chip, SampleTag } from '../kit'
import { Block } from '../Record'
import { HANDOFF_REASONS } from '../../lib/aiCaller'

// P892 — the VA's "From the AI" card. A lead the AI handed over arrives at the top of the queue (warm: they're on the
// line) with what the AI already knows, so the VA carries on instead of starting over. When no VA was free in 60
// seconds it became a callback task; the card says so. Sample only until 852 wires call_queue ai_handoff items
// (detail.summary / reason, migration p892_ai_caller).
export function FromAi({ l }) {
  const a = l?.fromAi
  if (!a) return null
  const live = !a.callbackTask
  return (
    <Block title={<span className="ai-title"><Bot size={16} aria-hidden="true" />From the AI</span>} sub={live ? 'They’re on the line now. Carry on from here, don’t start over.' : 'No VA was free in 60 seconds, so they were told someone calls back shortly. Call them now.'}
      aside={<SampleTag>Sample</SampleTag>}>
      <div className="ai-from">
        <Chip tone={live ? 'warn' : 'blue'}>{HANDOFF_REASONS[a.reason]}</Chip>
        <p className="tp-mid">{a.summary}</p>
        <dl className="fx-facts">{[
          ['Called', `${a.secs} seconds after the form came in`],
          ['On the call', a.talked],
          ['Already asked', a.asked.join(', ') || 'Nothing yet'],
          ['Agent', a.agent],
        ].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="tp-sub">{live ? <><PhoneForwarded size={12} aria-hidden="true" /> Handed over warm: the lead heard that a person is joining.</> : <><CalendarClock size={12} aria-hidden="true" /> A callback task, due now.</>}</p>
      </div>
    </Block>
  )
}
