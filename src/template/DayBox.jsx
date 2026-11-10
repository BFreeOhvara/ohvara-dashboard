import { ArrowLeft, X } from 'lucide-react'
import './daybox.css'

// P854 — the week calendar with a day you click open, shared by the VA Schedule and the agent Calendar.
// The week is full width; clicking a day (its header, its strip chip, or empty space in its column) opens that day:
// the grid narrows to the day and the day box slides in from the right. Another day swaps the box; the same day
// again, the box's X or Esc returns to the week. The open day is in the URL (?day=2026-11-10), so Back closes it and
// the link reopens it. On a phone the day opens full screen (a bottom sheet) with Back to the week.

// The week strip: one chip per day; the open day is lit; a dot marks days with something on.
// P852: num = the date shown for a day key (the VA side's real days are keyed yyyymmdd); the sample keys are the date.
export function WeekStrip({ days, day, today, onOpen, has, name, num = d => d, label = 'Open a day' }) {
  return (
    <div className="fx-chips fx-daystrip" role="group" aria-label={label}>
      {days.map(d => (
        <button key={d} type="button" className={`fx-pt fx-chip${day === d ? ' is-on on' : ''}`} aria-pressed={day === d} aria-label={`${name(d)} ${num(d)}${d === today ? ', today' : ''}`} onClick={() => onOpen(d)}>
          <small>{name(d)}</small><b>{num(d)}</b>
          {d === today ? <i className="fs-today" aria-hidden="true" /> : has(d) ? <i aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  )
}

// The phone's week: one row per day with what's on; a tap opens the day full screen.
export function WeekList({ days, today, onOpen, name, num = d => d, itemsOf, line }) {
  return (
    <ul className="fx-weeklist" aria-label="The week">
      {days.map(d => {
        const list = itemsOf(d)
        return (
          <li key={d}>
            <button type="button" className={`fx-wl-row${d === today ? ' is-today' : ''}`} onClick={() => onOpen(d)}>
              <span className="fx-wl-d"><small>{name(d)}</small><b>{num(d)}</b></span>
              <span className="tp-grow">{list.length ? list.slice(0, 2).map(line).join(' · ') : 'Nothing on'}{list.length > 2 ? ` · ${list.length - 2} more` : ''}</span>
              <b className="tp-num fx-wl-n">{list.length}</b>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// The day box: slides in from the right (a bottom sheet on a phone). children = the day's agenda.
// P946: onBack = a call is open inside the box (the VA Calendar): the back arrow and the X both go back to the day's
// list; with the list showing, the X closes the box.
export function DayBox({ title, sub, leaving, onClose, onBack = null, children }) {
  const back = onBack || onClose
  return (
    <aside className={`fx-tile fx-s4 fx-agenda fx-daybox${onBack ? ' is-detail' : ''}${leaving ? ' is-leaving' : ''}`} aria-label={title}>
      <header className="fx-tile-h">
        <button type="button" className="tp-btn ov-ghost fx-daybox-back" onClick={back}><ArrowLeft size={15} aria-hidden="true" />{onBack ? 'Back to the day' : 'Back to the week'}</button>
        <span className="tp-grow"><h2>{title}</h2><p>{sub}</p></span>
        <button type="button" className="fx-x fx-daybox-x" aria-label={onBack ? 'Back to the day' : 'Close the day'} onClick={back}><X size={17} /></button>
      </header>
      {children}
    </aside>
  )
}
