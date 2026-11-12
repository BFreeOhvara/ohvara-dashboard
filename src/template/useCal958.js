import { useCallback, useEffect, useRef, useState } from 'react'
import { DAY_FIRST_MS, SETTLE_MS } from './cal958'

// P958 — every week calendar (agent, VA, admin Fulfillment).

// True once the page's first entrance is over. The week section gets .is-settled then (cal958.css), and from that
// moment no box plays its pop-in again: switching week/day, opening or closing details, or a box mounting later.
export function useSettled() {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS)
    return () => clearTimeout(t)
  }, [])
  return settled
}

// Click a call: if its day isn't the open one, the day opens first (the grid narrows, the day list slides in on the
// right), then the details slide in over it. Returns go(dayIsOpen, openDay, openDetails).
export function useDayFirst() {
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useCallback((dayIsOpen, openDay, openDetails) => {
    clearTimeout(timer.current)
    if (dayIsOpen) { openDetails(); return }
    openDay()
    timer.current = setTimeout(openDetails, DAY_FIRST_MS)
  }, [])
}
