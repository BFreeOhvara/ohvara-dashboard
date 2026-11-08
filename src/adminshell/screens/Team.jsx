import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Hand, MessageSquare, CalendarOff, Check, X, Plus, ChevronRight, TriangleAlert, Phone, ShieldOff, ShieldCheck, Clock3, Headset } from 'lucide-react'
import { useAdmVas, useAdmDesk, useAdmRota, useAdmActions, WEEK, NEXT_WEEK, TODAY, SHIFT_MIN, SHIFT_MAX, dayName } from '../data'
import { useAdmShifts } from '../../hooks/useVaShiftsAdmin'
import { Avatar, Chip, Drawer, Empty, PillTabs, Seg, useNote } from '../../template/kit'
import { DayBox, WeekStrip, WeekList } from '../../template/DayBox'
import { useOpenDay, useStickyDay } from '../../template/useOpenDay'
import { GRID_END, GRID_ROWS, GRID_START, lanes, minutesOf, rotaCell, shiftSpan, theirTime, vaHue, weekCalls } from '../calendar'
import { RecordDrawer, Block } from '../../template/Record'
import { usd } from '../../template/motion'
import { Dropdown, DField, Tile } from '../kit'
import { ap } from '../paths'
import { CALL_WORD, CALL_TONE, BANK_WORD } from '../words'
import { LiveDesk, SwapsAndOpen, HoursPay, Quality, Records, Holidays } from './Team879'

// P849 — the Fulfillment team: today's desk (every VA's calls on one timeline, the calls past their time and Give to,
// as admin_give_call does today), the weekly rota builder (two or three on shift every day; drag a VA onto a day, drag
// between days, or tap a VA then tap a day), day-off requests to approve, and the week's pay. A VA opens in a drawer at
// /admin/fulfillment/:id. Sample only: nothing is assigned or paid for real.
const money = usd()
const NOW = 13 * 60 + 30 // the sample "now", 1:30 PM

// Pick someone free for a call: on shift today, not on a call now.
function GivePicker({ call, vas, onPick }) {
  const free = vas.filter(v => v.onShift && v.id !== call.va_id)
  return (
    <ul className="tp-list">
      {free.map(v => (
        <li key={v.id}><button type="button" className="fx-mrow" onClick={() => onPick(v)}>
          <Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.onCall ? 'On a call now' : 'Free now'} · {v.today.total - v.today.done} calls left today</small></span>
          <span className="fx-pillbtn"><Hand size={13} />Give</span>
        </button></li>
      ))}
      {free.length === 0 && <li className="tp-sub">No one else is on shift today.</li>}
    </ul>
  )
}

