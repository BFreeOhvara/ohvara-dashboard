import { CalendarDays } from 'lucide-react'
import { Seg } from './kit'
import './cal947.css'

// P947 — the one calendar top row, used by the agent Calendar, the VA Calendar and the admin Fulfillment calendar (one
// file, so the three can't drift apart again): the week switch (This week · Next week, each with its count), any
// filters, the clock line, the Today button (jumps to this week and opens today), then the page's own buttons
// (the agent's Hours and Block a day; the VA's help dot). Importing it also loads cal947.css: the "Today" pill on the
// date header (no tinted column) and the lift on hover for every call box.
const CAL_WEEKS = ['This week', 'Next week']

export function CalBar({ week, onWeek, keys = [0, 1], counts = [], filters = null, clock, todayOn = false, onToday, children = null }) {
  return (
    <div className="fx-tools cal-bar947">
      <Seg label="Week" className="cal-wk" value={week} onChange={onWeek} options={keys.map((key, i) => ({ key, label: CAL_WEEKS[i], count: counts[i] ?? 0 }))} />
      {filters}
      <span className="tp-grow" />
      {clock && <p className="tp-sub">{clock}</p>}
      <span className="cal-tools">
        <button type="button" className="fx-pillbtn" aria-pressed={todayOn} onClick={onToday}><CalendarDays size={14} aria-hidden="true" />Today</button>
        {children}
      </span>
    </div>
  )
}
