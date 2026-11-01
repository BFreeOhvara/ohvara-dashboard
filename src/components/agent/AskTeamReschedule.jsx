import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useSendDm } from '../../hooks/useDirectMessages'
import { useThreadPolicy } from '../../hooks/usePolicyMessages'
import { timeText } from '../../lib/inbounds'
import { Ico } from './PortalV2Nav'

// "Ask the team to reschedule" on the agent Calendar (panel and phone agenda). The one write on that page:
// a single in-app message on the agent's standing line, sent with useSendDm and routed the way Messages.jsx
// routes an agent's old per-client link (agent -> the client's assigned rep, or 'admin' when none). It is not
// a client thread (no team-side reader, Prompt 721) and not SMS or email. Shows only for an appointment
// that has a client policy, is in the future, is not live or finished, and has no Reschedule flow.
//   item: the Calendar item (policyId, name, word, at, ms, tone, live, change); tz: the agent's zone;
//   sample: dev-only ?sample=1, where nothing is read or written and Sent is shown straight away.

function askTeamBody({ name, word, at }, tz) {
  const day = new Date(at).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })
  return `Can we move the ${word.toLowerCase()} with ${name} on ${day}, ${timeText(at, tz)} your time? Please suggest a new time.`
}

const canAskTeam = (item, nowMs) =>
  !!item.policyId && !item.live && item.tone !== 'done' && item.ms >= nowMs && item.change === null

export default function AskTeamReschedule({ item, tz, nowMs, sample }) {
  const { profile } = useAuth()
  // The policy read mounts on the first click, so a long agenda does not run a query per row.
  const [armed, setArmed] = useState(false)
  const [fake, setFake] = useState(false)
  const pol = useThreadPolicy(!sample && armed ? item.policyId : null)
  const policy = pol.data
  const send = useSendDm(policy?.agent_id, policy?.assigned_fulfillment_id || 'admin', profile?.id)
  const want = useRef(false)
  const body = askTeamBody(item, tz)
  const missing = pol.isError || (pol.isSuccess && !policy)

  // The click came before the policy had loaded: send as soon as it has.
  useEffect(() => {
    if (!want.current) return
    if (missing) { want.current = false; return }
    if (!policy || !profile?.id) return
    want.current = false
    send.mutate(body)
  }, [policy, missing, profile?.id, send, body])

  if (!canAskTeam(item, nowMs)) return null

  const sent = sample ? fake : send.isSuccess
  const busy = !sample && (send.isPending || (armed && pol.isFetching))
  const failed = !sample && !busy && (send.isError || missing)

  const click = () => {
    if (sample) { setFake(true); return }
    if (policy && profile?.id) { send.mutate(body); return }
    want.current = true
    if (armed) pol.refetch()
    else setArmed(true)
  }

  if (sent) {
    return (
      <p className="cal-ask-sent" role="status">
        <span className="cal-ask-ok"><Ico icon={Check} size={14} /></span>
        <span>Sent to the team. They will reply on your Messages line.<Link to="/messages">Open Messages</Link></span>
      </p>
    )
  }
  return (
    <div className="cal-ask">
      <button type="button" className="ov-ghost cal-ask-btn" disabled={busy} onClick={click}>
        <Ico icon={CalendarClock} size={15} />{busy ? 'Sending…' : 'Ask the team to reschedule'}
      </button>
      {failed && <p className="cal-ask-err" role="alert">Couldn't send that. Try again.</p>}
    </div>
  )
}