function CallDrawer({ id, onClose }) {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { giveCall } = useAdmActions()
  const { data: rotaData } = useAdmRota()
  const note = useNote()
  // P867: a call from any day of the calendar (the sample week is built from the rota; today is the desk).
  const c = desk.find(x => x.id === id) || weekCalls({ desk, rota: rotaData.rota, vas, today: TODAY, days: [...WEEK, ...NEXT_WEEK] }).find(x => x.id === id)
  const [giving, setGiving] = useState(false)
  if (!c) return null
  const tone = CALL_TONE[c.status]
  return (
    <Drawer open onClose={onClose} title={`${c.client} · ${c.time}`} sub={`Cancellation call · ${c.agent}'s client · closing ${c.old_carrier}`}
      footer={c.status === 'booked' || c.status === 'late' ? <button type="button" className="tp-primary fx-accent" onClick={() => setGiving(g => !g)}><Hand size={16} />Give to someone</button> : null}>
      <div className="fx-form-row"><Avatar name={c.va} /><span className="tp-grow"><b>{c.va}</b><small className="tp-sub">Has this call</small></span><Chip tone={tone}>{CALL_WORD[c.status]}</Chip></div>
      {c.status === 'late' && <p className="adm-warn">Past its time and not started. Give it to someone free so the client isn't left waiting.</p>}
      {giving && <GivePicker call={c} vas={vas} onPick={v => { giveCall(c.id, v.id); note(`${c.client} given to ${v.name}`); setGiving(false); onClose() }} />}
    </Drawer>
  )
}

// P867 — Today is a calendar, the P854 look (the VA Schedule and the agent Calendar): This week / Next week, a week
// strip, click a day (its header, a strip chip or empty space in its column) and the day box slides in. Every VA's
// shifts and calls together, each VA in its own colour (the legend is the VA filter). Calls sit on the company clock
// with the client's own time beside it when it differs. Under it, the calls that need a hand and who is free now.
const WEEKS_ADM = [WEEK, NEXT_WEEK]
const ALL_ADM_DAYS = [...WEEK, ...NEXT_WEEK]
const HOURS_ADM = Array.from({ length: GRID_ROWS }, (_, i) => GRID_START + i)
const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const gridPct = m => ((Math.min(GRID_END * 60, Math.max(GRID_START * 60, m)) - GRID_START * 60) / (GRID_ROWS * 60)) * 100

function TeamCalendar({ openCall }) {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { data: rotaData } = useAdmRota()
  const { giveCall } = useAdmActions()
  const note = useNote()
  const [weekPick, setWeek] = useState(0)
  const [who, setWho] = useState('all')
  const [giveAll, setGiveAll] = useState(false)
  const { day, open, close } = useOpenDay(ALL_ADM_DAYS, { esc: true })
  const { view, leaving } = useStickyDay(day)
  const week = view != null ? (NEXT_WEEK.includes(view) ? 1 : 0) : weekPick
  const days = WEEKS_ADM[week]
  const cols = view != null ? [view] : days
  const calls = useMemo(() => weekCalls({ desk, rota: rotaData.rota, vas, today: TODAY, days: ALL_ADM_DAYS }), [desk, rotaData.rota, vas])
  const mine = c => who === 'all' || c.va_id === who
  const callsOf = d => calls.filter(c => c.day === d && mine(c))
  const offOn = d => rotaData.dayOff.filter(x => x.date === d && x.status === 'approved').map(x => x.va_id)
  const shiftsOf = d => (rotaData.rota[d] || []).filter(id => (who === 'all' || id === who) && !offOn(d).includes(id)).map(id => vas.find(v => v.id === id)).filter(Boolean)
  const pickWeek = w => { setWeek(w); if (day != null) close() }
  const headKey = d => e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d) } }
  const late = desk.filter(c => c.status === 'late')
  const freeSoonest = vas.filter(v => v.onShift && !v.onCall).sort((a, b) => (a.today.total - a.today.done) - (b.today.total - b.today.done))[0]
  const list = view != null ? callsOf(view) : []
  const onDay = view != null ? shiftsOf(view) : []
  const label = d => `${dayName(d)}, Nov ${d}`

  return (
    <>
      <div className="fx-tools adm-cal-tools">
        <Seg label="Week" value={week} onChange={pickWeek} options={[{ key: 0, label: 'This week' }, { key: 1, label: 'Next week' }]} />
        <WeekStrip days={days} day={view} today={TODAY} onOpen={open} has={d => callsOf(d).length > 0} name={dayName} />
      <div className="adm-cal-vas" role="radiogroup" aria-label="Show a VA">
        <button type="button" role="radio" aria-checked={who === 'all'} className={`adm-vachip${who === 'all' ? ' is-on' : ''}`} onClick={() => setWho('all')}>Every VA</button>
        {vas.map(v => (
          <button key={v.id} type="button" role="radio" aria-checked={who === v.id} className={`adm-vachip is-${vaHue(vas, v.id)}${who === v.id ? ' is-on' : ''}`} onClick={() => setWho(w => (w === v.id ? 'all' : v.id))}>
            <i aria-hidden="true" />{v.name.split(' ')[0]}
          </button>
        ))}
        <span className="adm-cal-key"><i className="adm-cal-key-shift" aria-hidden="true" />Shift<i className="adm-cal-key-call" aria-hidden="true" />Call · Central time</span>
      </div>
      </div>

      <WeekList days={days} today={TODAY} onOpen={open} name={dayName} itemsOf={callsOf} line={c => `${c.time} ${c.client}`} />

      <div className="fx-grid adm-cal" data-fold data-fold-fit="320">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week adm-week`} style={{ '--i': 0, '--days': cols.length, '--rows': GRID_ROWS }} aria-label={view != null ? label(view) : (week ? 'Next week' : 'This week')}>
          <div className="tp-tgrid-h"><span />{cols.map(d => (
            <b key={d} role="button" tabIndex={0} aria-pressed={d === view} title={d === view ? 'Back to the week' : `Open ${dayName(d)} ${d}`} className={`${d === TODAY ? 'today' : ''}${d === view ? ' is-on' : ''}`} onClick={() => open(d)} onKeyDown={headKey(d)}>
              {dayName(d)} <span>{d}</span>{d === TODAY ? <small>Today</small> : <small className="adm-cal-n">{(rotaData.rota[d] || []).length} on</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS_ADM.map(h => <span key={h}>{hourLabel(h)}</span>)}</div>
            {cols.map(d => {
              const dayCalls = callsOf(d)
              const ln = lanes(dayCalls)
              const shifts = shiftsOf(d)
              return (
                <div key={d} className={`tp-tcol adm-tcol${d === TODAY ? ' today' : ''}`} style={{ '--shifts': shifts.length }} onClick={e => { if (view == null && e.target === e.currentTarget) open(d) }}>
                  {shifts.map((v, k) => {
                    const span = shiftSpan(v.hours)
                    if (!span) return null
                    return <i key={v.id} className={`adm-shiftbar is-${vaHue(vas, v.id)}`} style={{ '--k': k, top: `${gridPct(span[0])}%`, height: `${gridPct(span[1]) - gridPct(span[0])}%` }} title={`${v.name} · ${v.hours}`} aria-label={`${v.name} on shift ${v.hours}`} />
                  })}
                  {dayCalls.map(c => {
                    const [k, of] = ln.get(c.id) || [0, 1]
                    const their = theirTime(c.time, c.state)
                    return (
                      <button key={c.id} type="button" className={`tp-ev adm-ev is-${vaHue(vas, c.va_id)}${['cancelled', 'no_answer'].includes(c.status) ? ' is-done' : ''}${c.status === 'late' ? ' is-late' : ''}`}
                        style={{ top: `${gridPct(minutesOf(c.time))}%`, height: `calc(${(30 / (GRID_ROWS * 60)) * 100}% - 2px)`, left: `calc(var(--lane-x) + (100% - var(--lane-x)) * ${k / of} + 2px)`, width: `calc((100% - var(--lane-x)) / ${of} - 4px)` }}
                        aria-label={`${c.time}${their ? ` (${their} for the client)` : ''}, ${c.client}, ${c.va}, ${CALL_WORD[c.status]}`} onClick={() => openCall(c.id)}>
                        <b>{c.time}{their && <em> · {their}</em>}</b><span>{c.client}</span>
                      </button>
                    )
                  })}
                  {d === TODAY && <i className="tp-now" style={{ top: `${gridPct(NOW)}%` }} aria-hidden="true" />}
                </div>
              )
            })}
          </div>
        </section>

        {view != null && (
          <DayBox title={label(view)} sub={`${onDay.length} on shift · ${list.length} ${list.length === 1 ? 'call' : 'calls'}`} leaving={leaving} onClose={close}>
            <h3 className="fx-h3">On shift</h3>
            <ul className="fx-rows">
              {onDay.map(v => <li key={v.id}><Link to={ap('team', v.id)} className={`fx-row adm-vrow is-${vaHue(vas, v.id)}`}><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.hours}</small></span><ChevronRight size={16} aria-hidden="true" /></Link></li>)}
              {onDay.length === 0 && <li className="tp-sub">Nobody on shift{who === 'all' ? '' : ' for this VA'}.</li>}
            </ul>
            <h3 className="fx-h3">Calls</h3>
            <ul className="fx-rows">
              {list.map(c => {
                const their = theirTime(c.time, c.state)
                return (
                  <li key={c.id}><button type="button" className={`fx-row adm-vrow is-${vaHue(vas, c.va_id)}`} onClick={() => openCall(c.id)}>
                    <span className="tp-grow"><b>{c.time} · {c.client}</b><small>{c.va.split(' ')[0]} · {CALL_WORD[c.status]}{their ? ` · ${their} for the client` : ''}</small></span>
                    {c.status === 'late' ? <span className="fx-pillbtn"><Hand size={13} />Give</span> : <ChevronRight size={16} aria-hidden="true" />}
                  </button></li>
                )
              })}
            </ul>
            {list.length === 0 && <Empty title="No calls" sub="Nothing is booked for this day." />}
          </DayBox>
        )}
      </div>

      <div className="adm-two">
        <Tile className={late.length ? 'is-fill is-warn' : ''} i={1} title="Need a hand" sub={late.length ? `${late.length} calls past their time, not started` : 'Nothing is past its time'}>
          {late.length > 0 ? <>
            <ul className="tp-list">{late.map(c => (
              <li key={c.id}><button type="button" className="fx-mrow" onClick={() => openCall(c.id)}><Clock3 size={16} aria-hidden="true" /><span className="tp-grow"><b>{c.client}</b><small>{c.time} · {c.va}</small></span><span className="fx-pillbtn"><Hand size={13} />Give</span></button></li>
            ))}</ul>
            <button type="button" className="tp-primary sm fx-accent fx-self" onClick={() => setGiveAll(true)}><Hand size={14} />Give them all</button>
          </> : <p className="fx-calm"><Check size={16} aria-hidden="true" />The desk is on time.</p>}
        </Tile>
        <Tile i={2} title="Who is free" sub="On shift and not on a call">
          <ul className="tp-list">{vas.filter(v => v.onShift).map(v => (
            <li key={v.id} className="fx-mrow"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{v.today.total - v.today.done} calls left · {v.steps} servicing steps</small></span><Chip tone={v.onCall ? 'teal' : 'green'}>{v.onCall ? 'On a call' : 'Free'}</Chip></li>
          ))}</ul>
        </Tile>
      </div>

      <Drawer open={giveAll} center onClose={() => setGiveAll(false)} title="Give them all" sub={`${late.length} calls past their time`}
        footer={freeSoonest ? <><button type="button" className="tp-primary fx-accent" onClick={() => { late.forEach(c => giveCall(c.id, freeSoonest.id)); note(`${late.length} calls given to ${freeSoonest.name}`); setGiveAll(false) }}><Hand size={16} />Give all to {freeSoonest.name.split(' ')[0]}</button><button type="button" className="tp-btn ov-ghost" onClick={() => setGiveAll(false)}>Cancel</button></> : null}>
        <p className="tp-mid">{freeSoonest ? `${freeSoonest.name} is free soonest. Or open one call to pick who.` : 'Nobody on shift is free. Open one call to pick who.'}</p>
      </Drawer>
    </>
  )
}

// P867 — the rota as a grid, like the VA side (P846/P851): VA names down the left, the days across the top, a mark
// where that VA works (their hours on hover, and in the cell's menu on a tap). Off days are empty, a day-off request
// shows "Asked off", an approved one "Off". Tap an empty cell to put the VA on that day; tap a mark to see the hours
// and take them off. Each day column counts who is on (two or three a day). P851 Phase 2: real shifts once 231 is
// applied (useAdmShifts), P849's sample rota until then; the same add/remove actions as before.
function Rota() {
  const data = useAdmShifts()
  const { team: vas, addShift, removeShift, dayName: dn, dateText: dt, today: TODAY_R } = data
  const note = useNote()
  const [week, setWeek] = useState('this')
  const [menu, setMenu] = useState(null) // `${va}|${day}` of the open cell menu
  const days = data.weeks[week === 'this' ? 0 : 1]
  const run = (p, done) => p.then(() => note(done), e => note(e?.message || 'That did not save. Try again.'))
  const first = v => v.name.split(' ')[0]
  const hoursOf = v => v.hours || data.shiftText || '8:00 AM to 6:00 PM'
  useEffect(() => {
    if (!menu) return undefined
    const onKey = e => { if (e.key === 'Escape') setMenu(null) }
    const onDown = e => { if (!e.target.closest?.('.adm-rt-cell')) setMenu(null) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown) }
  }, [menu])
  const put = (v, d) => {
    const on = data.rota[d] || []
    if (on.length >= SHIFT_MAX) { note(`Three is the most on one day. Take someone off ${dn(d)} first.`); return }
    run(addShift(d, v.id), `${first(v)} on shift ${dt(d)}`)
  }
  const tap = (v, d, cell) => {
    if (cell.kind === 'off') { note(`${first(v)} has ${dt(d)} off`); return }
    if (cell.kind === 'on' || (cell.kind === 'requested' && cell.on)) { setMenu(m => (m === `${v.id}|${d}` ? null : `${v.id}|${d}`)); return }
    put(v, d)
  }
  const short = days.filter(d => (data.rota[d] || []).length < SHIFT_MIN)
  return (
    <section className="fx-tile adm-rota" style={{ '--i': 0 }} aria-label="Rota">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Weekly rota</h2><p>{SHIFT_MIN} or {SHIFT_MAX} on shift every day. Tap an empty day to put someone on; tap a shift to see the hours or take them off.</p></span>
        <Seg label="Week" value={week} onChange={w => { setWeek(w); setMenu(null) }} options={[{ key: 'this', label: data.weekLabels[0] }, { key: 'next', label: data.weekLabels[1] }]} />
      </header>
      {short.length > 0 && <p className="adm-warn"><TriangleAlert size={14} aria-hidden="true" />{short.map(dn).join(', ')} {short.length === 1 ? 'has' : 'have'} fewer than {SHIFT_MIN} on shift.</p>}
      <div className="adm-rt-sc">
        <table className="adm-rt">
          <caption className="tp-sr">Who works which day</caption>
          <thead><tr>
            <th scope="col"><span className="tp-sr">VA</span></th>
            {days.map(d => <th key={d} scope="col" className={`${d === TODAY_R ? 'is-today' : ''}${d < TODAY_R ? ' is-past' : ''}`}>{dn(d)} <b>{data.short(d).replace(/^\D+/, '')}</b></th>)}
          </tr></thead>
          <tbody>
            {vas.map(v => (
              <tr key={v.id}>
                <th scope="row"><Avatar name={v.name} /><span>{v.name}</span></th>
                {days.map(d => {
                  const cell = rotaCell({ rota: data.rota, dayOff: data.dayOff, va: v, day: d })
                  const key = `${v.id}|${d}`
                  const isOn = cell.kind === 'on' || (cell.kind === 'requested' && cell.on)
                  const word = cell.kind === 'off' ? 'Off' : cell.kind === 'requested' ? 'Asked off' : isOn ? 'On' : ''
                  const title = cell.kind === 'off' ? `${v.name} · ${dt(d)} off` : cell.kind === 'requested' ? `${v.name} asked for ${dt(d)} off${cell.reason ? `: ${cell.reason}` : ''}` : isOn ? `${v.name} · ${hoursOf(v)}` : `Put ${first(v)} on ${dt(d)}`
                  return (
                    <td key={d} className={`adm-rt-cell${d === TODAY_R ? ' is-today' : ''}${d < TODAY_R ? ' is-past' : ''}`}>
                      <button type="button" className={`adm-rt-b is-${cell.kind || 'empty'}`} title={title} aria-label={title} aria-expanded={isOn ? menu === key : undefined} onClick={() => tap(v, d, cell)}>
                        {word ? <span className="adm-rt-mark">{word}</span> : <Plus size={13} aria-hidden="true" className="adm-rt-add" />}
                        {isOn && <small className="adm-rt-hrs">{hoursOf(v).replace(/:00/g, '').replace(' to ', '–')}</small>}
                      </button>
                      {menu === key && (
                        <div className="adm-rt-menu" role="dialog" aria-label={`${v.name}, ${dt(d)}`}>
                          <b>{v.name}</b><small>{dt(d)} · {hoursOf(v)}</small>
                          {cell.kind === 'requested' && <small className="adm-warn-t"><CalendarOff size={12} aria-hidden="true" />Asked for this day off</small>}
                          <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setMenu(null); run(removeShift(d, v.id), `${first(v)} off ${dt(d)}`) }}><X size={13} />Take off this day</button>
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <th scope="row">On shift</th>
            {days.map(d => {
              const n = (data.rota[d] || []).length
              const bad = n < SHIFT_MIN || n > SHIFT_MAX
              return <td key={d}><span className={`adm-count${bad ? ' is-bad' : ''}`}>{n} of {SHIFT_MAX}</span></td>
            })}
          </tr></tfoot>
        </table>
      </div>
      <ul className="adm-rt-key" aria-label="What the marks mean">
        <li><span className="adm-rt-mark is-on">On</span>Works that day</li>
        <li><span className="adm-rt-mark is-requested">Asked off</span>Day-off request, not answered yet</li>
        <li><span className="adm-rt-mark is-off">Off</span>Approved day off</li>
      </ul>
    </section>
  )
}

function Requests() {
  const data = useAdmShifts()
  const { decideDayOff, dateText } = data
  const note = useNote()
  const run = (p, done) => p.then(() => note(done), e => note(e?.message || 'That did not save. Try again.'))
  const pending = data.dayOff.filter(d => d.status === 'pending')
  const done = data.dayOff.filter(d => d.status !== 'pending')
  return (
    <div className="adm-two">
      <Tile i={0} title="Day-off requests" sub={pending.length ? `${pending.length} to answer` : 'Nothing to answer'}>
        <ul className="tp-list">{pending.map(r => {
          const left = (data.rota[r.date] || []).filter(x => x !== r.va_id).length
          const onShift = (data.rota[r.date] || []).includes(r.va_id)
          return (
            <li key={r.id} className="adm-req">
              <Avatar name={r.va} />
              <span className="tp-grow"><b>{r.va} · {dateText(r.date)}</b><small>{r.reason} · asked {r.asked}</small>
                {onShift && left < SHIFT_MIN && <small className="adm-warn-t"><TriangleAlert size={12} aria-hidden="true" />Leaves {left} on shift. Add someone on the rota.</small>}</span>
              <button type="button" className="tp-primary sm fx-accent" onClick={() => run(decideDayOff(r.id, true), `${r.va.split(' ')[0]} has ${dateText(r.date)} off`)}><Check size={14} />Approve</button>
              <button type="button" className="tp-btn sm ov-ghost" onClick={() => run(decideDayOff(r.id, false), 'Request declined')}>Decline</button>
            </li>
          )
        })}{pending.length === 0 && <li className="fx-calm"><Check size={16} aria-hidden="true" />All answered.</li>}</ul>
      </Tile>
      <Tile i={1} title="Answered" sub={data.answeredSub}>
        <ul className="tp-list">{done.map(r => <li key={r.id} className="fx-mrow"><Avatar name={r.va} /><span className="tp-grow"><b>{r.va}</b><small>{dateText(r.date)} · {r.reason}</small></span><Chip tone={r.status === 'approved' ? 'green' : 'mute'}>{r.status === 'approved' ? 'Approved' : 'Declined'}</Chip></li>)}</ul>
      </Tile>
    </div>
  )
}

function VaDrawer({ id, onClose }) {
  const { data: vas } = useAdmVas()
  const { data: desk } = useAdmDesk()
  const { data } = useAdmRota()
  const { setAccess, setRole } = useAdmActions()
  const note = useNote()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(null)
  const v = vas.find(x => x.id === id)
  if (!v) return <RecordDrawer label="Not found" kicker="Fulfillment" onClose={onClose} hero={<h2>No one here</h2>}><p className="fx-calm">This person is not on the team any more.</p></RecordDrawer>
  const mine = desk.filter(c => c.va_id === v.id)
  const tone = v.onCall ? 'teal' : v.onShift ? 'green' : 'mute'
  const [bw, bt] = BANK_WORD[v.bank]
  return (
    <RecordDrawer label={v.name} kicker={`Fulfillment · joined ${v.joined}`} tone={tone} onClose={onClose}
      hero={<>
        <div className="fx-hero-top"><span className="fx-when"><Headset size={13} aria-hidden="true" />{v.onCall ? 'On a call now' : v.onShift ? `On shift · ${v.hours}` : 'Off today'}</span><Chip tone={bt}>{bw}</Chip></div>
        <h2>{v.name}</h2>
        <p><Phone size={13} aria-hidden="true" />{v.phone} · {v.email}</p>
        <div className="fx-hero-bot"><b className="fx-hero-big tp-money">{money(v.week.verified + v.week.checking)}</b><Avatar name={v.name} tone={tone} /></div>
      </>}
      actions={<>
        <Link to={`${ap('messages')}?to=${v.id}`} className="tp-primary fx-accent"><MessageSquare size={16} />Message</Link>
        <Link to={`${ap('team')}?tab=rota`} className="tp-btn ov-ghost">Rota</Link>
      </>}>
      <Block title="This week">
        <dl className="fx-facts">{[['On shift', `${v.days} of 7 days`], ['Hours this week', String(v.week.hours)], ['Missed calls', String(v.missed)], ['Servicing steps', String(v.steps)]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
        <div className="adm-weekdots" aria-label="Days on shift">{WEEK.map(d => <span key={d} className={(data.rota[d] || []).includes(v.id) ? 'is-on' : ''}><small>{dayName(d)}</small></span>)}</div>
      </Block>
      <Block title="Today's calls">
        <ul className="tp-list">{mine.map(c => <li key={c.id} className="fx-mrow"><small className="tp-num adm-time">{c.time}</small><span className="tp-grow"><b>{c.client}</b><small>{c.old_carrier} · {c.agent}</small></span><Chip tone={CALL_TONE[c.status]}>{CALL_WORD[c.status]}</Chip></li>)}
          {mine.length === 0 && <li className="tp-sub">No calls today.</li>}</ul>
      </Block>
      <Block title="Access">
        <DField label="Role"><Dropdown label="Role" value="fulfillment" options={[{ value: 'fulfillment', label: 'Fulfillment' }, { value: 'agent', label: 'Agent' }]} onChange={x => x !== 'fulfillment' && setAsk('role')} /></DField>
        <div className="fx-form-row">
          {v.access
            ? <button type="button" className="tp-btn ov-ghost tp-danger" onClick={() => setAsk('off')}><ShieldOff size={15} />Turn access off</button>
            : <button type="button" className="tp-btn ov-ghost" onClick={() => { setAccess(v.id, true); note(`${v.name} can sign in again`) }}><ShieldCheck size={15} />Turn access back on</button>}
        </div>
      </Block>
      <Drawer open={ask === 'off'} center onClose={() => setAsk(null)} title="Turn access off?" sub={v.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setAccess(v.id, false); note(`${v.name} can't sign in now`); setAsk(null) }}>Turn it off</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep access</button></>}>
        <p className="tp-mid">They are signed out. {mine.filter(c => c.status === 'booked' || c.status === 'late').length ? 'Give their open calls to someone first.' : 'They have no open calls today.'}</p>
      </Drawer>
      <Drawer open={ask === 'role'} center onClose={() => setAsk(null)} title="Make them an agent?" sub={v.name}
        footer={<><button type="button" className="tp-primary fx-accent" onClick={() => { setRole(v.id, 'agent'); note(`${v.name} is an agent now`); setAsk(null); navigate(ap('agents', v.id)) }}>Change the role</button><button type="button" className="tp-btn ov-ghost" onClick={() => setAsk(null)}>Keep Fulfillment</button></>}>
        <p className="tp-mid">{mine.length ? `${v.name} has ${mine.length} calls today. They need someone else.` : 'They have no calls today.'} They come off the rota.</p>
      </Drawer>
    </RecordDrawer>
  )
}

