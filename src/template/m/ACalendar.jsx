import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Clock, Ban, PhoneCall } from 'lucide-react'
import { useSampleAppointments, useSampleLeads, useSampleClients, useSampleSettings, useSampleBlocks, useWeek, AGENT_TZ, onAgentClock } from '../data'
import { dateOf } from '../../lib/callSlots'
import { clockNow } from '../leadLifecycle'
import { paths } from '../paths'
import { HoursDrawer, BlockDrawer } from '../screens/Calendar'
import { BookCall } from '../TemplateFrame'
import { BottomSheet, rise } from './AppKit'
import MonthDay from './MonthDay'
import { monthGrid, trimGrid, shiftMonth, monthName, minutesOf, dayWords, shortDay, stageOf, TONE } from './appModel'

// P967 — the Calendar is a real month: arrows, Mon to Sun, a box per day with a coloured bar per call (booked sky,
// follow up butter, client sage, to mark apricot, closed stone), today ringed, past days faded. A day opens as a
// bottom sheet: its calls by time with a red Now line today, past calls faded, a call opens its person. Under the
// month: Coming up, then Your hours / Block time (and Book a call).
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LEGEND = [['sky', 'Booked'], ['butter', 'Follow up'], ['sage', 'Client'], ['apricot', 'To mark'], ['stone', 'Closed']]
const TAGS = { sky: 'Booked', butter: 'Follow up', sage: 'Client', apricot: 'Mark', stone: 'Closed' }

export function useCalendarEvents() {
  const week = useWeek()
  const { data: raw } = useSampleAppointments()
  const { data: leads } = useSampleLeads()
  const { data: clients } = useSampleClients()
  const { data: settings } = useSampleSettings()
  const tz = settings.timeZone || AGENT_TZ
  const now = clockNow()
  return useMemo(() => raw.map(e => {
    const at = e.iso ? { ...e, ...onAgentClock(e.iso, tz), on: dateOf(e.iso, tz) } : { ...e, on: week.isoOf(e.date) }
    const p = e.kind === 'client' ? clients.find(c => c.id === e.ref) : leads.find(l => l.id === e.ref)
    const st = e.kind === 'client' ? null : p ? stageOf(p, now) : null
    const tone = e.kind === 'client' ? 'sage' : TONE[st] || 'sky'
    return { ...at, tone, mins: minutesOf(at.time), person: p }
  }).filter(e => e.on).sort((a, b) => a.on.localeCompare(b.on) || a.mins - b.mins), [raw, leads, clients, tz, week, now])
}

const openOf = e => (e.kind === 'client' ? paths.client(e.ref) : paths.lead(e.ref))

