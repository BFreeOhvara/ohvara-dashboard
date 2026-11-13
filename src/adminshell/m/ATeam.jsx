import { useState } from 'react'
import { ChevronRight, MessageCircle, Pencil } from 'lucide-react'
import { useAdmVas, useAdmDesk, useAdmRota, useAdmDay, useAdmActions, WEEK, NEXT_WEEK, dayName, SHIFT_MIN, SHIFT_MAX } from '../data'
import { useTraining } from '../../fulshell/training/store'
import { useNote } from '../../template/kit'
import { useApp, SubPage, BottomSheet, Ini, CallButton, rise } from '../../template/m/AppKit'
import { firstName } from '../../template/m/va/vaModel'
import { money, callSplit, callTag, CALL_GROUP, GROUP_ORDER, GROUP_TAG, GROUP_TONE } from './admModel'
import { useMessageTo } from './useAdm'

// P986 — Team: today's desk calls as one bar split by result (Done / No answer / Needs a result / To call) with the
// on-hold line; the VAs on shift now (status dot, progress bar, calls done, saves); this week's rota with Edit rota;
// training (who's fully trained, who's mid-way). A VA opens from the right: today's calls, hours this pay period,
// earned so far, lessons done, today's calls with results, Message and Call.
export default function ATeam() {
  const app = useApp()
  const { data: vas } = useAdmVas()
  const { data: desk } = useAdmDesk()
  const { data: rota } = useAdmRota()
  const { data: day } = useAdmDay()
  const [edit, setEdit] = useState(false)
  const sp = callSplit(desk)
  const on = vas.filter(v => v.onShift)
  const days = day.byDay // this week, Mon to Sun (the clock's week on real data)
  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Team</h1><small>{vas.length} VAs · {on.length} on shift now</small></span></div>

      <section className="ma-glass ma-pad am-calls ma-rise" style={rise(0)} aria-label="Today's calls">
        <div className="am-calls-h"><b>Today’s calls</b><span>{sp.done} of {sp.total} done</span></div>
        <div className="am-split" role="img" aria-label={GROUP_ORDER.map(k => `${sp.counts[k]} ${GROUP_TAG[k]}`).join(', ')}>
          {GROUP_ORDER.filter(k => sp.counts[k]).map(k => <i key={k} className={`is-${GROUP_TONE[k]}`} style={{ flexGrow: sp.counts[k] }} />)}
          {!sp.total && <i className="is-stone" style={{ flexGrow: 1 }} />}
        </div>
        <div className="am-legend">
          {GROUP_ORDER.map(k => <span key={k}><i className={`is-${GROUP_TONE[k]}`} aria-hidden="true" />{GROUP_TAG[k]} <b>{sp.counts[k]}</b></span>)}
        </div>
        <small className="am-hold">No clients on hold right now</small>
      </section>

      <div className="ma-h2 ma-rise" style={rise(1)}><h2>On shift now</h2><span>{on.length}</span></div>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {on.map(v => {
          const pct = v.today.total ? Math.round((v.today.done / v.today.total) * 100) : 0
          return (
            <button key={v.id} type="button" className="ma-row am-varow" onClick={() => app.openSub('va', { t: v.id })}>
              <span className="am-avdot"><Ini name={v.name} tone="sage" size={44} /><i className={v.onCall ? 'is-call' : v.today.late ? 'is-late' : 'is-on'} aria-hidden="true" /></span>
              <span className="ma-grow">
                <b>{v.name}</b>
                <small>{v.onCall ? 'On a call' : v.today.late ? `${v.today.late} late` : 'On shift'} · {v.today.done} of {v.today.total} calls · 0 saves</small>
                <span className="va-bar am-vabar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
              </span>
              <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
            </button>
          )
        })}
        {!on.length && <p className="ma-empty">Nobody is on shift right now. Shifts are 8 AM to 6 PM Central.</p>}
      </div>

      <div className="ma-h2 ma-rise" style={rise(2)}><h2>This week</h2><button type="button" className="ma-textbtn" onClick={() => setEdit(true)}><Pencil size={15} aria-hidden="true" />Edit rota</button></div>
      <div className="ma-glass am-rota ma-rise" style={rise(2)}>
        {days.map(({ day: d, name }) => (
          <div key={d} className={`am-rday${d === day.today ? ' is-today' : ''}${d < day.today ? ' is-past' : ''}`}>
            <small>{name}</small><b>{d}</b>
            <span className="am-rppl">{(rota.rota[d] || []).map(id => { const v = vas.find(x => x.id === id); return v ? <Ini key={id} name={v.name} tone="sage" size={26} /> : null })}</span>
          </div>
        ))}
        {!days.length && <p className="ma-empty">The rota is on the desktop’s Team page.</p>}
      </div>

      <div className="ma-h2 ma-rise" style={rise(3)}><h2>Training</h2></div>
      <div className="ma-glass ma-list ma-rise" style={rise(3)}>
        {vas.map(v => <TrainRow key={v.id} v={v} />)}
      </div>
      <RotaSheet open={edit} onClose={() => setEdit(false)} />
    </div>
  )
}

