import { useMemo, useState } from 'react'
import { useCarrierHours } from './useCarriers'
import { clientSlotISO, slotState, openBookingIsos, dayIn, addDaysStr, carrierDaySlots, firstOpenDay } from '../lib/scheduling'
import { viewerHoursSummary } from '../lib/carriers'
import { stageOf } from '../lib/agentBookings'

// Day, time and carrier-hours rules for a Fulfillment call, shared by New
// booking (step 2) and Submit's old-policy cancellation step. `picked` is the
// carrier being left (its hours set the slots), `tz` the client's zone, `mine`
// this agent's bookings (taken times). Nothing here is Submit-specific.
export function useCallPicker({ picked, tz, now, mine, city, viewerTz }) {
  // The carrier with its hours: cached at once, else looked up (checking).
  const { carrier: withHours, checking } = useCarrierHours(picked)
  const carrier = picked ? withHours : null
  const ready = !!tz && !!carrier
  const [pickedDate, setPickedDate] = useState(null) // the client's calendar day; null = the default
  const [slot, setSlot] = useState('')
  // Until the zone is known the (dimmed) day cards show the agent's own days.
  const today = dayIn(now, tz || undefined)
  const tomorrow = addDaysStr(today, 1)
  // A picked day now in the client's past falls back to the first day the
  // carrier still has a time open.
  const date = !ready ? null : pickedDate && pickedDate >= today ? pickedDate : firstOpenDay(today, tz, carrier, now)
  const slotsOn = d => (ready && d ? carrierDaySlots(d, tz, carrier) : [])
  const daySlots = slotsOn(date)

  // This agent's open bookings: the times they've already taken, and the
  // duplicate-client check.
  const open = useMemo(() => mine.filter(p => stageOf(p) !== 'cancelled'), [mine])
  const openIsoSet = useMemo(() => openBookingIsos(mine, { now, stageOf }), [mine, now])

  // The picked slot is a wall-clock time ("2:00 PM"), so a new zone keeps it
  // at 2:00 PM for the client. If that, or the clock moving on, makes it too
  // soon or taken, it no longer counts as picked.
  const slotIso = slot && date && daySlots.includes(slot) ? clientSlotISO(date, slot, tz) : null
  const slotOpen = !!slotIso && slotState(slotIso, { now, openIsoSet }) === 'open'
  const scheduledAt = slotOpen ? slotIso : null

  const hoursLine = !ready ? null : carrier.hours_status === 'fallback'
    ? `We couldn't find ${carrier.name}'s hours, so we're using ${viewerHoursSummary(carrier, viewerTz)}. Fulfillment will confirm.`
    : `${carrier.name} takes calls ${viewerHoursSummary(carrier, viewerTz)} · times shown are ${city}'s local time.`
  const closedText = ready ? `${carrier.name} doesn't take calls that day. Pick another day.` : null

  return {
    picked, tz, now, ready, checking, today, tomorrow, date, slotsOn, daySlots, open, openIsoSet,
    slot: slotOpen ? slot : '', slotOpen, scheduledAt, hoursLine, closedText,
    setPickedDate, setSlot, reset: () => { setPickedDate(null); setSlot('') },
  }
}
