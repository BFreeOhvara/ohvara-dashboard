import { useEffect, useState } from 'react'
import { Phone, Clock3 } from 'lucide-react'
import { useFulClock, sampleNowMs } from './data'
import { useCallOpenMin } from '../../hooks/useCallOpen'
import { callGate } from '../../lib/callOpen'

// P918 — calls only at their time. A booked call's Start call turns on N minutes before its time (admin setting, 5 by
// default) and stays on until the call is done or rebooked; before that it shows when it opens. The sample clock is
// the one the Overview countdown runs on (1:32 PM at load, ticking).
const nowOf = real => (real ? Date.now() : sampleNowMs())

function useStartGate(iso, done = false) {
  const clock = useFulClock()
  const real = !!clock.real
  const lead = useCallOpenMin(real)
  const [now, setNow] = useState(() => nowOf(real))
  const g = callGate({ iso, done, nowMs: now, lead })
  const waiting = !g.open && !g.done && g.at != null
  useEffect(() => {
    if (!waiting) return undefined
    const t = setInterval(() => setNow(nowOf(real)), 5000)
    return () => clearInterval(t)
  }, [waiting, real])
  const atText = g.at != null ? new Date(g.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: clock.tz }) : ''
  return { ...g, lead, atText }
}

// The button. `blocked` (with `why`) keeps it off for another reason (e.g. the new policy isn't issued yet).
export function StartCall({ iso, done = false, onStart, blocked = false, why, label = 'Start call', className = 'tp-primary fx-accent' }) {
  const g = useStartGate(iso, done)
  if (!g.open && !g.done && g.at != null) {
    return (
      <button type="button" className={`${className} fs-startwait`} disabled aria-label={`${label}: opens at ${g.atText}`} title={`Start call turns on ${g.lead} minutes before the call`}>
        <Clock3 size={16} aria-hidden="true" />Opens {g.atText}
      </button>
    )
  }
  return <button type="button" className={className} disabled={blocked || g.done} title={blocked ? why : undefined} onClick={onStart}><Phone size={16} />{label}</button>
}