export default function ACalendar() {
  const navigate = useNavigate()
  const week = useWeek()
  const { data: settings } = useSampleSettings()
  const { data: raw } = useSampleAppointments()
  const { data: blocked } = useSampleBlocks()
  const events = useCalendarEvents()
  const now = clockNow()
  const todayIso = now.slice(0, 10)
  const nowMin = Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16))
  const [ym, setYm] = useState(() => [Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))])
  const [day, setDay] = useState(null)
  const [panel, setPanel] = useState(null)
  const cells = trimGrid(monthGrid(ym[0], ym[1]))
  const byDay = useMemo(() => events.reduce((m, e) => { (m[e.on] = m[e.on] || []).push(e); return m }, {}), [events])
  const blockedIso = new Set(week.days.filter(d => blocked.includes(d[0])).map(d => week.isoOf(d[1])))
  const past = e => e.on < todayIso || (e.on === todayIso && e.mins + 30 <= nowMin)
  const coming = events.filter(e => !past(e)).slice(0, 4)
  const go = by => setYm(shiftMonth(ym[0], ym[1], by))
  const goToday = () => { setYm([Number(todayIso.slice(0, 4)), Number(todayIso.slice(5, 7))]); setDay(todayIso) }
  const list = day ? byDay[day] || [] : []
  const open = e => { setDay(null); navigate(openOf(e), { state: { tab: 'calendar' } }) }
  const nowAt = day === todayIso ? list.findIndex(e => e.mins > nowMin) : -1
  const weekend = day ? [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()) : false

  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise">
        <span className="ma-grow"><h1>Calendar</h1><small>{monthName(ym[1])} {ym[0]}</small></span>
        <button type="button" className="ma-chip ma-press" onClick={goToday}>Today</button>
      </div>

      <div className="ma-month ma-rise" style={rise(0)}>
        <div className="ma-month-h">
          <button type="button" className="ma-round is-soft is-sm ma-press" aria-label="Last month" onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <b>{monthName(ym[1])}</b>
          <button type="button" className="ma-round is-soft is-sm ma-press" aria-label="Next month" onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        <div className="ma-dow">{DOW.map(d => <small key={d}>{d}</small>)}</div>
        <div className="ma-days">
          {cells.map(c => {
            const items = c.inMonth ? byDay[c.iso] || [] : []
            const off = blockedIso.has(c.iso)
            return (
              <MonthDay key={c.iso} cell={c} tones={items.map(e => e.tone)} today={c.iso === todayIso} past={c.iso < todayIso} picked={day === c.iso}
                off={off} offMark={<Ban size={11} aria-hidden="true" />} onPick={setDay}
                label={`${dayWords(c.iso, todayIso)}${items.length ? `, ${items.length} call${items.length === 1 ? '' : 's'}` : ''}${off ? ', blocked' : ''}`} />
            )
          })}
        </div>
        <div className="ma-legend">{LEGEND.map(([t, w]) => <span key={t}><i className={`is-${t}`} aria-hidden="true" />{w}</span>)}</div>
      </div>

      <p className="ma-cap is-out ma-rise" style={rise(1)}>Coming up</p>
      <div className="ma-coming ma-rise" style={rise(1)}>
        {coming.length
          ? coming.map(e => (
            <button key={e.id} type="button" className={`ma-up is-${e.tone} ma-press`} onClick={() => open(e)}>
              <span className="ma-up-when"><b>{shortDay(e.on, todayIso)}</b><small>{e.time}</small></span>
              <span className="ma-grow"><b>{e.who}</b><small>{e.label}</small></span>
            </button>
          ))
          : <p className="ma-empty is-glass">Nothing booked yet. Our team fills open times inside your hours.</p>}
      </div>

      <button type="button" className="ma-pillbtn ma-press ma-rise" style={rise(2)} onClick={() => setPanel('book')}><PhoneCall size={17} aria-hidden="true" />Book a call</button>
      <div className="ma-two ma-rise" style={rise(2)}>
        <button type="button" className="ma-pillbtn ma-press" onClick={() => setPanel('hours')}><Clock size={17} aria-hidden="true" />Your hours</button>
        <button type="button" className="ma-pillbtn ma-press" onClick={() => setPanel('block')}><Ban size={17} aria-hidden="true" />Block time</button>
      </div>
      <p className="ma-note">Our team books calls only inside your hours.</p>

      <BottomSheet open={!!day} onClose={() => setDay(null)} label={day ? dayWords(day, todayIso) : 'Day'} tall>
        {day && <>
          <div className="ma-day-h"><b>{dayWords(day, todayIso)}</b><small>{list.length ? `${list.length} call${list.length === 1 ? '' : 's'}` : 'no calls'}</small></div>
          <div className="ma-agenda">
            {list.map((e, i) => (
              <div key={e.id}>
                {i === nowAt && <div className="ma-now"><span>Now</span><i aria-hidden="true" /><em aria-hidden="true" /></div>}
                <div className={`ma-slot${past(e) ? ' is-past' : ''}`}>
                  <span className="ma-slot-t">{e.time}</span>
                  <button type="button" className={`ma-up is-${e.tone} ma-press`} onClick={() => open(e)}>
                    <span className="ma-grow"><b>{e.who}</b><small>{e.label}</small></span>
                    <span className="ma-tag">{TAGS[e.tone]}</span>
                  </button>
                </div>
              </div>
            ))}
            {day === todayIso && list.length > 0 && nowAt === -1 && <div className="ma-now"><span>Now</span><i aria-hidden="true" /><em aria-hidden="true" /></div>}
            {!list.length && <div className="ma-empty is-box"><b>No calls this day</b><span>{blockedIso.has(day) ? 'This day is blocked. Nothing new is booked.' : weekend ? 'Outside your hours. Enjoy the weekend.' : 'Our team fills open slots as leads come in.'}</span></div>}
          </div>
          <div className="ma-two">
            <button type="button" className="ma-btn is-soft ma-press" onClick={() => { setDay(null); setPanel('block') }}>Block time</button>
            <button type="button" className="ma-btn is-solid ma-press" onClick={() => setDay(null)}>Done</button>
          </div>
        </>}
      </BottomSheet>
      <HoursDrawer key={panel === 'hours' ? 'h-open' : 'h'} open={panel === 'hours'} onClose={() => setPanel(null)} settings={settings} appts={raw} />
      <BlockDrawer key={panel === 'block' ? 'b-open' : 'b'} open={panel === 'block'} onClose={() => setPanel(null)} appts={raw} blocked={blocked} />
      <BookCall open={panel === 'book'} onClose={() => setPanel(null)} />
    </div>
  )
}
