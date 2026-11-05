import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Clock, Phone, PhoneIncoming, PhoneMissed, TriangleAlert, LifeBuoy, Hand, Radio } from 'lucide-react'
import { Avatar } from '../../template/kit'
import { CountUp, usd } from '../../template/motion'
import { inLabel, timeText } from '../../lib/fulfillmentDay'
import { displayName } from '../../lib/vaQueue'
import { kindLabel, toneOf, dueText } from '../../lib/vaServicing'
import { FUL } from '../paths'
import { useFulData } from '../useFulData'

// P837 — Today, the VA's landing page, on the agent Overview's shape (P840/P841): the dominant Next call tile with
// its countdown, under it Your day and the Queue, a full-height Needs you column on the right (callbacks due, missed
// transfers, overdue and held servicing steps), and a strip with Servicing and Pay. Real data only (useFulData).
const callTo = id => `${FUL.calls}?open=${id}`
const fullName = p => [p.client_first_name, p.client_last_name].filter(Boolean).join(' ') || 'Client'
const money = cents => usd(true)(cents / 100)

function Tile({ className = '', i, title, sub, to, label, children }) {
  return (
    <section className={`fx-tile ${className}`} style={{ '--i': i }} aria-label={title}>
      <header className="fx-tile-h">
        <span className="tp-grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</span>
        {to && <Link to={to} className="fx-open" aria-label={label || `Open ${title}`}><ArrowUpRight size={16} /></Link>}
      </header>
      {children}
    </section>
  )
}

function NeedCard({ r, i }) {
  return (
    <article className={`fx-card fx-ncard is-${r.tone}`} style={{ '--i': i }}>
      <Link to={r.to} className="fx-cover" aria-label={`Open ${r.name}`} />
      <span className="fx-ncard-k"><r.Icon size={13} aria-hidden="true" />{r.kind}</span>
      <h3>{r.name}</h3>
      <p>{r.what}</p>
      <div className="fx-ncard-bot"><span className="fx-when">{r.when}</span><Avatar name={r.name} tone={r.tone} /></div>
    </article>
  )
}

function Loading({ q, what }) {
  if (q.isError && !q.data) return <p className="fx-calm" role="alert"><TriangleAlert size={16} aria-hidden="true" />Couldn’t load {what}. <button type="button" className="fs-link" onClick={() => q.refetch()}>Try again</button></p>
  return <p className="fx-calm">Loading {what}…</p>
}