// P879: Live desk, Quality and Records join; Day off is Time off (swaps and open shifts too); Pay is hourly from clock
// in/out (Q76); the per-cancellation Pay tile is gone (Billing › Payouts and Settings › Pay rules still say per
// cancellation until 858 rewires pay).
const TABS = [['today', 'Today'], ['desk', 'Live desk'], ['rota', 'Rota'], ['requests', 'Time off'], ['pay', 'Hours & pay'], ['quality', 'Quality'], ['records', 'Records']]
export default function Team() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const rota = useAdmShifts()
  const tab = TABS.some(t => t[0] === sp.get('tab')) ? sp.get('tab') : 'today'
  const call = sp.get('call')
  const pending = rota.dayOff.filter(d => d.status === 'pending').length
  const setTab = t => setSp(t === 'today' ? {} : { tab: t }, { replace: true })
  return (
    <div className="tp-page fx-page adm-team">
      <PillTabs label="Fulfillment team" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={setTab}
        items={TABS.map(([k, label]) => ({ key: k, label, count: k === 'requests' && pending ? pending : undefined }))} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'today' && <TeamCalendar openCall={c => setSp(p => { const n = new URLSearchParams(p); n.set('call', c); return n }, { replace: true })} />}
        {tab === 'desk' && <LiveDesk />}
        {tab === 'rota' && <><Rota /><Holidays /></>}
        {tab === 'requests' && <><Requests /><SwapsAndOpen /></>}
        {tab === 'pay' && <HoursPay />}
        {tab === 'quality' && <Quality />}
        {tab === 'records' && <Records />}
      </div>
      {call && <CallDrawer id={call} onClose={() => setSp(p => { const n = new URLSearchParams(p); n.delete('call'); return n }, { replace: true })} />}
      {id && <VaDrawer id={id} onClose={() => navigate(ap('team'))} />}
    </div>
  )
}
