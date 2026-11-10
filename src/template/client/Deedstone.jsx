import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Check, CalendarPlus, PhoneCall, BellOff } from 'lucide-react'
import { useSampleSettings } from '../data'
import { Field } from '../kit'
import { Select } from '../Select'
import { agentSlots, clockMin, clocksBetween, zoneAbbr, ZONE_CHOICES } from '../../lib/callSlots'
import '../p878.css'

// P878 — what a lead sees (N-C-34, N-C-42, N-C-45, N-B-56, N-H-28): Deedstone pages only, never Ohvara. A self-booking
// page (the link a follow-up or a form lead gets), the rebook page (no-show or the agent can't make it), the callback
// page (after hours), and opt-out. Times show in the lead's own zone; slots are 30 minutes inside the agent's hours.
// Sample only: nothing is booked or sent. Consent and privacy wording stays a placeholder.
const DAYS = [['2026-11-06', 'Fri', 'Fri, Nov 6'], ['2026-11-09', 'Mon', 'Mon, Nov 9'], ['2026-11-10', 'Tue', 'Tue, Nov 10'], ['2026-11-11', 'Wed', 'Wed, Nov 11']]
const ZONES = ZONE_CHOICES.map(z => ({ value: z.value, label: `${z.label} (${zoneAbbr(z.value)})` }))
const CLIENT_CLOCKS = clocksBetween(7 * 60, 21 * 60 + 30)
const TEAM_HOURS = { open: 9 * 60, close: 19 * 60 } // callbacks: the team calls 9 AM to 7 PM in the lead's own zone

const PAGES = {
  book: { title: first => `Hi ${first}, pick a time for your call`, sub: agent => `A 30-minute phone call with ${agent}. Free, and no obligation.`, done: 'You’re booked' },
  rebook: { title: first => `Sorry we missed you, ${first}`, sub: agent => `Pick a new time with ${agent}. It takes one tap.`, done: 'You’re booked again' },
  callback: { title: first => `Sorry we missed your call, ${first}`, sub: () => 'Pick a time and we’ll call you back.', done: 'We’ll call you then' },
}

function Picker({ page, agent, agentTz, week, first }) {
  const [tz, setTz] = useState('America/New_York')
  const [day, setDay] = useState(DAYS[1][0])
  const [pick, setPick] = useState(null)
  const [done, setDone] = useState(false)
  const p = PAGES[page]
  const wd = DAYS.find(d => d[0] === day)[1]
  const hours = page === 'callback'
    ? { tz, ...TEAM_HOURS }
    : week[wd]?.on ? { tz: agentTz, open: clockMin(week[wd].start), close: clockMin(week[wd].end) } : null
  const slots = hours ? agentSlots({ date: day, clocks: CLIENT_CLOCKS, clientTz: tz, hours }).filter(s => s.why !== 'off') : []
  const dayLabel = DAYS.find(d => d[0] === day)[2]
  if (done) {
    return (
      <section className="dd-card" aria-live="polite">
        <span className="dd-ok"><Check size={22} aria-hidden="true" /></span>
        <h1>{p.done}</h1>
        <p><b>{dayLabel} at {pick}</b> your time ({zoneAbbr(tz)}). {page === 'callback' ? 'We’ll call this number.' : `${agent} will call you.`} We{'’'}ll text you a reminder before.</p>
        {page !== 'callback' && <button type="button" className="tp-btn ov-ghost"><CalendarPlus size={15} />Add to my calendar</button>}
        <p>Need a different time? Open this same link again.</p>
      </section>
    )
  }
  return (
    <section className="dd-card">
      <h1>{p.title(first)}</h1>
      <p>{p.sub(agent)}</p>
      <Field label="Your time zone"><Select label="Your time zone" value={tz} onChange={v => { setTz(v); setPick(null) }} options={ZONES} /></Field>
      <Field label="Day"><Select label="Day" value={day} onChange={v => { setDay(v); setPick(null) }} options={DAYS.map(([v, , l]) => ({ value: v, label: l }))} /></Field>
      {slots.length ? (
        <div className="dd-slots" role="radiogroup" aria-label={`Times on ${dayLabel}, your time`}>
          {slots.map(s => <button key={s.clock} type="button" role="radio" aria-checked={pick === s.clock} disabled={!s.open} className={pick === s.clock ? 'is-on' : ''} onClick={() => setPick(s.clock)}>{s.clock}</button>)}
        </div>
      ) : <p>No times this day. Try another day.</p>}
      <button type="button" className="tp-primary fx-accent" disabled={!pick} onClick={() => setDone(true)}>{page === 'callback' ? <><PhoneCall size={15} />Call me then</> : 'Book this time'}</button>
    </section>
  )
}

function OptOut() {
  const [done, setDone] = useState(false)
  return (
    <section className="dd-card" aria-live="polite">
      {done ? <>
        <span className="dd-ok"><Check size={22} aria-hidden="true" /></span>
        <h1>You won{'’'}t get any more texts from us</h1>
        <p>If you change your mind, reply START to any of our texts.</p>
      </> : <>
        <h1>Stop texts from Deedstone?</h1>
        <p>We{'’'}ll stop texting this number. You can also reply STOP to any text.</p>
        <button type="button" className="tp-primary fx-accent" onClick={() => setDone(true)}><BellOff size={15} />Stop texts</button>
      </>}
    </section>
  )
}

export default function Deedstone() {
  const { page = 'book' } = useParams()
  const [params] = useSearchParams()
  const { data: settings } = useSampleSettings()
  const first = params.get('name') || 'Maria'
  const agent = settings.profile.name.split(' ')[0]
  const which = (PAGES[page] || page === 'opt-out') ? page : 'book'
  return (
    <div className="dd">
      <div className="dd-in">
        <div className="dd-brand"><i aria-hidden="true">D</i>Deedstone</div>
        {which === 'opt-out' ? <OptOut /> : <Picker key={which} page={which} agent={agent} agentTz={settings.timeZone} week={settings.week} first={first} />}
        <p className="dd-foot">Deedstone · Reply STOP to any text to opt out · Sample page: nothing is booked or sent</p>
      </div>
    </div>
  )
}
