import { useMemo } from 'react'
import { Bell, Search, Phone, PhoneIncoming, ChevronRight } from 'lucide-react'
import { useFulDay, useFulSchedule, useFulShift } from '../../ful/data'
import { whyShort } from '../../ful/callSteps'
import { useAccount } from '../../kit'
import { useApp, Ini, rise } from '../AppKit'
import { useVaCall } from './vaStore'
import { useVaNow, dayOfItem } from './useVaNow'
import { stateOf, forLine, greetingOf, firstName, onShiftWords, withYou, STATE_TONE } from './vaModel'

// P975 — Today: the bell (Notifications from the left), the wordmark, search. The greeting; the shift card (on shift,
// the hours, X of Y done with a bar, who else is on); clients waiting on the line (tap to take the next one); the next
// call with Start call and its brief; calls left without a result; later today and All of today; the day's numbers.
const carrierOf = it => it?.row?.old_carrier || it?.row?.carrier || it?.row?.client?.carrier_name || ''

export default function VToday() {
  const app = useApp()
  const account = useAccount()
  const vc = useVaCall()
  const { data: day } = useFulDay()
  const { data: all } = useFulSchedule()
  const { data: shift } = useFulShift()
  const { nowMs, tz, todayIso, nowMin } = useVaNow()
  const today = useMemo(() => all.filter(i => dayOfItem(i, tz) === todayIso), [all, tz, todayIso])
  const needs = useMemo(() => all.filter(i => stateOf(i, nowMs) === 'open'), [all, nowMs])
  const next = day.next && !needs.some(n => n.ref === day.next.ref) ? day.next : today.find(i => stateOf(i, nowMs) === 'todo') || null
  const later = today.filter(i => stateOf(i, nowMs) === 'todo' && i.ref !== next?.ref).slice(0, 3)
  const done = today.filter(i => i.done).length
  const saved = today.filter(i => i.done && i.row?.outcome === 'saved').length
  const pct = today.length ? Math.round((done / today.length) * 100) : 0
  const dateLine = new Date(nowMs).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })
  const off = (shift.dayOffs || []).some(o => o.date === todayIso)
  const onShift = !shift.notSet && shift.onToday && !off

  return (
    <div className="ma-tabpage">
      <div className="ma-home-h ma-rise">
        <button type="button" className="ma-ib ma-press" aria-label={`Notifications${app.unseen ? `, ${app.unseen} new` : ''}`} onClick={() => app.openSub('notif')}>
          <Bell size={25} strokeWidth={1.9} aria-hidden="true" />{app.unseen > 0 && <span className="ma-badge is-bell">{app.unseen}</span>}
        </button>
        <span className="ma-wordmark" aria-hidden="true">ohvara</span>
        <span className="va-home-r">
          <button type="button" className="ma-ib ma-press" aria-label={vc.call && !vc.call.end ? 'Back to the call' : 'Phone'} onClick={vc.openPhone}><Phone size={24} strokeWidth={1.9} aria-hidden="true" /></button>
          <button type="button" className="ma-ib ma-press" aria-label="Search clients" onClick={() => app.openSub('search')}><Search size={25} strokeWidth={1.9} aria-hidden="true" /></button>
        </span>
      </div>

      <div className="ma-hello ma-rise" style={rise(0)}>
        <span>{dateLine}</span>
        <h1>{greetingOf(nowMin)}, {firstName(account?.name) || 'there'}</h1>
      </div>

      <section className="va-shift is-sage ma-rise" style={rise(1)} aria-label="Your shift">
        <div className="va-shift-top">
          <b><i className={onShift ? 'is-live' : ''} aria-hidden="true" />{shift.notSet ? 'Schedule not set up yet' : onShift ? `On shift · ${(shift.shift?.text || '8:00 AM to 6:00 PM').replace(/:00/g, '')}` : 'Off today'}</b>
          <span>{done} of {today.length} done</span>
        </div>
        <div className="va-bar" role="progressbar" aria-label="Calls done today" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        <small>{shift.notSet ? 'Shifts are 8 AM to 6 PM Central' : withYou(shift.mates || [])}</small>
      </section>

      {vc.holdLine && (
        <button type="button" className="va-hold is-apricot ma-press ma-rise" style={rise(2)} onClick={vc.takeHold}>
          <span className="va-hold-ic" aria-hidden="true"><PhoneIncoming size={21} /></span>
          <span className="ma-grow"><b>{vc.holdLine}</b><small>The AI told them the wait · tap to take the next one</small></span>
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      )}

      <article className="ma-next va-next ma-rise" style={rise(3)} aria-label="Next call">
        <i className="ma-glow" aria-hidden="true" />
        {next ? <>
          <div className="ma-next-top">
            <span className="ma-grow ma-next-who">
              <span className="ma-next-k"><i aria-hidden="true" />Next · {next.time}</span>
              <b>{next.name}</b>
              <span className="ma-next-when">{whyShort(next)}</span>
              <small className="va-next-ag">Agent: {next.agent}{carrierOf(next) ? ` · ${carrierOf(next)}` : ''}</small>
            </span>
            <Ini name={next.name} size={52} className="ma-next-av" />
          </div>
          <div className="ma-next-btns">
            <button type="button" className="ma-btn is-white is-grow is-tall ma-press" onClick={() => vc.start(next)}><Phone size={18} aria-hidden="true" />Start call</button>
            <button type="button" className="ma-round is-big is-glass ma-press" aria-label="Call brief" onClick={() => vc.openBrief(next)}><ChevronRight size={20} aria-hidden="true" /></button>
          </div>
        </> : <>
          <span className="ma-next-k"><i aria-hidden="true" />Next call</span>
          <b className="ma-next-none">Nothing else booked today</b>
          <span className="ma-next-when">Calls that come in ring here.</span>
        </>}
      </article>

      {needs.length > 0 && (
        <div className="ma-needs ma-rise" style={rise(4)}>
          <div className="ma-h2"><h2>Needs a result</h2><span>You can't close these without one</span></div>
          {needs.map(i => (
            <button key={i.ref} type="button" className="va-need is-apricot ma-row" onClick={() => vc.needResult(i)}>
              <Ini name={i.name} size={42} />
              <span className="ma-grow"><b>{i.name}</b><small>{i.time} · {forLine(whyShort(i), i.agent)}</small></span>
              <span className="va-need-go">Pick result</span>
            </button>
          ))}
        </div>
      )}

      <div className="ma-glass ma-later ma-rise" style={rise(5)}>
        <p className="ma-cap">Later today</p>
        {later.map(i => (
          <button key={i.ref} type="button" className="ma-trow ma-row va-trow" onClick={() => vc.openBrief(i)}>
            <span className="ma-time">{i.time}</span>
            <span className={`ma-dot is-${STATE_TONE.todo}`} aria-hidden="true" />
            <span className="ma-grow"><b>{i.name}</b><small>{forLine(whyShort(i), i.agent)}</small></span>
            <ChevronRight size={18} className="ma-chev" aria-hidden="true" />
          </button>
        ))}
        {!later.length && <p className="ma-hint">Nothing else after the next call.</p>}
        <button type="button" className="ma-all" onClick={() => app.goTab('calendar', { openDay: todayIso })}>All of today<ChevronRight size={16} aria-hidden="true" /></button>
      </div>

      <div className="ma-week ma-rise" style={rise(6)} aria-label="Today in numbers">
        <div><b className="is-good">{done}</b><small>calls done</small></div>
        <div><b>{saved}</b><small>policies saved</small></div>
        <div><b>{onShift ? onShiftWords(nowMin) : '0h 00m'}</b><small>on shift</small></div>
      </div>
    </div>
  )
}
