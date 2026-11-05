import { useMemo } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useFulfillmentQueue } from '../hooks/usePolicies'
import { useVaQueue, useVaMissed } from '../hooks/useVaDesk'
import { useVaServicingQueue } from '../hooks/useVaServicing'
import { useUnreadMessageCount } from '../hooks/usePolicyMessages'
import { useCancels, usePaySettings } from '../hooks/useFulfillmentPayouts'
import { useFulfillmentPay } from '../hooks/useFulfillmentPay'
import { useNow, isLive } from '../lib/agentBookings'
import { buildDay, timeParts } from '../lib/fulfillmentDay'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../lib/timezones'
import { payPeriod, fmtShift } from '../lib/payPeriod'
import { cancelTotals, isoDay } from '../lib/myPay'
import { bucketCounts } from '../lib/vaQueue'
import { groupTasks } from '../lib/vaServicing'

// P837 — everything the Fulfillment shell's frame and Today read, from the existing hooks (react-query shares each
// fetch with the page that also reads it). Read only. A VA sees their own calls (assigned_fulfillment_id, the same
// filter the old Overview used), the VA queues the server returns to them, and their own cancels and pay row.
export function useFulData() {
  const { profile } = useAuth()
  const id = profile?.id
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const now = useNow(30e3)

  const queueQ = useFulfillmentQueue()
  const mine = useMemo(() => (queueQ.data || []).filter(p => p.assigned_fulfillment_id === id), [queueQ.data, id])
  const day = useMemo(() => {
    const d = buildDay(mine, now, tz)
    const tile = e => (e ? { ...e, ...timeParts(e.at, tz) } : e)
    return { ...d, next: tile(d.next), rest: d.rest.map(tile) }
  }, [mine, now, tz])
  const live = useMemo(() => mine.filter(isLive), [mine])

  const vaQ = useVaQueue()
  const missedQ = useVaMissed()
  const buckets = useMemo(() => bucketCounts(vaQ.data), [vaQ.data])

  const servQ = useVaServicingQueue(!!id)
  const endOfToday = useMemo(() => {
    // The VA's midnight, found by stepping forward to the next zoned date (DST-safe enough for a bucket edge).
    const today = zonedDateStr(now, tz)
    let t = now
    while (zonedDateStr(t, tz) === today) t += 15 * 6e4
    return t - 1
  }, [now, tz])
  const tasks = useMemo(() => groupTasks(servQ.data, now, endOfToday), [servQ.data, now, endOfToday])

  const unread = useUnreadMessageCount(!!id)

  const week = isoDay(payPeriod(now).start)
  const cancelsQ = useCancels(id, week, !!id)
  const totals = useMemo(() => cancelTotals((cancelsQ.data || []).filter(c => c.week_start === week)), [cancelsQ.data, week])
  const { data: paySettings } = usePaySettings()
  const shiftQ = useFulfillmentPay(id, !!id)
  const shift = shiftQ.data?.[0] || null

  return {
    profile, tz, now, day, mine, live,
    queueQ, vaQ, missedQ, servQ, cancelsQ,
    buckets, missed: missedQ.data || [], tasks, servicing: servQ.data || [],
    unread: typeof unread === 'number' ? unread : 0,
    totals, perCancel: paySettings?.pay_per_cancel_cents ?? null,
    shift, shiftText: shift ? fmtShift(shift) : null,
  }
}
