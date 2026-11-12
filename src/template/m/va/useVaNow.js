import { useEffect, useState } from 'react'
import { useFulClock, sampleNowMs } from '../../ful/data'
import { dateOf, clockOf } from '../../../lib/callSlots'
import { minutesOf } from '../appModel'

// P975 — the VA's "now": the real minute on real data, the sample clock (ticking from load) on sample data, read on
// the team's clock (the VA's zone). Re-reads every 30 s so Now lines and "needs a result" move on their own.
export function useVaNow() {
  const clock = useFulClock()
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setWall(Date.now()), 30000); return () => clearInterval(t) }, [])
  const tz = clock.tz || 'America/Chicago'
  const nowMs = clock.real ? wall : sampleNowMs()
  const iso = new Date(nowMs).toISOString()
  return { nowMs, tz, todayIso: dateOf(iso, tz), nowMin: minutesOf(clockOf(iso, tz)), real: !!clock.real }
}
// The day an item is on, on the team's clock.
export const dayOfItem = (it, tz) => (it?.iso ? dateOf(it.iso, tz) : null)
export const minOfItem = (it, tz) => (it?.iso ? minutesOf(clockOf(it.iso, tz)) : minutesOf(it?.time || ''))
