import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Hand, MessageSquare, Check, X, Plus, TriangleAlert, Phone, ShieldOff, ShieldCheck, Headset, ArrowLeft, Clock, ChevronRight } from 'lucide-react'
import { useAdmVas, useAdmDesk, useAdmRota, useAdmActions, useAdmSettings, WEEK, NEXT_WEEK, TODAY, SHIFT_MIN, SHIFT_MAX, dayName } from '../data'
import { useAdmShifts } from '../../hooks/useVaShiftsAdmin'
import { Avatar, Chip, Drawer, Empty, PillTabs, Seg, useNote } from '../../template/kit'
import { WeekList, DayBox } from '../../template/DayBox'
import { CalBar } from '../../template/CalBar'
import { FilterPills } from '../../template/FilterPills'
import { useOpenDay, useStickyDay } from '../../template/useOpenDay'
import { GRID_END, GRID_ROWS, GRID_START, lanes, minutesOf, rotaCell, theirTime, vaHue, weekCalls } from '../calendar'
import { RecordDrawer, Block } from '../../template/Record'
import { usd, CountUp } from '../../template/motion'
import { Dropdown, DField, Tile } from '../kit'
import '../../template/cal910.css' // P942: the agent Calendar's day headers and call hover, exactly
import { ap } from '../paths'
import { CALL_WORD, CALL_TONE, BANK_WORD } from '../words'
import { SwapsAndOpen, HoursPay, Holidays } from './Team879'
import { DAYS_OFF_DEFAULT, daysUsed, daysLeft } from '../../lib/dayOff'
import { canTakeCalls, TRAIN_FIRST } from '../../lib/trainingGate.js'
import { NUDGE_AFTER, HANDOFF_AFTER } from '../../lib/callEscalation.js'

// P849 — the Fulfillment team: today's desk (every VA's calls on one timeline, the calls past their time and Give to,
// as admin_give_call does today), the weekly rota builder (two or three on shift every day; drag a VA onto a day, drag
// between days, or tap a VA then tap a day), day-off requests to approve, and the week's pay. A VA opens in a drawer at
// /admin/fulfillment/:id. Sample only: nothing is assigned or paid for real.
const money = usd()
const NOW = 13 * 60 + 30 // the sample "now", 1:30 PM

