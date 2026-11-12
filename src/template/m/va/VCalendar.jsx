import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFulSchedule, useFulShift } from '../../ful/data'
import { whyShort } from '../../ful/callSteps'
import { fp } from '../../ful/paths'
import { BottomSheet, rise } from '../AppKit'
import { monthName, shiftMonth, dayWords } from '../appModel'
import { useVaCall } from './vaStore'
import { useVaNow, dayOfItem, minOfItem } from './useVaNow'
import { monthCells, hourRows, stateOf, forLine, STATE_TONE, STATE_TAG } from './vaModel'

// P975 — Calendar: a real month (a box per day with a call-count pill, today ringed, past faded, days off marked).
// A day opens as a bottom sheet hour by hour, 8 AM to 6 PM: each call coloured by its result (done, no answer, to call,
// needs a result), past faded, a red Now line today; a call opens its brief (or the result sheet if it's owed one).
// Under the month: the rest of today.
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LEGEND = [['sky', 'To call'], ['sage', 'Done'], ['butter', 'No answer'], ['apricot', 'Needs a result']]

export default function VCalendar({ route }) {
  const vc = useVaCall()
  const loc = useLocation()
  const navigate = useNavigate()
  const { data: all } = useFulSchedule()
  const { data: shift } = useFulShift()
  const { nowMs, tz, todayIso, nowMin } = useVaNow()
  const [ym, setYm] = useState(() => [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))])
  const [day, setDay] = useState(null)
  const byDate = useMemo(() => all.reduce((m, i) => { const d = dayOfItem(i, tz); if (d) (m[d] = m[d] || []).push(i); return m }, {}), [all, tz])
  const offDates = (shift.dayOffs || []).map(o => o.date)
  const cells = monthCells(ym[0], ym[1], { byDate, todayIso, offDates })
  const list = day ? (byDate[day] || []).slice().sort((a, b) => minOfItem(a, tz) - minOfItem(b, tz)) : []
  const rows = hourRows(list, { today: day === todayIso, nowMin, minOf: i => minOfItem(i, tz) })
  const rest = (byDate[todayIso] || []).filter(i => stateOf(i, nowMs) === 'todo')
  const go = by => setYm(shiftMonth(ym[0], ym[1], by))
  const goToday = () => { setYm([Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))]); setDay(todayIso) }

  // "All of today" from Today opens today's sheet; a call's own address (/fulfillment/calendar/<id>) opens its brief.
  const openDay = loc.state?.openDay
  useEffect(() => {
    if (!openDay) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- "All of today" on Today hands the day over in the address state
    setYm([Number(openDay.slice(0, 4)), Number(openDay.slice(5, 7))])
    setDay(openDay)
    navigate(`${loc.pathname}${loc.search}`, { replace: true, state: { tab: 'calendar' } })
  }, [openDay]) // eslint-disable-line react-hooks/exhaustive-deps
  const briefId = route?.brief
  useEffect(() => {
    if (!briefId) return
    const it = all.find(i => i.ref === briefId || i.id === briefId)
    if (it) vc.openBrief(it)
    navigate(fp('calendar'), { replace: true, state: { tab: 'calendar' } })
  }, [briefId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openCall = i => {
    setDay(null)
    if (stateOf(i, nowMs) === 'open') vc.needResult(i)
    else vc.openBrief(i)
  }
  const dayIsOff = day && (offDates.includes(day) || [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()))

  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise">
        <span className="ma-grow"><h1>Calendar</h1><small>Your booked calls</small></span>
        <button type="button" className="ma-chip va-tap ma-press" onClick={goToday}>Today</button>
      </div>

      <div className="ma-month ma-rise" style={rise(0)}>
        <div className="ma-month-h">
          <button type="button" className="ma-round is-soft ma-press" aria-label="Last month" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <b>{monthName(ym[1])}</b>
          <button type="button" className="ma-round is-soft ma-press" aria-label="Next month" onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        <div className="ma-dow">{DOW.map(d => <small key={d}>{d}</small>)}</div>
        <div className="ma-days">
          {cells.map(c => {
            const cls = [c.inMonth ? '' : 'is-out', c.today ? 'is-today' : '', c.past ? 'is-past' : '', c.off ? 'is-off' : '', day === c.iso ? 'is-picked' : ''].filter(Boolean).join(' ')
            return (
              <button key={c.iso} type="button" className={`ma-day va-day ma-press ${cls}`} disabled={!c.inMonth}
                aria-label={`${dayWords(c.iso, todayIso)}${c.off ? ', day off' : c.count ? `, ${c.count} call${c.count === 1 ? '' : 's'}` : ''}`} onClick={() => setDay(c.iso)}>
                <b>{c.n}</b>
                {c.off ? <small className="va-off">Off</small> : c.count > 0 && <small className={`va-count${c.past ? ' is-past' : ''}`}>{c.count}</small>}
              </button>
            )
          })}
        </div>
        <div className="ma-legend va-legend"><span><i className="is-sky" aria-hidden="true" />Calls booked</span><span className="va-legend-off">Off · day off</span></div>
      </div>

      <p className="ma-cap is-out ma-rise" style={rise(1)}>Rest of today</p>
      <div className="ma-coming ma-rise" style={rise(1)}>
        {rest.length
          ? rest.map(i => (
            <button key={i.ref} type="button" className="ma-up is-sky ma-press" onClick={() => vc.openBrief(i)}>
              <span className="ma-up-when"><b>{i.time}</b></span>
              <span className="ma-grow"><b>{i.name}</b><small>{forLine(whyShort(i), i.agent)}</small></span>
            </button>
          ))
          : <p className="ma-empty is-glass">Nothing left to call today.</p>}
      </div>

      <BottomSheet open={!!day} onClose={() => setDay(null)} label={day ? dayWords(day, todayIso) : 'Day'} tall>
        {day && <>
          <div className="ma-day-h"><b>{dayWords(day, todayIso)}</b><small>{offDates.includes(day) ? 'day off' : list.length ? `${list.length} call${list.length === 1 ? '' : 's'}` : 'no calls'}</small></div>
          {dayIsOff && !list.length && <div className="va-dayoff">{offDates.includes(day) ? 'Day off. Enjoy it.' : 'No shifts at the weekend.'}</div>}
          <div className="va-hours">
            {rows.map(r => (
              <div key={r.h} className="va-hour">
                <span className="va-hour-t">{r.label}</span>
                <div className="va-hour-b">
                  {r.now && <div className="ma-now va-now"><i aria-hidden="true" /><em aria-hidden="true" /><span>Now</span></div>}
                  {r.calls.map(i => {
                    const st = stateOf(i, nowMs)
                    return (
                      <button key={i.ref} type="button" className={`ma-up va-slot is-${STATE_TONE[st]} ma-press${st === 'done' || st === 'noanswer' ? ' is-past' : ''}`} onClick={() => openCall(i)}>
                        <span className="ma-grow"><b>{i.time} · {i.name}</b><small>{forLine(whyShort(i), i.agent)}</small></span>
                        <span className="ma-tag">{STATE_TAG[st]}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="va-legend is-sheet">{LEGEND.map(([t, w]) => <span key={t}><i className={`is-${t}`} aria-hidden="true" />{w}</span>)}</div>
          <button type="button" className="ma-btn is-solid va-wide ma-press" onClick={() => setDay(null)}>Done</button>
        </>}
      </BottomSheet>
    </div>
  )
}
