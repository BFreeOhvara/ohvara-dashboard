import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useFulSchedule, useFulShift } from '../../ful/data'
import { whyShort } from '../../ful/callSteps'
import { fp } from '../../ful/paths'
import { rise } from '../AppKit'
import { monthName, shiftMonth, dayWords } from '../appModel'
import { useVaCall } from './vaStore'
import { useVaNow, dayOfItem, minOfItem } from './useVaNow'
import { monthCells, stateOf, forLine, STATE_TONE, STATE_TAG } from './vaModel'

// P975 — Calendar: a real month (a box per day with a call-count pill, today ringed, past faded, days off marked).
// P977 — no pop-up: the picked day's calls sit under the month as the agent app's "Coming up" rows (time, name,
// what · for {agent}, coloured by result, past faded), with a red Now line today. Today is picked on open; tapping
// another day swaps the rows (soft fade). A call opens its brief (or the result sheet if it's owed one).
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
  const [picked, setPicked] = useState(null)
  const day = picked || todayIso
  const byDate = useMemo(() => all.reduce((m, i) => { const d = dayOfItem(i, tz); if (d) (m[d] = m[d] || []).push(i); return m }, {}), [all, tz])
  const offDates = (shift.dayOffs || []).map(o => o.date)
  const cells = monthCells(ym[0], ym[1], { byDate, todayIso, offDates })
  const list = (byDate[day] || []).slice().sort((a, b) => minOfItem(a, tz) - minOfItem(b, tz))
  const go = by => setYm(shiftMonth(ym[0], ym[1], by))
  const pick = iso => setPicked(iso === todayIso ? null : iso)
  const goToday = () => { setYm([Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))]); setPicked(null) }

  // "All of today" from Today picks that day; a call's own address (/fulfillment/calendar/<id>) opens its brief.
  const openDay = loc.state?.openDay
  useEffect(() => {
    if (!openDay) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- "All of today" on Today hands the day over in the address state
    setYm([Number(openDay.slice(0, 4)), Number(openDay.slice(5, 7))])
    setPicked(openDay === todayIso ? null : openDay)
    navigate(`${loc.pathname}${loc.search}`, { replace: true, state: { tab: 'calendar' } })
  }, [openDay]) // eslint-disable-line react-hooks/exhaustive-deps
  const briefId = route?.brief
  useEffect(() => {
    if (!briefId) return
    const it = all.find(i => i.ref === briefId || i.id === briefId)
    if (it) vc.openBrief(it)
    navigate(fp('calendar'), { replace: true, state: { tab: 'calendar' } })
  }, [briefId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openCall = i => (stateOf(i, nowMs) === 'open' ? vc.needResult(i) : vc.openBrief(i))
  const isToday = day === todayIso
  const isPast = i => { const st = stateOf(i, nowMs); return st === 'done' || st === 'noanswer' || day < todayIso || (isToday && minOfItem(i, tz) + 30 <= nowMin) }
  const nowAt = isToday ? list.findIndex(i => minOfItem(i, tz) > nowMin) : -1
  const dayOff = offDates.includes(day)
  const weekend = [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())
  const nowLine = <div className="ma-now"><span>Now</span><i aria-hidden="true" /><em aria-hidden="true" /></div>

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
              <button key={c.iso} type="button" className={`ma-day va-day ma-press ${cls}`} disabled={!c.inMonth} aria-pressed={day === c.iso}
                aria-label={`${dayWords(c.iso, todayIso)}${c.off ? ', day off' : c.count ? `, ${c.count} call${c.count === 1 ? '' : 's'}` : ''}`} onClick={() => pick(c.iso)}>
                <b>{c.n}</b>
                {c.off ? <small className="va-off">Off</small> : c.count > 0 && <small className={`va-count${c.past ? ' is-past' : ''}`}>{c.count}</small>}
              </button>
            )
          })}
        </div>
        <div className="ma-legend va-legend">{LEGEND.map(([t, w]) => <span key={t}><i className={`is-${t}`} aria-hidden="true" />{w}</span>)}<span className="va-legend-off">Day off</span></div>
      </div>

      <div className="va-dayh ma-rise" style={rise(1)}>
        <b>{dayWords(day, todayIso)}</b>
        <small>{dayOff ? 'day off' : list.length ? `${list.length} call${list.length === 1 ? '' : 's'}` : 'no calls'}</small>
      </div>
      <div key={day} className="ma-coming va-daylist" aria-live="polite">
        {list.map((i, n) => {
          const st = stateOf(i, nowMs)
          return (
            <div key={i.ref} className="va-uprow">
              {n === nowAt && nowLine}
              <button type="button" className={`ma-up is-${STATE_TONE[st]} ma-press${isPast(i) ? ' is-past' : ''}`} aria-label={`${i.time}, ${i.name}, ${forLine(whyShort(i), i.agent)}, ${STATE_TAG[st]}`} onClick={() => openCall(i)}>
                <span className="ma-up-when"><b>{i.time}</b>{st !== 'todo' && <small>{STATE_TAG[st]}</small>}</span>
                <span className="ma-grow"><b>{i.name}</b><small>{forLine(whyShort(i), i.agent)}</small></span>
              </button>
            </div>
          )
        })}
        {isToday && list.length > 0 && nowAt === -1 && nowLine}
        {!list.length && <p className="ma-empty is-glass">{dayOff ? 'Day off. Enjoy it.' : weekend ? 'No shifts at the weekend.' : day < todayIso ? 'No calls this day.' : 'Nothing booked this day yet.'}</p>}
      </div>
    </div>
  )
}
