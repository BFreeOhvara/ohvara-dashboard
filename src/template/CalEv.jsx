import './cal958.css'

// P958 — the inside of one call box on every week calendar (agent, VA, admin Fulfillment): line 1 "time · name",
// line 2 "type · client time", each one line across the box's full width and shortened with "…" (never cut in half:
// a box is never shorter than both lines, cal958 EV_MIN_PX). A call that has passed with no result yet carries a
// small "Mark result" dot. The box's classes come from cal958 evClass; the timing hooks from useCal958.
export function EvText({ l1, l2, mark = false }) {
  return (
    <>
      <span className="ev958-l1">{l1}</span>
      {l2 ? <span className="ev958-l2">{l2}</span> : null}
      {mark && <i className="ev958-mark" title="Mark result" aria-hidden="true" />}
    </>
  )
}
