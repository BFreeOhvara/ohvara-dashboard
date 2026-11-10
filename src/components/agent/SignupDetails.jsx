import { Check, MapPin, Clock, PhoneIncoming, Phone } from 'lucide-react'
import { Switch } from '../ui/Switch'
import { OvField, OvSelect } from './AgentUI'
import { WEEKDAYS, setDay, timeOptions } from '../../lib/agentSettings'
import { SELECTABLE_TIMEZONES } from '../../lib/timezones'
import { STATE_CHOICES, MIN_STATES, MAX_STATES, NOT_TAKING, LICENSED_WORDS, toggleState } from '../../lib/signupDetails'

// P941 — the sign-up's details, filled in before paying for a lead plan: licensed states + the tick, time zone and
// hours, live transfers yes/no. Controlled: `value` is src/lib/signupDetails.js's shape, `onChange` gets the next one.
// One set of hours (P924): booked calls land and live calls ring inside them.

const ZONES = SELECTABLE_TIMEZONES.map(z => ({ value: z.value, label: z.label }))

export function SignupDetails({ value: d, onChange, notTaking = NOT_TAKING, missing = [] }) {
  const n = d.states.length
  const inRange = n >= MIN_STATES && n <= MAX_STATES
  const miss = key => missing.some(m => m.key === key)
  const set = patch => onChange({ ...d, ...patch })
  return (
    <div className="sc-det" data-testid="sc-details">
      <section className={`ov-card sc-dcard${miss('states') || miss('licence') ? ' is-open' : ''}`} aria-labelledby="sc-st-h">
        <header className="sc-dh">
          <span className="sc-dtile"><MapPin size={17} aria-hidden="true" /></span>
          <span className="sc-dh-t"><b id="sc-st-h">Your licensed states</b><small>Pick 3 to 10. Your leads only come from these states.</small></span>
          <span className={`sc-count${inRange ? ' is-ok' : ''}`} data-testid="sc-state-count">{n} of 3–10</span>
        </header>
        <div className="sc-states" role="group" aria-label="Licensed states">
          {STATE_CHOICES.map(s => {
            const no = notTaking.includes(s.code)
            const on = d.states.includes(s.code)
            const full = !on && n >= MAX_STATES
            return (
              <button key={s.code} type="button" className={`sc-st${on ? ' is-on' : ''}`} aria-pressed={on} disabled={no || full}
                title={no ? `Not taking ${s.name} yet` : s.name} aria-label={no ? `${s.name}, not taking yet` : s.name}
                onClick={() => onChange(toggleState(d, s.code, notTaking))}>{s.code}</button>
            )
          })}
        </div>
        <label className={`sc-tick${inRange ? '' : ' is-off'}`}>
          <input type="checkbox" checked={d.licensed} disabled={!inRange} onChange={e => set({ licensed: e.target.checked })} data-testid="sc-licensed" />
          <span>{LICENSED_WORDS}</span>
        </label>
        {notTaking.length > 0 && <p className="sc-sub">We aren’t taking New York yet.</p>}
      </section>

      <section className={`ov-card sc-dcard${miss('timezone') || miss('hours') ? ' is-open' : ''}`} aria-labelledby="sc-hr-h">
        <header className="sc-dh">
          <span className="sc-dtile"><Clock size={17} aria-hidden="true" /></span>
          <span className="sc-dh-t"><b id="sc-hr-h">Your hours</b><small>One set of hours in your time zone: booked calls land and live calls ring inside them.</small></span>
        </header>
        <div className="sc-tz">
          <span className="sc-lbl" id="sc-tz-l">Time zone</span>
          <OvSelect value={d.timezone} onChange={v => set({ timezone: v })} options={ZONES} placeholder="Pick your time zone" aria-labelledby="sc-tz-l" error={miss('timezone')} />
        </div>
        <div className="sc-week">
          {WEEKDAYS.map((w, i) => {
            const day = d.week[i]
            return (
              <div key={w.weekday} className={`sc-day${day.open ? '' : ' is-closed'}`}>
                <b>{w.short}</b>
                <Switch checked={day.open} onChange={on => set({ week: setDay(d.week, w.weekday, { open: on }) })} label={`${w.long}: open`} />
                {day.open ? <>
                  <OvSelect value={day.start} onChange={v => set({ week: setDay(d.week, w.weekday, { start: v }) })} options={timeOptions('start', day.start)} aria-label={`${w.long} start time`} />
                  <span className="sc-to">to</span>
                  <OvSelect value={day.end} onChange={v => set({ week: setDay(d.week, w.weekday, { end: v }) })} options={timeOptions('end', day.end)} aria-label={`${w.long} end time`} />
                </> : <span className="sc-closed">Closed</span>}
              </div>
            )
          })}
        </div>
      </section>

      <section className={`ov-card sc-dcard${miss('live') || miss('phone') ? ' is-open' : ''}`} aria-labelledby="sc-lv-h">
        <header className="sc-dh">
          <span className="sc-dtile"><PhoneIncoming size={17} aria-hidden="true" /></span>
          <span className="sc-dh-t"><b id="sc-lv-h">Live transfers</b><small>Every lead gets a call in seconds. Ready now? It can ring straight to your phone. If not, it’s booked on your calendar.</small></span>
        </header>
        <div className="sc-live" role="radiogroup" aria-labelledby="sc-lv-h">
          {[[true, 'Yes, ring my phone', 'Appointments and live transfers'], [false, 'No, appointments only', 'Every lead is booked on your calendar']].map(([v, t, sub]) => (
            <label key={String(v)} className={`sc-opt${d.live === v ? ' is-on' : ''}`}>
              <input type="radio" name="sc-live" className="sr-only" checked={d.live === v} onChange={() => set({ live: v })} data-testid={v ? 'sc-live-yes' : 'sc-live-no'} />
              <span className="sc-rad" aria-hidden="true">{d.live === v && <Check size={12} strokeWidth={3} />}</span>
              <span><b>{t}</b><small>{sub}</small></span>
            </label>
          ))}
        </div>
        {d.live && (
          <OvField label="The phone live transfers ring" icon={Phone} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 010-0142"
            value={d.phone} onChange={e => set({ phone: e.target.value })} error={miss('phone')} data-testid="sc-phone" />
        )}
      </section>
    </div>
  )
}
