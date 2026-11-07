import { useState } from 'react'
import { Check, TriangleAlert, Timer, Users, ShieldCheck, CalendarX, Repeat, Clock3, Star, Flag, Scale, ClipboardCheck } from 'lucide-react'
import { Avatar, Chip, Drawer, Seg, SampleTag, useNote } from '../../template/kit'
import { usd } from '../../template/motion'
import { Tile } from '../kit'
import {
  VA_STATUS, DESK_VAS, DESK_QUEUE, SPEED_TODAY, median, clockS, deskAlerts, staffing, isRouted,
  VA_METRICS, QA_RUBRIC, QA_MIN_PER_WEEK, QA_REVIEWS, qaScore, qaDone, reReviewerFor,
  TIMESHEET, CORRECTIONS, sheetTotals, dayHours, SWAPS, OPEN_SHIFTS, HOLIDAYS, HOLIDAY_WORD,
  ONBOARD_STEPS, ONBOARDING, canWork, RECORDS, trend,
} from '../p879'
import '../p879.css'

// P879 — the Fulfillment team's new tabs, on sample data (852/858 wire them): the live desk, swaps and open shifts,
// hours and hourly pay from clock in/out, call quality, VA records (onboarding and attendance) and holidays.
const money = usd(true)
const pct = x => `${Math.round(x * 100)}%`

// N-J-01, N-F-04, N-B-28, N-F-32: each VA's status and who they're with, the queue by priority, the oldest wait,
// today's speed median and open alerts. Only Available VAs are rung.
export function LiveDesk() {
  const [forecast, setForecast] = useState(3)
  const st = staffing(DESK_VAS, forecast)
  const alerts = deskAlerts(DESK_VAS, DESK_QUEUE)
  const oldest = Math.max(...DESK_QUEUE.filter(q => q.n).map(q => q.oldestS))
  return (
    <div className="p879-stack">
      {st.under && (
        <section className="p879-band is-warn" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <span className="tp-grow"><b>Understaffed: {st.working} working, the forecast needs {st.forecast}</b>
            <small>Admins are alerted. New leads and call tasks come first; held back until more VAs are free: {st.deferred.join(', ')}.</small></span>
        </section>
      )}
      <div className="p879-kpis" role="list" aria-label="The desk right now">
        <div role="listitem"><small>Waiting</small><b className="tp-num">{DESK_QUEUE.reduce((t, q) => t + q.n, 0)}</b></div>
        <div role="listitem"><small>Oldest wait</small><b className="tp-num">{clockS(oldest)}</b></div>
        <div role="listitem"><small>Speed to first call today</small><b className="tp-num">{median(SPEED_TODAY)} s</b><small>median of {SPEED_TODAY.length}</small></div>
        <div role="listitem"><small>Working now</small><b className="tp-num">{st.working} of {DESK_VAS.length}</b></div>
      </div>
      <div className="adm-two">
        <Tile i={0} title="VAs right now" sub="Only Available VAs are rung" aside={<SampleTag>Sample</SampleTag>}>
          <ul className="tp-list">{DESK_VAS.map(v => {
            const [w, tone] = VA_STATUS[v.status]
            return (
              <li key={v.id} className="fx-mrow">
                <Avatar name={v.name} tone={tone} />
                <span className="tp-grow"><b>{v.name}</b><small>{v.party ? `${v.callType} · ${v.party}` : isRouted(v.status) ? 'Next call rings here' : 'Not rung'}</small></span>
                <Chip tone={tone}>{w}</Chip>
                {v.status !== 'offline' && <small className="tp-num p879-t">{v.breakLeft != null ? (v.breakLeft < 0 ? `${clockS(-v.breakLeft).replace('+', '')} over` : `${clockS(v.breakLeft)} left`) : clockS(v.since)}</small>}
              </li>
            )
          })}</ul>
        </Tile>
        <Tile i={1} title="Queue by priority" sub="New leads beat servicing work with no one on the line">
          <ul className="tp-list">{DESK_QUEUE.map(q => (
            <li key={q.tier} className="fx-mrow"><span className="p879-tier tp-num">{q.tier}</span><span className="tp-grow"><b>{q.label}</b><small>{q.n ? `Oldest ${clockS(q.oldestS)}` : 'None waiting'}</small></span><b className="tp-num">{q.n}</b></li>
          ))}</ul>
          <div className="p879-forecast">
            <span className="tp-grow"><b>Forecast for now</b><small>Below this many working, understaffed mode starts.</small></span>
            <Seg label="Forecast" value={forecast} onChange={setForecast} options={[2, 3, 4].map(n => ({ key: n, label: String(n) }))} />
          </div>
        </Tile>
      </div>
      <Tile i={2} title="Open alerts" sub={alerts.length ? `${alerts.length} need a look` : 'All clear'}>
        <ul className="tp-list">{alerts.map(a => <li key={a.id} className="fx-mrow"><TriangleAlert size={15} aria-hidden="true" className="p879-warn" /><span className="tp-grow"><b>{a.text}</b></span></li>)}
          {!alerts.length && <li className="fx-calm"><Check size={16} aria-hidden="true" />Nothing open.</li>}</ul>
      </Tile>
    </div>
  )
}