function TrainRow({ v }) {
  const app = useApp()
  const { sum } = useTraining(v.name)
  const done = sum.complete
  return (
    <button type="button" className="ma-row" onClick={() => app.openSub('va', { t: v.id })}>
      <span className={`ma-sym is-${done ? 'sage' : 'butter'}`} aria-hidden="true">{done ? '✓' : '…'}</span>
      <span className="ma-grow"><b>{v.name}</b><small>{done ? 'Fully trained' : `Mid-way · ${sum.passed} of ${sum.total} lessons`}</small></span>
      <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
    </button>
  )
}

// Edit rota: pick a day (this week or next), then tap VAs on or off (2 to 3 a day, the desktop's rule).
function RotaSheet({ open, onClose }) {
  const { data: vas } = useAdmVas()
  const { data: rota } = useAdmRota()
  const { data: day } = useAdmDay()
  const { addShift, removeShift } = useAdmActions()
  const note = useNote()
  const all = [...WEEK, ...NEXT_WEEK].filter(d => d >= day.today)
  const [d, setD] = useState(null)
  const pick = d ?? all[0]
  const on = rota.rota[pick] || []
  const off = id => rota.dayOff.some(x => x.va_id === id && x.date === pick && x.status === 'approved')
  const flip = v => {
    if (on.includes(v.id)) {
      if (on.length <= SHIFT_MIN) { note(`Keep at least ${SHIFT_MIN} on shift`); return }
      removeShift(pick, v.id); note(`${firstName(v.name)} is off the rota on Nov ${pick}`)
    } else {
      if (on.length >= SHIFT_MAX) { note(`At most ${SHIFT_MAX} on shift a day`); return }
      addShift(pick, v.id); note(`${firstName(v.name)} is on shift Nov ${pick}`)
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} label="Edit rota" tall>
      <p className="ma-sheet-t">Edit rota</p>
      <p className="ma-sheet-s">Pick a day, then tap who’s on. {SHIFT_MIN} to {SHIFT_MAX} a day, 8 AM to 6 PM Central.</p>
      <div className="ma-chips am-daychips">
        {all.map(x => <button key={x} type="button" className={`ma-fchip${x === pick ? ' is-on' : ''}`} aria-pressed={x === pick} onClick={() => setD(x)}>{dayName(x)} {x}</button>)}
      </div>
      <div className="am-sheetlist">
        {vas.map(v => (
          <button key={v.id} type="button" className={`ma-pick${on.includes(v.id) ? ' is-on' : ''}`} aria-pressed={on.includes(v.id)} onClick={() => flip(v)} disabled={off(v.id)}>
            <Ini name={v.name} tone="sage" size={40} />
            <span className="ma-grow"><b>{v.name}</b><small>{off(v.id) ? 'Day off booked' : on.includes(v.id) ? 'On shift' : 'Off'}</small></span>
            <span className={`am-tick${on.includes(v.id) ? ' is-on' : ''}`} aria-hidden="true">{on.includes(v.id) ? '✓' : ''}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}

export function AVa({ id }) {
  const { data: vas } = useAdmVas()
  const { data: desk } = useAdmDesk()
  const msg = useMessageTo()
  const v = vas.find(x => x.id === id)
  const { sum } = useTraining(v?.name || '')
  if (!v) return <SubPage title="VA"><p className="ma-empty">This VA isn’t here any more.</p></SubPage>
  const calls = desk.filter(c => c.va_id === v.id)
  const foot = (
    <div className="ma-two am-foot2">
      <button type="button" className="ma-btn is-soft is-tall ma-press" onClick={() => msg(v, 'VA')}><MessageCircle size={18} aria-hidden="true" />Message</button>
      <CallButton phone={v.phone} className="ma-btn is-solid is-tall" label="Call" />
    </div>
  )
  return (
    <SubPage title={v.name} line={`VA · ${v.onCall ? 'on a call' : v.onShift ? 'on shift' : 'off today'} · since ${v.joined}`} foot={foot} big>
      <div className="am-stats ma-rise">
        <div><b>{v.today.done} of {v.today.total}</b><small>Calls today</small></div>
        <div><b>{Math.round(v.week.hours * 10) / 10} h</b><small>Hours this pay period</small></div>
        <div><b className="tp-money">{money(v.week.pay)}</b><small>Earned so far</small></div>
        <div><b>{sum.passed} of {sum.total}</b><small>Lessons done</small></div>
      </div>
      <p className="ma-cap is-out">Today’s calls</p>
      <div className="ma-glass ma-list ma-rise" style={rise(1)}>
        {calls.map(c => {
          const g = CALL_GROUP[c.status] || 'todo'
          return (
            <div key={c.id} className="ma-row">
              <span className="ma-time">{c.time}</span>
              <span className={`ma-dot is-${GROUP_TONE[g]}`} aria-hidden="true" />
              <span className="ma-grow"><b>{c.client}</b><small>{callTag(c)} · {c.old_carrier} · for {c.agent}</small></span>
            </div>
          )
        })}
        {!calls.length && <p className="ma-empty">No calls for {firstName(v.name)} today.</p>}
      </div>
    </SubPage>
  )
}
