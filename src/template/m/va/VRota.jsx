import { useState } from 'react'
import { Repeat } from 'lucide-react'
import { useFulShift, useFulSource, useFulSettings } from '../../ful/data'
import { shiftWords } from '../zoneTime'
import { DayOffDrawer } from '../../ful/Shift'
import { useTimeOff } from '../../ful/useTimeOff'
import { MY_SWAPS } from '../../ful/p879'
import { useNote } from '../../kit'
import { BottomSheet, Ini, rise } from '../AppKit'
import { useVaNow } from './useVaNow'
import { weekCards, firstName } from './vaModel'

// P975 — Rota (P977: shown as "Schedule"): who is on shift, This week / Next week. A card per day (you first and highlighted, today ringed,
// the weekend and your days off marked). Ask for a day off is the desk's own flow and rules (DayOffDrawer: the monthly
// allowance, booked at once while days are left, the team covers). Swap a shift asks a teammate; an admin confirms
// every change (sample until the swaps backend, P879's list).
const WEEK = ['This week', 'Next week']
const TONES = ['sky', 'butter', 'apricot', 'stone']

export default function VRota() {
  const { data: s } = useFulShift()
  const { data: me } = useFulSettings()
  const real = useFulSource() === 'real'
  const off = useTimeOff()
  const note = useNote()
  const { todayIso } = useVaNow()
  const [week, setWeek] = useState(0)
  const [panel, setPanel] = useState(null)
  const [swaps, setSwaps] = useState(() => (real ? [] : MY_SWAPS.map(x => ({ ...x }))))
  const cards = s.notSet ? [] : weekCards(s.days?.[week] || [], todayIso)
  const tone = id => TONES[Math.abs([...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0)) % TONES.length]

  return (
    <div className="ma-tabpage">
      <div className="ma-top ma-rise"><span className="ma-grow"><h1>Schedule</h1><small>Who is on shift · {shiftWords(s.shift?.text, me.timeZone)}</small></span></div>

      <div className="va-weeks ma-rise" role="tablist" aria-label="Week" style={rise(0)}>
        {WEEK.map((w, i) => <button key={w} type="button" role="tab" aria-selected={week === i} className={`va-week ma-press${week === i ? ' is-on' : ''}`} onClick={() => setWeek(i)}>{w}</button>)}
      </div>

      {s.notSet
        ? <p className="ma-empty is-glass ma-rise" style={rise(1)}>Your schedule isn’t set up yet. Your shifts and who is on with you show here once the team builds it.</p>
        : (
          <div className="va-rota" key={week}>
            {cards.map((d, i) => (
              <div key={d.date} className={`va-rday ma-rise${d.today ? ' is-today' : ''}${d.past ? ' is-past' : ''}`} style={rise(1 + i * 0.4)}>
                <span className="va-rday-d"><small>{d.dow}</small><b>{d.num}</b></span>
                <span className="va-rday-p">
                  {d.weekend
                    ? <span className="va-chip is-butter">No shifts · weekend</span>
                    : d.people.map(v => (
                      <span key={v.id} className={`va-chip ${v.me ? 'is-me' : `is-${tone(v.id)}`}`}><Ini name={v.name} size={24} />{v.me ? 'You' : firstName(v.name)}</span>
                    ))}
                </span>
                {!d.weekend && d.youOff && <small className="va-youoff">{d.offAsked ? 'Your day off' : "You're off"}</small>}
              </div>
            ))}
          </div>
        )}

      {swaps.length > 0 && (
        <div className="ma-glass ma-list va-swaps ma-rise">
          {swaps.map(x => <div key={x.id} className="ma-row"><span className="ma-sym is-sky"><Repeat size={16} aria-hidden="true" /></span><span className="ma-grow"><b>Swap {x.day} with {firstName(x.with)}</b><small>Asked · {x.status}</small></span></div>)}
        </div>
      )}

      <div className="ma-two ma-rise">
        <button type="button" className="ma-btn is-solid ma-press" disabled={s.notSet} onClick={() => setPanel('off')}>Ask for a day off</button>
        <button type="button" className="ma-btn is-soft ma-press" disabled={s.notSet} onClick={() => setPanel('swap')}>Swap a shift</button>
      </div>
      <p className="ma-note">{off.allowance} days off a month{off.notSet ? '' : ` · ${off.left} left`}. Ask ahead so the team can cover.</p>

      <DayOffDrawer open={panel === 'off'} onClose={() => setPanel(null)} />
      <SwapSheet open={panel === 'swap'} onClose={() => setPanel(null)} shift={s} real={real}
        onAsk={(d, v) => { setSwaps(l => [...l, { id: `sw-${Date.now()}`, day: d.label, with: v.name, status: `waiting on ${firstName(v.name)}` }]); note(`Asked ${firstName(v.name)} to take ${d.label}. An admin confirms it.`) }} />
    </div>
  )
}

// Swap a shift: one of your shifts after today, and who takes it (anyone on the team not already on that day).
function SwapSheet({ open, onClose, shift, onAsk, real }) {
  const [day, setDay] = useState(null)
  const [who, setWho] = useState(null)
  const mine = (shift.askable || []).map(d => ({ ...d, label: `${d.name} ${Number(String(d.date).slice(8))}` }))
  const pickDay = mine.find(d => d.day === day) || mine[0] || null
  const team = pickDay ? Array.from(new Map((shift.days || []).flat().flatMap(d => d.vas).filter(v => !v.me).map(v => [v.id, v])).values()).filter(v => !(shift.days || []).flat().find(d => d.date === pickDay.date)?.vas.some(x => x.id === v.id)) : []
  const pickWho = team.find(v => v.id === who) || null
  return (
    <BottomSheet open={open} onClose={onClose} label="Swap a shift">
      <p className="ma-sheet-t">Swap a shift</p>
      <p className="ma-sheet-s">Pick your shift and who takes it. They say yes, then Ohvara confirms.</p>
      {!mine.length && <p className="ma-empty is-box">No shifts of yours to swap in the next two weeks.</p>}
      {mine.length > 0 && <>
        <p className="ma-cap">Your shift</p>
        <div className="va-chips">{mine.map(d => <button key={d.day} type="button" className={`ma-chip va-tap ma-press${pickDay?.day === d.day ? ' is-solid' : ''}`} onClick={() => { setDay(d.day); setWho(null) }}>{d.label}</button>)}</div>
        <p className="ma-cap is-out">Who takes it</p>
        <div className="va-chips">{team.length ? team.map(v => <button key={v.id} type="button" className={`ma-chip va-tap ma-press${pickWho?.id === v.id ? ' is-solid' : ''}`} onClick={() => setWho(v.id)}>{firstName(v.name)}</button>) : <p className="ma-hint">Everyone else is already on that day.</p>}</div>
        <button type="button" className="ma-btn is-solid is-tall va-wide ma-press" disabled={!pickWho || real} onClick={() => { onAsk(pickDay, pickWho); setWho(null); onClose() }}>{real ? 'Swaps open soon' : 'Ask for the swap'}</button>
      </>}
    </BottomSheet>
  )
}