// N-F-07: swap requests between VAs, and open shifts pushed to eligible VAs (first to accept, then an admin confirms).
export function SwapsAndOpen() {
  const note = useNote()
  const [swaps, setSwaps] = useState(SWAPS)
  const [open, setOpen] = useState(OPEN_SHIFTS)
  const decide = (id, ok) => { setSwaps(s => s.map(x => (x.id === id ? { ...x, status: ok ? 'approved' : 'declined' } : x))); note(ok ? 'Swap approved. The rota is updated.' : 'Swap declined') }
  return (
    <div className="adm-two p879-mt">
      <Tile i={2} title="Shift swaps" sub="Both VAs agreed; you approve">
        <ul className="tp-list">{swaps.map(s => (
          <li key={s.id} className="adm-req"><Repeat size={16} aria-hidden="true" />
            <span className="tp-grow"><b>{s.from} → {s.to}</b><small>{s.day}</small></span>
            {s.status === 'pending' ? <>
              <button type="button" className="tp-primary sm fx-accent" onClick={() => decide(s.id, true)}><Check size={14} />Approve</button>
              <button type="button" className="tp-btn sm ov-ghost" onClick={() => decide(s.id, false)}>Decline</button>
            </> : <Chip tone={s.status === 'approved' ? 'green' : 'mute'}>{s.status === 'approved' ? 'Approved' : 'Declined'}</Chip>}
          </li>
        ))}</ul>
      </Tile>
      <Tile i={3} title="Open shifts" sub="Sent to every VA free that day; first to accept takes it">
        <ul className="tp-list">{open.map(s => (
          <li key={s.id} className="adm-req"><CalendarX size={16} aria-hidden="true" />
            <span className="tp-grow"><b>{s.day} · <span className="tp-num">{s.hours}</span></b><small>{s.why}{s.accepted ? ` · ${s.accepted} accepted` : ' · nobody yet'}</small></span>
            {s.status === 'accepted' && <button type="button" className="tp-primary sm fx-accent" onClick={() => { setOpen(o => o.map(x => (x.id === s.id ? { ...x, status: 'confirmed' } : x))); note(`${s.accepted} is on the rota for ${s.day}`) }}><Check size={14} />Confirm</button>}
            {s.status === 'confirmed' && <Chip tone="green">On the rota</Chip>}
            {s.status === 'open' && <Chip tone="blue">Waiting</Chip>}
          </li>
        ))}</ul>
      </Tile>
    </div>
  )
}

// N-F-23, N-G-24 (Q75/Q76): hours from clock in/out with breaks, flags and overtime, corrections to approve, and the
// week's pay as hours × each VA's rate. Pay is hourly only.
export function HoursPay() {
  const note = useNote()
  const [open, setOpen] = useState(null)
  const [fixes, setFixes] = useState(CORRECTIONS)
  const rows = TIMESHEET.map(r => ({ ...r, t: sheetTotals(r) }))
  const total = rows.reduce((t, r) => t + r.t.pay, 0)
  const row = rows.find(r => r.va === open)
  return (
    <div className="p879-stack">
      <div className="adm-two">
        <Tile i={0} title="This week's hours" sub="Nov 2 to 8 · from clock in and out · pay is hourly" aside={<SampleTag>Sample</SampleTag>}>
          <b className="fx-huge tp-money">{money(total)}</b>
          <ul className="tp-list adm-rows">{rows.map(r => (
            <li key={r.va}><button type="button" className="fx-mrow" onClick={() => setOpen(r.va)}>
              <Avatar name={r.name} /><span className="tp-grow"><b>{r.name}</b><small><span className="tp-num">{r.t.hours.toFixed(2)}</span> h × {money(r.t.rate)}{r.t.ot ? ` · ${r.t.ot.toFixed(1)} h overtime` : ''}{r.t.flags ? ` · ${r.t.flags} flagged` : ''}</small></span>
              {r.t.flags > 0 && <Chip tone="warn">Check</Chip>}<b className="tp-money">{money(r.t.pay)}</b>
            </button></li>
          ))}</ul>
        </Tile>
        <Tile i={1} title="Correction requests" sub="Admin approves; every change is audited and the week locks at the pay run">
          <ul className="tp-list">{fixes.map(c => (
            <li key={c.id} className="adm-req"><Clock3 size={16} aria-hidden="true" />
              <span className="tp-grow"><b>{c.va} · {c.day}</b><small>{c.ask} · {c.why}</small></span>
              {c.status === 'pending' ? <>
                <button type="button" className="tp-primary sm fx-accent" onClick={() => { setFixes(f => f.map(x => (x.id === c.id ? { ...x, status: 'approved' } : x))); note('Correction approved and logged') }}><Check size={14} />Approve</button>
                <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setFixes(f => f.map(x => (x.id === c.id ? { ...x, status: 'declined' } : x))); note('Correction declined') }}>Decline</button>
              </> : <Chip tone={c.status === 'approved' ? 'green' : 'mute'}>{c.status === 'approved' ? 'Approved' : 'Declined'}</Chip>}
            </li>
          ))}</ul>
          <p className="tp-sub p879-mt">Locks Mon, Nov 9 at the pay run. Brayden says yes before anything is paid.</p>
        </Tile>
      </div>
      <Drawer open={!!row} center onClose={() => setOpen(null)} title={row ? `${row.name}'s timesheet` : ''} sub="Nov 2 to 8">
        {row && <ul className="tp-list">{row.days.map(d => (
          <li key={d.d} className="fx-mrow"><b className="p879-day">{d.d}</b><span className="tp-grow"><b className="tp-num">{d.in} to {d.out}</b><small>{d.breakM} min break{d.flag ? ` · ${d.flag}` : ''}</small></span><b className="tp-num">{dayHours(d).toFixed(2)} h</b></li>
        ))}</ul>}
      </Drawer>
    </div>
  )
}

