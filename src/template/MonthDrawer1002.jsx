import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { Drawer } from './kit'
import { monthGrid, trimGrid, shiftMonth, monthName } from './m/appModel'
import './month1002.css'

// P1002: the month view the phone Calendar always had, on desktop. A Mon to Sun grid with a dot per call (lead blue,
// client the other colour, three at most then +N), today ringed, past days faded. Pick a day to list its calls; pick a
// call to open it the same way a week box does (onOpen).
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const mins = t => { const [, h, m, ap] = /(\d+):(\d+)\s*(AM|PM)/.exec(t || '') || [0, 0, 0, 'AM']; return (Number(h) % 12) * 60 + (ap === 'PM' ? 720 : 0) + Number(m) }
const dayName = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function MonthDrawer({ open, onClose, events, todayIso, lookOf, onOpen }) {
  const [ym, setYm] = useState(() => [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))])
  const [day, setDay] = useState(todayIso)
  const cells = useMemo(() => trimGrid(monthGrid(ym[0], ym[1])), [ym])
  const byDay = useMemo(() => events.reduce((m, e) => { (m[e.on] = m[e.on] || []).push(e); return m }, {}), [events])
  const list = (byDay[day] || []).slice().sort((a, b) => mins(a.time) - mins(b.time))
  const go = by => setYm(shiftMonth(ym[0], ym[1], by))
  return (
    <Drawer open={open} onClose={onClose} title="Month" sub="Every call you have booked, by day">
      <div className="mo-head">
        <button type="button" className="tp-btn ov-ghost mo-arrow" aria-label="Last month" onClick={() => go(-1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <b>{monthName(ym[1])} {ym[0]}</b>
        <button type="button" className="tp-btn ov-ghost mo-arrow" aria-label="Next month" onClick={() => go(1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="mo-dow">{DOW.map(d => <small key={d}>{d}</small>)}</div>
      <div className="mo-days">
        {cells.map(c => {
          const items = c.inMonth ? byDay[c.iso] || [] : []
          return (
            <button key={c.iso} type="button" disabled={!c.inMonth} aria-pressed={day === c.iso}
              className={`mo-day${c.inMonth ? '' : ' is-out'}${c.iso === todayIso ? ' is-today' : ''}${c.iso < todayIso ? ' is-past' : ''}${day === c.iso ? ' is-picked' : ''}`}
              aria-label={`${dayName(c.iso)}${items.length ? `, ${items.length} call${items.length === 1 ? '' : 's'}` : ''}`} onClick={() => setDay(c.iso)}>
              <b>{c.n}</b>
              <span className="mo-dots">{items.slice(0, 3).map(e => <i key={e.id} className={`tp-dot ${e.kind}`} />)}{items.length > 3 && <small>+{items.length - 3}</small>}</span>
            </button>
          )
        })}
      </div>
      <div className="mo-legend"><span><i className="tp-dot lead" aria-hidden="true" />Lead call</span><span><i className="tp-dot client" aria-hidden="true" />Client call</span></div>
      <h3 className="fx-h3">{dayName(day)}</h3>
      {list.length
        ? <ul className="fx-rows">{list.map(e => { const look = lookOf(e); return <li key={e.id}><button type="button" className={`fx-row is-${look.tone}${look.done ? ' is-past' : ''}`} onClick={() => { onClose(); onOpen(e) }}><span className="fx-row-ic"><Clock size={15} aria-hidden="true" /></span><span className="tp-grow"><b>{e.time} · {e.who}</b><small>{e.label}</small></span></button></li> })}</ul>
        : <p className="tp-sub">Nothing booked.</p>}
    </Drawer>
  )
}