export default function Today() {
  const d = useFulData()
  const { day, tz, now, buckets: b } = d
  const next = day.next
  const liveRow = d.live[0]
  const callsReady = !!d.queueQ.data
  const waiting = b.new + b.not_reached + b.callback_due

  const needs = [
    ...d.missed.map(r => ({ id: `m-${r.lead_id}`, to: FUL.queue, name: displayName(r), what: r.agent_name ? `Missed by ${r.agent_name}. Book the next slot.` : 'Missed live transfer', tone: 'warn', Icon: PhoneMissed, kind: 'Missed transfer', when: 'Now' })),
    ...(d.vaQ.data || []).filter(r => r.bucket === 'callback_due').map(r => ({ id: `c-${r.lead_id}`, to: FUL.queue, name: displayName(r), what: `Callback due${r.va_attempts ? `, try ${r.va_attempts + 1}` : ''}`, tone: 'warn', Icon: PhoneIncoming, kind: 'Callback', when: r.va_callback_at ? timeText(r.va_callback_at, tz) : 'Now' })),
    ...[...d.tasks.mine, ...d.tasks.overdue].map(t => ({ id: `s-${t.task_id}`, to: FUL.servicing, name: t.client_name || 'Client', what: kindLabel(t.kind), tone: t.mine ? 'blue' : toneOf(t.kind), Icon: t.mine ? Hand : LifeBuoy, kind: t.mine ? 'You are working' : 'Servicing, overdue', when: t.mine ? 'Now' : dueText(t.due_at, now, tz).replace('Overdue since ', '') })),
  ]

  return (
    <div className="tp-page fx-page fx-ovl fs-today">
      <div className="fx-ovl-main">
        {liveRow ? (
          <Tile className="fx-ovl-next fs-hero is-fill is-coral" i={0} title="On a call" sub={`${fullName(liveRow)} · started ${timeText(liveRow.call_live_since, tz)}`} to={callTo(liveRow.id)} label="Open the call">
            <b className="fx-huge"><Radio size={34} aria-hidden="true" /> Live</b>
            <span className="fx-next-who"><Avatar name={fullName(liveRow)} /><span><b>{fullName(liveRow)}</b><small>Cancel with {liveRow.current_carrier || liveRow.carrier_name || 'carrier not noted'}</small></span></span>
            <div className="tp-row tp-wrap fx-next-acts"><Link to={callTo(liveRow.id)} className="tp-primary sm fx-accent"><Phone size={14} />Back to the call</Link></div>
          </Tile>
        ) : (
          <Tile className="fx-ovl-next fs-hero is-fill is-blue" i={0} title="Next call" sub={!callsReady ? 'Loading your calls…' : next ? `${next.subNext}` : day.left ? `${day.left} still to call today` : 'Nothing else on your calendar today'} to={next ? callTo(next.id) : FUL.calls} label={next ? `Open ${next.name}` : 'Open Calls'}>
            {!callsReady ? <Loading q={d.queueQ} what="your calls" /> : next ? (
              <>
                <div className="fs-count">
                  <b className="fx-huge">{next.time}<small>{next.period}</small></b>
                  <i className="fx-delta is-mute">{inLabel(next.ms, now)}</i>
                </div>
                <span className="fx-next-who"><Avatar name={next.name} /><span><b>{next.name}</b><small>{next.subNext}</small></span></span>
                <div className="tp-row tp-wrap fx-next-acts">
                  <Link to={callTo(next.id)} className="tp-primary sm fx-accent"><Phone size={14} />Open the call</Link>
                  <Link to={FUL.calls} className="fx-pillbtn"><Clock size={14} />All calls</Link>
                </div>
              </>
            ) : (
              <>
                <p className="fx-calm"><Check size={16} aria-hidden="true" />{day.done.length ? `${day.done.length} done today. Nice work.` : 'Your calls show here as agents book them.'}</p>
                <div className="tp-row tp-wrap fx-next-acts"><Link to={FUL.queue} className="tp-primary sm fx-accent"><PhoneIncoming size={14} />Work the queue</Link></div>
              </>
            )}
          </Tile>
        )}

        <div className="fx-ovl-pair">
          <Tile className="fs-day" i={1} title="Your day" sub={callsReady ? `${day.total} call${day.total === 1 ? '' : 's'} today · ${day.done.length} done, ${day.left} to go` : 'Loading…'} to={FUL.calls} label="Open Calls">
            {callsReady && day.total === 0 && <p className="fx-calm">No calls on your calendar today.</p>}
            <ul className="fs-rows">
              {day.rest.map(r => <li key={`r-${r.id}-${r.ms}`}><Link to={callTo(r.id)} className="fs-row"><span className="fs-row-t tp-num">{r.time}<small>{r.period}</small></span><span className="tp-grow"><b>{r.name}</b><small>{r.sub}</small></span><i className={`fx-delta is-${r.tone === 'noAnswer' ? 'mute' : 'blue'}`}>{r.tone === 'noAnswer' ? 'Retry' : 'Booked'}</i></Link></li>)}
              {day.more > 0 && <li><Link to={FUL.calls} className="fs-row fs-more">+{day.more} more today</Link></li>}
              {day.done.map(r => <li key={`d-${r.id}-${r.ms}`}><Link to={callTo(r.id)} className="fs-row is-done"><span className="fs-row-t tp-num">{timeText(r.at, tz)}</span><span className="tp-grow"><b>{r.name}</b><small>{r.result}</small></span><Check size={15} aria-hidden="true" /></Link></li>)}
            </ul>
          </Tile>

          <Tile className="fs-queue is-fill is-teal" i={2} title="Queue" sub={d.vaQ.data ? `${waiting} waiting${d.missed.length ? ` · ${d.missed.length} missed transfer${d.missed.length === 1 ? '' : 's'}` : ''}` : 'Loading…'} to={FUL.queue} label="Open the Queue">
            {!d.vaQ.data ? <Loading q={d.vaQ} what="the queue" /> : (
              <>
                <ul className="fx-ringstats fs-qstats">
                  {[['Callback due', b.callback_due], ['New', b.new], ['Not reached', b.not_reached]].map(([label, n]) => <li key={label}><Link to={FUL.queue}><small>{label}</small><b className="tp-num"><CountUp value={n} /></b></Link></li>)}
                </ul>
                <p className="fs-note-line">Callback due comes first. Taking a lead holds it for 15 minutes so no other VA calls them.</p>
                <div className="tp-row tp-wrap fx-next-acts"><Link to={FUL.queue} className="fx-pillbtn"><PhoneIncoming size={14} />Take the next lead</Link></div>
              </>
            )}
          </Tile>
        </div>
      </div>

      <div className="fx-ovl-side">
        <section className="fx-tile is-deep fx-ovl-needs" style={{ '--i': 4 }} aria-label="Needs you">
          <div className="fx-ovl-needs-in">
            <header className="fx-tile-h">
              <span className="tp-grow"><h2>Needs you</h2><p>{needs.length ? `${needs.length} waiting on you` : 'All caught up'}</p></span>
              <Link to={FUL.queue} className="fx-open" aria-label="Open the Queue"><ArrowUpRight size={16} /></Link>
            </header>
            {needs.length > 0
              ? <div className="fx-ncards">{needs.map((r, i) => <NeedCard key={r.id} r={r} i={i} />)}</div>
              : <p className="fx-calm"><Check size={16} aria-hidden="true" />No callbacks, missed transfers or overdue steps.</p>}
          </div>
        </section>
      </div>

      <div className="fs-strip">
        <Tile className="fs-serv" i={5} title="Servicing" sub={d.servQ.data ? `${d.servicing.length} open step${d.servicing.length === 1 ? '' : 's'} on the team’s clients` : 'Loading…'} to={FUL.servicing} label="Open Servicing">
          {!d.servQ.data ? <Loading q={d.servQ} what="servicing" /> : (
            <ul className="fx-ringstats fs-sstats">
              {[['Working', d.tasks.mine.length], ['Overdue', d.tasks.overdue.length], ['Due today', d.tasks.today.length], ['Coming up', d.tasks.later.length + d.tasks.none.length]].map(([label, n]) => <li key={label}><Link to={FUL.servicing}><small>{label}</small><b className="tp-num"><CountUp value={n} /></b></Link></li>)}
            </ul>
          )}
        </Tile>
        <Tile className="fs-pay is-fill is-green" i={6} title="Pay this week" sub={d.perCancel != null ? `${money(d.perCancel)} for each verified cancel` : 'Paid every Monday'} to={FUL.pay} label="Open Pay">
          {!d.cancelsQ.data ? <Loading q={d.cancelsQ} what="your pay" /> : (
            <div className="fs-paywrap">
              <b className="fx-huge fx-huge2 tp-money"><CountUp value={d.totals.earnedCents / 100} format={usd(true)} /></b>
              <ul className="fs-paybits">
                <li><b className="tp-num">{d.totals.verified}</b><small>verified</small></li>
                <li><b className="tp-num">{d.totals.checking}</b><small>being checked</small></li>
                <li><b className="tp-num">{d.totals.listen}</b><small>with Brayden</small></li>
              </ul>
            </div>
          )}
        </Tile>
      </div>
    </div>
  )
}