// N-F-20, N-F-21, N-F-22: score at least five random calls a VA a week (plus flagged ones) on the rubric; a VA can
// dispute once and the other admin re-reviews; per-VA numbers.
export function Quality() {
  const note = useNote()
  const [reviews, setReviews] = useState(QA_REVIEWS)
  const [scoring, setScoring] = useState(null)
  const [draft, setDraft] = useState(QA_RUBRIC.map(() => 2))
  return (
    <div className="p879-stack">
      <div className="adm-two">
        <Tile i={0} title="Call reviews this week" sub={`At least ${QA_MIN_PER_WEEK} random calls a VA, plus flagged ones`} aside={<SampleTag>Sample</SampleTag>}>
          <ul className="tp-list">{VA_METRICS.map(v => {
            const n = qaDone(reviews, v.id)
            return (
              <li key={v.id} className="fx-mrow"><Avatar name={v.name} /><span className="tp-grow"><b>{v.name}</b><small>{n} of {QA_MIN_PER_WEEK} reviewed</small></span>
                <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setScoring(v); setDraft(QA_RUBRIC.map(() => 2)) }}><Star size={14} />Score a call</button></li>
            )
          })}</ul>
        </Tile>
        <Tile i={1} title="Scored calls" sub="The VA sees their score and can dispute it once">
          <ul className="tp-list">{reviews.map(r => (
            <li key={r.id} className="adm-req">{r.flagged ? <Flag size={15} aria-hidden="true" className="p879-warn" /> : <ClipboardCheck size={15} aria-hidden="true" />}
              <span className="tp-grow"><b>{r.call}</b><small>{VA_METRICS.find(v => v.id === r.va)?.name} · {r.when} · scored by {r.by}</small>
                {r.dispute && <small className="adm-warn-t"><Scale size={12} aria-hidden="true" />Disputed {r.dispute.at}: "{r.dispute.text}"{r.dispute.status === 'open' ? ` · ${reReviewerFor(r)} re-reviews` : ` · ${r.dispute.status}`}</small>}</span>
              <b className="tp-num">{qaScore(r)}%</b>
              {r.dispute?.status === 'open' && <button type="button" className="tp-btn sm ov-ghost" onClick={() => { setReviews(x => x.map(y => (y.id === r.id ? { ...y, dispute: { ...y.dispute, status: 'upheld by ' + reReviewerFor(r) } } : y))); note('Re-review saved. Both scores are kept.') }}>Re-review</button>}
            </li>
          ))}</ul>
        </Tile>
      </div>
      <Tile i={2} title="Per-VA numbers" sub="This week">
        <div className="p879-scroll" role="region" aria-label="Per-VA numbers" tabIndex={0}>
          <table className="p879-tbl">
            <thead><tr>{['VA', 'Ring to answer', 'First call', 'Missed rings', 'Handle', 'Wrap-up', 'Adherence', 'Tasks', 'Transfers', 'Bookings', 'Show rate'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>{VA_METRICS.map(v => (
              <tr key={v.id}><th scope="row">{v.name}</th><td>{v.ringS} s</td><td>{v.firstCallS} s</td><td>{v.missedRings}</td><td>{v.handleM} min</td><td className={v.wrapS > 120 ? 'is-warn' : ''}>{v.wrapS} s</td><td>{pct(v.adherence)}</td><td>{v.tasks}</td><td>{v.transfers}</td><td>{v.bookings}</td><td>{pct(v.showRate)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Tile>
      <Drawer open={!!scoring} center onClose={() => setScoring(null)} title={scoring ? `Score a call · ${scoring.name}` : ''} sub="A random call from this week"
        footer={<button type="button" className="tp-primary fx-accent" onClick={() => {
          setReviews(x => [{ id: `qa-${x.length + 1}`, va: scoring.id, call: 'Random call · this week', when: 'Today', scores: draft, by: 'Brayden', flagged: false, dispute: null }, ...x])
          note(`Saved. ${scoring.name.split(' ')[0]} sees the score.`); setScoring(null)
        }}><Check size={16} />Save the score</button>}>
        <ul className="tp-list">{QA_RUBRIC.map((q, i) => (
          <li key={q} className="fx-mrow"><span className="tp-grow"><b>{q}</b></span>
            <Seg label={q} value={draft[i]} onChange={v => setDraft(d => d.map((x, j) => (j === i ? v : x)))} options={[{ key: 0, label: 'Missed' }, { key: 1, label: 'Partly' }, { key: 2, label: 'Yes' }]} /></li>
        ))}</ul>
      </Drawer>
    </div>
  )
}

// N-F-34, N-F-41: the onboarding checklist (no real work until done) and each VA's attendance and performance record,
// admin only.
export function Records() {
  const [who, setWho] = useState(null)
  const o = ONBOARDING.find(x => x.va === who)
  return (
    <div className="p879-stack">
      <div className="adm-two">
        <Tile i={0} title="Onboarding" sub="No real calls until every step is done" aside={<SampleTag>Sample</SampleTag>}>
          <ul className="tp-list">{ONBOARDING.map(x => (
            <li key={x.va}><button type="button" className="fx-mrow" onClick={() => setWho(x.va)}>
              <Avatar name={x.name} /><span className="tp-grow"><b>{x.name}</b><small>{x.done} of {ONBOARD_STEPS.length} steps</small></span>
              <Chip tone={canWork(x) ? 'green' : 'blue'}>{canWork(x) ? 'Can take calls' : 'Not yet'}</Chip>
            </button></li>
          ))}</ul>
        </Tile>
        <Tile i={1} title="Attendance and performance" sub="Admins only · this month">
          <ul className="tp-list">{RECORDS.map(r => {
            const t = trend(r.qa)
            return (
              <li key={r.va} className="adm-req"><Avatar name={r.name} />
                <span className="tp-grow"><b>{r.name}</b><small>{r.lates} late · {r.noShows} no-show · {r.overruns} break overruns · {r.gaps} gaps</small>
                  <small>Coaching: {r.coaching} · Goal: {r.goal}</small></span>
                <span className="p879-qa"><small>Call quality</small><b className="tp-num">{r.qa.at(-1)}%</b><small className={t < 0 ? 'p879-warn' : ''}>{t >= 0 ? '+' : ''}{t}</small></span>
              </li>
            )
          })}</ul>
        </Tile>
      </div>
      <Drawer open={!!o} center onClose={() => setWho(null)} title={o ? o.name : ''} sub="Onboarding steps">
        {o && <ul className="tp-list">{ONBOARD_STEPS.map((s, i) => (
          <li key={s} className="fx-mrow">{i < o.done ? <ShieldCheck size={16} aria-hidden="true" className="p879-ok" /> : <Timer size={16} aria-hidden="true" />}<span className="tp-grow"><b>{s}</b></span><Chip tone={i < o.done ? 'green' : 'mute'}>{i < o.done ? 'Done' : 'To do'}</Chip></li>
        ))}</ul>}
      </Drawer>
    </div>
  )
}

// N-F-31: closed and reduced days, carrier holidays; the rota shows them and the after-hours path runs on closed days.
export function Holidays() {
  const note = useNote()
  return (
    <Tile className="p879-mt" i={3} title="Holidays" sub="On the rota and the VAs' schedule; closed days run the after-hours path">
      <ul className="tp-list">{HOLIDAYS.map(h => {
        const [w, tone] = HOLIDAY_WORD[h.kind]
        return <li key={h.id} className="adm-req"><CalendarX size={16} aria-hidden="true" /><span className="tp-grow"><b>{h.date} · {h.name}</b><small>{h.note}</small></span><Chip tone={tone}>{w}</Chip></li>
      })}</ul>
      <button type="button" className="tp-btn sm ov-ghost p879-mt" onClick={() => note('Sample: adding a day saves once the backend is wired')}><Users size={14} />Add a day</button>
    </Tile>
  )
}