// Pick someone free for a call: on shift today, not on a call now.
function GivePicker({ call, vas, onPick }) {
  // P936: a VA still in training can't be given calls; they show greyed with why.
  const free = vas.filter(v => v.onShift && v.id !== call.va_id && canTakeCalls(v))
  const training = vas.filter(v => v.onShift && v.id !== call.va_id && !canTakeCalls(v))
  return (
    <ul className="tp-list">
      {training.map(v => <li key={v.id} className="fx-mrow is-off" aria-disabled="true"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{TRAIN_FIRST}</small></span></li>)}
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

// P945: a call nobody starts moves on by itself (lib/callEscalation.js); the call says what happened or will happen.
function EscalationNote({ c, vas }) {
  const first = id => (vas.find(v => v.id === id)?.name || 'Their VA').split(' ')[0]
  if (c.moved) return <p className="tp-sub adm-moved">Moved from {first(c.moved.from)} after {c.moved.after} minutes with no start ({first(c.moved.from)} was told).</p>
  if (c.status === 'rebook') return <p className="tp-sub adm-moved">Nobody was free {HANDOFF_AFTER} minutes after its time, so the AI front desk is texting the client to rebook.</p>
  if (c.status === 'late') return <p className="tp-sub adm-moved">Not started yet. {first(c.va_id)} was pinged at {NUDGE_AFTER} minutes; at {HANDOFF_AFTER} it goes to the next free VA by itself (their pod first), or the AI front desk rebooks it.</p>
  return null
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
      <EscalationNote c={c} vas={vas} />
      {giving && <GivePicker call={c} vas={vas} onPick={v => { giveCall(c.id, v.id); note(`${c.client} given to ${v.name}`); setGiving(false); onClose() }} />}
    </Drawer>
  )
}

// P867 — the week calendar, the P854 look (the VA Schedule and the agent Calendar). P913: the Calendar tab, This week ·
// Next week and the VA filters on top. P934 (Brayden, Nov 10): it works like the agent's Calendar. The same week switch
// (Seg .cal-wk with counts), the page never scrolls (data-fold-fit sizes it to the window), and clicking a day (its
// header, an hour row, or a call) slides in the agent's day panel (DayBox) with that day's calls; a call opens its
// details inside the panel, where it can be given to someone free. Every VA's shifts and calls, each in their colour.
const WEEKS_ADM = [WEEK, NEXT_WEEK]
const ALL_ADM_DAYS = [...WEEK, ...NEXT_WEEK]
const HOURS_ADM = Array.from({ length: GRID_ROWS }, (_, i) => GRID_START + i)
const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`
const gridPct = m => ((Math.min(GRID_END * 60, Math.max(GRID_START * 60, m)) - GRID_START * 60) / (GRID_ROWS * 60)) * 100

// One call's details inside the day panel: who has it, the client's time, and Give to someone while it's still ahead.
function DayCall({ c, vas, onBack }) {
  const { giveCall } = useAdmActions()
  const note = useNote()
  const [giving, setGiving] = useState(false)
  const their = theirTime(c.time, c.state)
  const ahead = c.status === 'booked' || c.status === 'late'
  return (
    <div className="adm-daycall">
      <button type="button" className="tp-btn ov-ghost sm adm-dayback" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" />All calls that day</button>
      <div className="fx-form-row"><Avatar name={c.client} /><span className="tp-grow"><b>{c.client}</b><small className="tp-sub">{c.time} Central{their ? ` · ${their} for them` : ''}</small></span><Chip tone={CALL_TONE[c.status]}>{CALL_WORD[c.status]}</Chip></div>
      <dl className="fx-facts">{[['With', c.va], ['Call', 'Cancellation call'], ['Closing', c.old_carrier], ['Agent', c.agent || 'Their agent'], ['Client in', c.state]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <EscalationNote c={c} vas={vas} />
      {ahead && <button type="button" className="tp-primary fx-accent" aria-expanded={giving} onClick={() => setGiving(g => !g)}><Hand size={16} />Give to someone</button>}
      {giving && <GivePicker call={c} vas={vas} onPick={v => { giveCall(c.id, v.id); note(`${c.client} given to ${v.name}`); setGiving(false) }} />}
    </div>
  )
}

function TeamCalendar() {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { data: rotaData } = useAdmRota()
  const [weekPick, setWeek] = useState(0)
  const [who, setWho] = useState('all')
  const [sel, setSel] = useState(null) // { id, day }: the call shown in the day panel
  const { day, open, close } = useOpenDay(ALL_ADM_DAYS, { esc: true })
  const { view, leaving } = useStickyDay(day)
  const week = view != null ? (NEXT_WEEK.includes(view) ? 1 : 0) : weekPick
  const days = WEEKS_ADM[week]
  const cols = view != null ? [view] : days
  const calls = useMemo(() => weekCalls({ desk, rota: rotaData.rota, vas, today: TODAY, days: ALL_ADM_DAYS }), [desk, rotaData.rota, vas])
  const mine = c => who === 'all' || c.va_id === who
  const callsOf = d => calls.filter(c => c.day === d && mine(c))
  const offOn = d => rotaData.dayOff.filter(x => x.date === d && x.status !== 'declined').map(x => x.va_id)
  const shiftsOf = d => (rotaData.rota[d] || []).filter(id => (who === 'all' || id === who) && !offOn(d).includes(id)).map(id => vas.find(v => v.id === id)).filter(Boolean)
  const pickWeek = w => { setWeek(w); if (day != null) close() }
  const label = d => `${dayName(d)}, Nov ${d}`
  const toggle = d => { setSel(null); if (d === view) close(); else open(d) }
  const showCall = c => { setSel({ id: c.id, day: c.day }); if (c.day !== day) open(c.day) }
  const list = view != null ? callsOf(view) : []
  const picked = sel && sel.day === view ? calls.find(c => c.id === sel.id) : null
  const countIn = w => calls.filter(c => WEEKS_ADM[w].includes(c.day) && mine(c)).length

  return (
    <>
      {/* P947: the one calendar top row (template/CalBar.jsx), the same file as the agent and VA calendars. */}
      <CalBar week={week} onWeek={pickWeek} counts={[countIn(0), countIn(1)]} filters={<VaFilter vas={vas} who={who} setWho={setWho} />}
        clock="Central time · client times beside theirs" todayOn={view === TODAY} onToday={() => { setSel(null); setWeek(0); if (view !== TODAY) open(TODAY) }} />

      <WeekList days={days} today={TODAY} onOpen={open} name={dayName} itemsOf={callsOf} line={c => `${c.time} ${c.client}`} />

      {/* P945: the calendar sits below the tools and is a whole screen tall (the page scrolls to it), so every call shows. */}
      <div className="fx-grid adm-cal adm-big-cal adm-cal945">
        <section className={`fx-tile ${view != null ? 'fx-s8 is-day' : 'fx-s12 is-week'} fx-week cal910 adm-week`} style={{ '--i': 0, '--days': cols.length, '--rows': GRID_ROWS }} aria-label={view != null ? label(view) : (week ? 'Next week' : 'This week')}>
          <div className="tp-tgrid-h"><span />{cols.map(d => (
            // P942: the agent Calendar's day header exactly (cal910: same size, colour, hover, pressed)
            <b key={d} role="button" tabIndex={0} aria-pressed={d === view} title={d === view ? 'Back to the week' : `Open ${dayName(d)} ${d}`} className={`${d === TODAY ? 'today' : ''}${d === view ? ' is-on' : ''}`} onClick={() => toggle(d)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d) } }}>
              {dayName(d)} <span>{d}</span>{d === TODAY && <small>Today</small>}
            </b>
          ))}</div>
          <div className="tp-tgrid-b">
            <div className="tp-hours">{HOURS_ADM.map(h => <span key={h}>{hourLabel(h)}</span>)}</div>
            {cols.map(d => {
              const dayCalls = callsOf(d)
              const ln = lanes(dayCalls)
              // P945: no coloured shift lines; who is on shift shows in the day panel and the Rota.
              return (
                <div key={d} className={`tp-tcol adm-tcol${d === TODAY ? ' today' : ''}`}>
                  {HOURS_ADM.map((h, r) => <button key={h} type="button" className="adm-rowbtn adm-hourbtn" style={{ top: `${(r / GRID_ROWS) * 100}%`, height: `${100 / GRID_ROWS}%` }} aria-label={`${label(d)}, ${hourLabel(h)}${d === view ? ': back to the week' : ': open the day'}`} onClick={() => toggle(d)} />)}
                  {dayCalls.map(c => {
                    const [k, of] = ln.get(c.id) || [0, 1]
                    const their = theirTime(c.time, c.state)
                    return (
                      <button key={c.id} type="button" className={`tp-ev adm-ev is-${vaHue(vas, c.va_id)}${['cancelled', 'no_answer'].includes(c.status) ? ' is-done' : ''}${c.status === 'late' ? ' is-late' : ''}${picked?.id === c.id ? ' is-picked' : ''}`}
                        style={{ top: `${gridPct(minutesOf(c.time))}%`, height: `calc(${(30 / (GRID_ROWS * 60)) * 100}% - 2px)`, left: `calc(var(--lane-x) + (100% - var(--lane-x)) * ${k / of} + 2px)`, width: `calc((100% - var(--lane-x)) / ${of} - 4px)` }}
                        aria-label={`${c.time}${their ? ` (${their} for the client)` : ''}, ${c.client}, ${c.va}, ${CALL_WORD[c.status]}`} onClick={() => showCall(c)}>
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
          <DayBox title={label(view)} sub={list.length ? `${list.length} ${list.length === 1 ? 'call' : 'calls'} · ${shiftsOf(view).length} on shift` : 'Nothing booked'} leaving={leaving} onClose={() => { setSel(null); close() }}>
            {picked ? <DayCall key={picked.id} c={picked} vas={vas} onBack={() => setSel(null)} /> : <>
              <b className="tp-num fx-huge2"><CountUp value={list.length} /><small> {list.length === 1 ? 'call' : 'calls'}</small></b>
              <ul className="fx-rows">
                {list.map(c => (
                  <li key={c.id}><button type="button" className={`fx-row adm-dayrow is-${vaHue(vas, c.va_id)}`} onClick={() => setSel({ id: c.id, day: c.day })}>
                    <span className="fx-row-ic"><Clock size={15} aria-hidden="true" /></span>
                    <span className="tp-grow"><b>{c.client}</b><small>{c.time} · {c.va.split(' ')[0]} · {CALL_WORD[c.status]}</small></span><ChevronRight size={16} aria-hidden="true" />
                  </button></li>
                ))}
              </ul>
              {list.length === 0 && <Empty title="No calls" sub={shiftsOf(view).length ? 'Nobody is booked yet that day.' : 'Nobody is on shift that day.'} />}
            </>}
          </DayBox>
        )}
      </div>
    </>
  )
}

// P867 (P945: the calendar no longer draws each VA's shift as a coloured vertical line.)
// The VA filter: Every VA, or one VA (tap again for all). Each VA's colour is their calendar colour.
// P934: the agent side's colour-coded filter pills (FilterPills), each VA in their calendar colour.
const HUE_TONE = { sky: 'blue', apricot: 'warn', sage: 'green', butter: 'teal', lilac: 'violet' }
function VaFilter({ vas, who, setWho }) {
  return <FilterPills label="Show a VA" value={who} onChange={setWho} className="adm-cal-vas" items={[{ key: 'all', label: 'Every VA' }, ...vas.map(v => ({ key: v.id, label: v.name.split(' ')[0], tone: HUE_TONE[vaHue(vas, v.id)] }))]} />
}

// P913 — Today is a calendar of the VAs' booked calls for today: one row per hour, each call a button in its VA's
// colour (tap to open it). The current hour is outlined. "Needs a hand" and "Who is free" are gone (the other tabs
// cover them).
function TodayCalls({ openCall }) {
  const { data: desk } = useAdmDesk()
  const { data: vas } = useAdmVas()
  const { data: rotaData } = useAdmRota()
  const [who, setWho] = useState('all')
  const calls = useMemo(() => weekCalls({ desk, rota: rotaData.rota, vas, today: TODAY, days: [TODAY] }).filter(c => c.day === TODAY), [desk, rotaData.rota, vas])
  const shown = calls.filter(c => who === 'all' || c.va_id === who)
  const nowH = Math.floor(NOW / 60)
  return (
    <section className="fx-tile adm-cal adm-today" style={{ '--i': 0 }} aria-label="Today's booked calls">
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>Today's booked calls</h2><p>{dayName(TODAY)}, Nov {TODAY} · {shown.length} {shown.length === 1 ? 'call' : 'calls'}{who === 'all' ? '' : ` for ${vas.find(v => v.id === who)?.name.split(' ')[0]}`}</p></span>
      </header>
      <VaFilter vas={vas} who={who} setWho={setWho} />
      <ol className="adm-today-cal">{HOURS_ADM.map(h => {
        const inHour = shown.filter(c => Math.floor(minutesOf(c.time) / 60) === h)
        return (
          <li key={h}>
            <span className="adm-tc-t">{hourLabel(h)}</span>
            <div className={`adm-tc-row${h === nowH ? ' is-now' : ''}`}>
              {inHour.map(c => {
                const their = theirTime(c.time, c.state)
                return (
                  <button key={c.id} type="button" className={`adm-vachip adm-tc-call is-${vaHue(vas, c.va_id)}${['cancelled', 'no_answer'].includes(c.status) ? ' is-done' : ''}${c.status === 'late' ? ' is-late' : ''}`}
                    aria-label={`${c.time}${their ? ` (${their} for the client)` : ''}, ${c.client}, ${c.va}, ${CALL_WORD[c.status]}`} onClick={() => openCall(c.id)}>
                    <i aria-hidden="true" /><b className="tp-num">{c.time}</b>{c.client}<small>{c.va.split(' ')[0]} · {CALL_WORD[c.status]}</small>
                  </button>
                )
              })}
            </div>
          </li>
        )
      })}</ol>
      {calls.length === 0 && <Empty title="No calls today" sub="Nothing is booked for the team today." />}
    </section>
  )
}

// P867 — the rota as a grid, like the VA side (P846/P851): VA names down the left, the days across the top, a mark
// where that VA works (their hours on hover, and in the cell's menu on a tap). Off days are empty, a day-off request
// shows "Off" (P945: booked by the VA, no asked state). Tap an empty cell to put the VA on that day; tap a mark to see the hours
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
    if (cell.kind === 'on') { setMenu(m => (m === `${v.id}|${d}` ? null : `${v.id}|${d}`)); return }
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
                  const isOn = cell.kind === 'on'
                  const word = cell.kind === 'off' ? 'Off' : isOn ? 'On' : ''
                  const title = cell.kind === 'off' ? `${v.name} · ${dt(d)} off${cell.reason ? `: ${cell.reason}` : ''}` : isOn ? `${v.name} · ${hoursOf(v)}` : `Put ${first(v)} on ${dt(d)}`
                  return (
                    <td key={d} className={`adm-rt-cell${d === TODAY_R ? ' is-today' : ''}${d < TODAY_R ? ' is-past' : ''}`}>
                      <button type="button" className={`adm-rt-b is-${cell.kind || 'empty'}`} title={title} aria-label={title} aria-expanded={isOn ? menu === key : undefined} onClick={() => tap(v, d, cell)}>
                        {word ? <span className="adm-rt-mark">{word}</span> : <Plus size={13} aria-hidden="true" className="adm-rt-add" />}
                        {isOn && <small className="adm-rt-hrs">{hoursOf(v).replace(/:00/g, '').replace(' to ', '–')}</small>}
                      </button>
                      {menu === key && (
                        <div className="adm-rt-menu" role="dialog" aria-label={`${v.name}, ${dt(d)}`}>
                          <b>{v.name}</b><small>{dt(d)} · {hoursOf(v)}</small>
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
        <li><span className="adm-rt-mark is-off">Off</span>Day off (booked by the VA, no approval)</li>
      </ul>
    </section>
  )
}

// P913 — time off without approvals: each VA gets a set number of days off a month (an admin setting). They book
// their own days; once they've used them up they can't book more (src/lib/dayOff.js). No approve or decline here.
function TimeOff() {
  const data = useAdmShifts()
  const { data: settings } = useAdmSettings()
  const { saveSettings } = useAdmActions()
  const note = useNote()
  const allowance = settings.daysOffPerMonth ?? DAYS_OFF_DEFAULT
  const [n, setN] = useState(String(allowance))
  const booked = data.dayOff.filter(d => d.status !== 'declined')
  const team = data.team || []
  const save = () => {
    const v = Number(n)
    if (!Number.isInteger(v) || v < 0 || v > 15) { note('Pick 0 to 15 days a month'); return }
    saveSettings?.({ daysOffPerMonth: v })
    note(`Each VA gets ${v} ${v === 1 ? 'day' : 'days'} off a month`)
  }
  return (
    <div className="adm-two">
      <Tile i={0} title="Days off each month" sub="VAs book their own days. When they've used them up, they can't book more.">
        <div className="adm-allow">
          <DField label="Days off a month, per VA"><input className="tp-input" inputMode="numeric" value={n} onChange={e => setN(e.target.value.replace(/\D/g, ''))} aria-label="Days off a month, per VA" /></DField>
          <button type="button" className="tp-primary sm fx-accent" disabled={Number(n) === allowance} onClick={save}><Check size={14} />Save</button>
        </div>
        <ul className="tp-list">{team.map(v => {
          const used = daysUsed(booked, v.id)
          const left = daysLeft(booked, v.id, allowance)
          return <li key={v.id} className="fx-mrow adm-off-row"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small className="adm-off-left">{used} of {allowance} used this month</small></span><Chip tone={left ? 'green' : 'mute'}>{left ? `${left} left` : 'All used'}</Chip></li>
        })}</ul>
      </Tile>
      <Tile i={1} title="Booked days off" sub={booked.length ? `${booked.length} this month` : 'None booked'}>
        <ul className="tp-list">{booked.map(r => <li key={r.id} className="fx-mrow"><Avatar name={r.va} /><span className="tp-grow"><b>{r.va}</b><small>{data.dateText(r.date)}{r.reason ? ` · ${r.reason}` : ''} · booked {r.asked}</small></span><Chip tone="blue">Off</Chip></li>)}
          {booked.length === 0 && <li className="fx-calm"><Check size={16} aria-hidden="true" />Nobody is off this month.</li>}</ul>
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

// P913: Today (today's booked calls) · Calendar (the week) · Rota · Time off (an allowance, no approvals) · Hours & pay.
// Live desk, Quality and Records are gone. Pay is hourly on scheduled hours minus days off (Q76, P945).
const TABS = [['today', 'Today'], ['calendar', 'Calendar'], ['rota', 'Rota'], ['requests', 'Time off'], ['pay', 'Hours & pay']]
export default function Team() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab = TABS.some(t => t[0] === sp.get('tab')) ? sp.get('tab') : 'today'
  const call = sp.get('call')
  const setTab = t => setSp(t === 'today' ? {} : { tab: t }, { replace: true })
  const openCall = c => setSp(p => { const n = new URLSearchParams(p); n.set('call', c); return n }, { replace: true })
  return (
    <div className="tp-page fx-page adm-team">
      <PillTabs label="Fulfillment team" className="fx-ptabs adm-pagetabs" itemClass="fx-ptab" value={tab} onChange={setTab}
        items={TABS.map(([k, label]) => ({ key: k, label }))} />
      <div className="adm-tabpane" key={tab} role="tabpanel">
        {tab === 'today' && <TodayCalls openCall={openCall} />}
        {tab === 'calendar' && <TeamCalendar />}
        {tab === 'rota' && <><Rota /><Holidays /></>}
        {tab === 'requests' && <><TimeOff /><SwapsAndOpen /></>}
        {tab === 'pay' && <HoursPay />}
      </div>
      {call && <CallDrawer id={call} onClose={() => setSp(p => { const n = new URLSearchParams(p); n.delete('call'); return n }, { replace: true })} />}
      {id && <VaDrawer id={id} onClose={() => navigate(ap('team'))} />}
    </div>
  )
}
