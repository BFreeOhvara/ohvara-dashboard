import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, Info, ChevronRight, ChevronDown, Check, Clock, Phone, PenLine, Zap, CalendarDays, ArrowRight } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useInboundEvents } from '../../../hooks/useInbounds'
import { PortalV2Layout, Ico, Pill, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import GetInboundsSlot from '../../../components/agent/GetInboundsSlot'
import {
  COLUMNS, LIVE_RESULT, leadName, phoneDisplay, appointmentAt, nextLine, cardSub, cameInAt, whenText, apptText, dayLabel,
} from '../../../lib/inbounds'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'
import './inboundsExtra.css'

// Inbounds, served at /agent/leads: two tabs, Booked appointments (a five-column board) and Live calls
// (filter chips and a log). Each tab has an explainer that is open on the first view and stays
// collapsed after, unless the agent opens it again (remembered per tab in this browser).
// Mockup: ohvara/mockups/update-the-existing-inbounds-page-get-in.html.
//
// Dev only: /agent/leads?sample=1 shows made-up people from src/lib/inboundsSample.js in place of the
// real list (never put in the query cache, so the sidebar badge never sees it). Add &empty=1 for the
// "no inbounds yet" state and &fail=1 for the error state (Try again then loads the sample).
// import.meta.env.DEV is false in a production build, so that code and the fixture drop out of it.

const NEXT_ICON = { check: Check, clock: Clock, phone: Phone, note: PenLine }
const BOOKED_STEPS = [
  ['They ask for help', 'Someone fills in a short form about protecting their mortgage.'],
  ['Our VA calls right away', "We call within minutes. If we can't call yet, we text them first."],
  ['We book them with you', 'The VA puts them on your calendar and texts a confirmation.'],
  ['We remind them', 'A text the day before and 1 hour before, with a link to reschedule.'],
  ['No-show? We rebook', 'The VA calls to rebook within the hour, up to twice.'],
  ["Can't reach them? We keep trying", 'Calls and texts on day 0, 1, 3 and 7, then once a month. We stop when they reply, book or ask us to stop.'],
]
const LIVE_STEPS = [
  ['They call in', 'People who already have a policy and want help now call us, or pick a time for us to call.'],
  ['Our VA checks the fit', 'A few quick questions so you only get people you can help.'],
  ['Active? We transfer', "If you're active, the VA puts them through to you live."],
  ['Not active? We book', 'The VA books them in your first open time, within the hour.'],
]
const OUTCOME_PILL = { sold: ['sold', 'Sold'], follow_up: ['follow', 'Follow up'], not_interested: ['lost', 'Not interested'] }

const storeKey = id => `ohvara-pv2-explain-${id}`
function readOpen(id) { try { return localStorage.getItem(storeKey(id)) !== 'closed' } catch { return true } }
function write(id, v) { try { localStorage.setItem(storeKey(id), v) } catch { /* private mode: the explainer just opens each time */ } }

// Open on the first view; that view marks it seen, so the next visit starts collapsed.
// `forceOpen` (the "no inbounds yet" page) opens it whatever was saved, so the page still teaches.
function Explainer({ id, title, sub, steps, cols, part, forceOpen }) {
  const [open, setOpen] = useState(() => forceOpen || readOpen(id))
  useEffect(() => {
    try { if (localStorage.getItem(storeKey(id)) === null) write(id, 'closed') } catch { /* see write() */ }
  }, [id])
  return (
    <details className="ov-card pv-explain inb-explain" open={open} onToggle={e => {
      const now = e.currentTarget.open
      if (now === open) return
      setOpen(now)
      write(id, now ? 'open' : 'closed')
    }}>
      <summary>
        <span className="pv-tile"><Ico icon={Info} size={20} /></span>
        <div className="pv-grow"><h3>{title}</h3><p className="pv-sub">{sub}</p></div>
        <span className="pv-tog"><span className="when-open">Hide</span><span className="when-closed">Show</span><Ico icon={ChevronDown} size={14} /></span>
      </summary>
      <div className="inb-body">
        <div className={`pv-steps ${cols}`}>
          {steps.map(([b, p], i) => (
            <div className="pv-step" key={b}><span className="num">{i + 1}</span><div><b>{b}</b><p>{p}</p></div></div>
          ))}
        </div>
        <p className="pv-yourpart"><Ico icon={Check} /><span><b>Your part:</b> {part}</span></p>
      </div>
    </details>
  )
}

function Card({ l, appt, evs, tz }) {
  const nx = nextLine(l, evs, tz)
  const NIcon = NEXT_ICON[nx.kind]
  const done = ['sold', 'follow_up', 'lost'].includes(l.inbound_stage)
  return (
    <Link className="pv-icard inb-card" to={`/agent/inbounds/${l.lead_id}`}>
      <h4>{leadName(l)}</h4>
      <p className="pv-sub">{cardSub(l, appt, tz)}</p>
      {!done && <p className={`pv-next${nx.up ? ' up' : ''}`}><Ico icon={NIcon} size={14} />{nx.text}</p>}
      {l.inbound_stage === 'follow_up' && nx.kind === 'clock' && nx.text !== 'Follow up' && <p className="pv-next up"><Ico icon={Clock} size={14} />{nx.text}</p>}
    </Link>
  )
}

// What each empty column says will land there.
const COL_EMPTY = {
  new: ['Nobody new right now', 'People land here the moment they fill in the form.'],
  contacting: ['Nobody to reach right now', "Anyone we haven't reached yet waits here while our VA keeps trying."],
  booked: ['Nothing booked yet', 'When our VA books someone, they show here and on your calendar.'],
  met: ['Nobody to mark', 'After you meet someone, they move here so you can mark how it went.'],
  done: ['No outcomes yet', 'Everyone you mark Sold, Follow up or Not interested ends up here.'],
}
const OUTCOME_GROUPS = [['sold', 'Sold', 'sold'], ['follow_up', 'Follow up', 'fu'], ['lost', 'Lost', 'lost']]

function ColEmpty({ k }) {
  const [t, p] = COL_EMPTY[k]
  return <p className="inb-col-empty"><b>{t}</b>{p}</p>
}

function Board({ list, evMap, tz }) {
  if (!list.length) {
    return (
      <section className="ov-card pv-card pv-empty">
        <span className="pv-tile"><Ico icon={Inbox} size={20} /></span>
        <h3>No booked appointments yet</h3>
        <p className="pv-sub">When someone asks for help, they show up under New and our VA starts calling them. You don&rsquo;t need to refresh.</p>
      </section>
    )
  }
  const card = l => {
    const evs = evMap.get(l.lead_id)
    return <Card key={l.lead_id} l={l} appt={appointmentAt(evs)} evs={evs} tz={tz} />
  }
  return (
    <div className="pv-board" aria-label="Pipeline">
      {COLUMNS.map(c => {
        const rows = list.filter(l => c.stages.includes(l.inbound_stage || 'new'))
        const last = c.key === 'done'
        return (
          <section key={c.key} className="inb-col">
            <div className={`pv-col-head pv-c-${c.tone}`}><i /><b>{c.title}</b>{!last && <span className="pv-count-q tab">{rows.length}</span>}</div>
            <p className="pv-col-sub">{c.sub}</p>
            <div className="inb-col-body">
              {!rows.length ? <ColEmpty k={c.key} /> : last ? OUTCOME_GROUPS.map(([stage, label, cls]) => {
                const g = rows.filter(l => l.inbound_stage === stage)
                return g.length ? (
                  <Fragment key={stage}>
                    <p className={`inb-og ${cls}`}><i />{label}<span>{g.length}</span></p>
                    {g.map(card)}
                  </Fragment>
                ) : null
              }) : rows.map(card)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// The board's shape while loading, so nothing jumps when the people arrive.
function BoardSkeleton() {
  return (
    <div className="pv-board" aria-busy="true" aria-label="Loading">
      {COLUMNS.map((c, i) => (
        <section key={c.key} className="inb-col">
          <div className={`pv-col-head pv-c-${c.tone}`}><i /><b>{c.title}</b></div>
          <p className="pv-col-sub">{c.sub}</p>
          <div className="inb-col-body">
            {Array.from({ length: i < 3 ? 2 : 1 }, (_, j) => (
              <div key={j} className="inb-skel" aria-hidden="true"><Skel w="70%" h={14} /><Skel w="90%" h={12} style={{ marginTop: 10 }} /><Skel w="55%" h={12} style={{ marginTop: 10 }} /></div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// What each result means, shown while the log is empty so the first real call makes sense.
const RESULT_MEANS = [
  ['transferred', 'Our VA checked the fit and put them through to you.'],
  ['booked', "You weren't active, so the VA booked your first open time."],
  ['missed', 'They hung up before the transfer. Our VA calls them back.'],
]
const FILTERS = [['all', 'All'], ['transferred', 'Transferred'], ['booked', 'Booked'], ['missed', 'Missed']]

function what(l, appt, tz) {
  switch (l.live_call_result) {
    case 'transferred': return 'Our VA checked the fit, then put them through to you'
    case 'booked': return appt ? `You weren't active, so the VA booked ${apptText(appt, tz).replace(/^Today, /, 'today ')}` : "You weren't active, so the VA booked it"
    case 'missed': return 'Hung up before the transfer. Our VA is calling back.'
    default: return 'Our VA is checking the fit'
  }
}
function outcomeOf(l) {
  if (l.outcome && OUTCOME_PILL[l.outcome]) return OUTCOME_PILL[l.outcome]
  if (l.live_call_result === 'transferred') return ['quiet', 'Not marked']
  if (l.live_call_result === 'booked') return ['quiet', 'Upcoming']
  return ['quiet', '—']
}

function LiveLog({ list, evMap, tz }) {
  const [filter, setFilter] = useState('all')
  const n = k => (k === 'all' ? list.length : list.filter(l => l.live_call_result === k).length)
  const shown = filter === 'all' ? list : list.filter(l => l.live_call_result === filter)
  if (!list.length) {
    return (
      <section className="ov-card pv-card pv-empty">
        <span className="pv-tile"><Ico icon={Zap} size={20} /></span>
        <h3>No live calls yet</h3>
        <p className="pv-sub">When someone calls in for you, you&rsquo;ll see here whether we transferred them to you or booked them.</p>
        <div className="inb-key">
          {RESULT_MEANS.map(([k, text]) => (
            <div key={k}><Pill tone={LIVE_RESULT[k].pill}>{LIVE_RESULT[k].label}</Pill><span>{text}</span></div>
          ))}
        </div>
      </section>
    )
  }
  return (
    <>
      <div className="pv-filters" role="group" aria-label="Show">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={`pv-fchip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label} <b className="tab">{n(k)}</b>
          </button>
        ))}
      </div>
      {shown.length ? (
        <section className="ov-card inb-log" aria-label="Live call log">
          <div className="pv-log-head"><span>When</span><span>Caller</span><span>What happened</span><span>Outcome</span><span /></div>
          <div className="inb-log-rows">
          {shown.map(l => {
            const r = LIVE_RESULT[l.live_call_result]
            const [otone, otext] = outcomeOf(l)
            const when = whenText(cameInAt(l), tz)
            return (
              <Link key={l.lead_id} className="pv-log-row" to={`/agent/inbounds/${l.lead_id}`}>
                <span className="when">{when}</span>
                <div className="who"><h4>{leadName(l)}</h4>{phoneDisplay(l.phone) && <p className="pv-sub">{phoneDisplay(l.phone)}</p>}</div>
                <div className="what">{r && <Pill tone={r.pill}>{r.label}</Pill>}<span>{what(l, appointmentAt(evMap.get(l.lead_id)), tz)}</span></div>
                <span className="out"><Pill tone={otone}>{otext}</Pill></span>
                <span className="rsub">{when}</span>
                <Ico icon={ChevronRight} />
              </Link>
            )
          })}
          </div>
        </section>
      ) : (
        <section className="ov-card pv-card pv-empty">
          <h3>No {FILTERS.find(f => f[0] === filter)[1].toLowerCase()} calls</h3>
          <p className="pv-sub">Nothing matches this filter.</p>
          <button type="button" className="ov-ghost pv-btn" onClick={() => setFilter('all')}>Show all</button>
        </section>
      )}
    </>
  )
}

// One line under each tab's count.
function bookedLine(list) {
  if (!list.length) return 'Nothing yet'
  const part = (stage, word) => { const n = list.filter(l => (l.inbound_stage || 'new') === stage).length; return n ? `${n} ${word}` : null }
  return [part('new', 'new'), part('booked', 'booked')].filter(Boolean).join(' · ') || 'Nothing new right now'
}
function liveLine(list, tz) {
  if (!list.length) return 'Nothing yet'
  const n = list.filter(l => dayLabel(cameInAt(l), tz) === 'Today').length
  return n ? `${n} today` : 'None today'
}

function InbTab({ to, on, live, icon, name, n, line }) {
  return (
    <Link to={to} className={`inb-tab${live ? ' live' : ''}${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}>
      <Ico icon={icon} size={20} /><span className="nm">{name}</span><span className="n tab">{n}</span><span className="ln">{line}</span>
    </Link>
  )
}

// "You're not getting inbounds yet". Start goes to Billing until the Get inbounds panel ships.
function StartHero() {
  return (
    <section className="ov-hero inb-start">
      <div className="inb-start-t">
        <h2>You&rsquo;re not getting inbounds yet</h2>
        <p>Pick a weekly amount and we&rsquo;ll start sending you Live Calls, Booked Appointments, or both.</p>
      </div>
      <Link to="/agent/billing" className="ov-hero-btn">Start<ArrowRight size={17} strokeWidth={2.2} aria-hidden="true" /></Link>
    </section>
  )
}

// Dev-only switches (see the note at the top) carried across the two tabs.
const DEV_FLAGS = ['sample', 'empty', 'fail']
function tabTo(tab, params) {
  const q = new URLSearchParams()
  if (tab === 'live') q.set('tab', 'live')
  if (import.meta.env.DEV) DEV_FLAGS.forEach(k => { if (params.get(k)) q.set(k, params.get(k)) })
  const qs = q.toString()
  return `/agent/leads${qs ? `?${qs}` : ''}`
}

const NO_EVENTS = new Map()

export default function Inbounds() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params] = useSearchParams()
  const tab = params.get('tab') === 'live' ? 'live' : 'booked'
  const inb = useInbounds()
  const ev = useInboundEvents()

  // Dev-only sample data (never in production: import.meta.env.DEV is false there).
  const sampleOn = import.meta.env.DEV && params.get('sample') === '1'
  const [fx, setFx] = useState(null)
  const [forcedFail, setForcedFail] = useState(() => import.meta.env.DEV && params.get('fail') === '1')
  useEffect(() => {
    if (import.meta.env.DEV && sampleOn) {
      let live = true
      import('../../../lib/inboundsSample').then(m => { if (live) setFx(m.buildSample()) })
      return () => { live = false }
    }
    return undefined
  }, [sampleOn])

  const isError = sampleOn ? forcedFail : inb.isError
  const isLoading = !isError && (sampleOn ? !fx : inb.isLoading)
  const retry = sampleOn ? () => setForcedFail(false) : () => inb.refetch()
  const evMap = useMemo(() => (sampleOn ? fx?.events : ev.data) || NO_EVENTS, [sampleOn, fx, ev.data])
  const list = useMemo(
    () => (sampleOn ? (params.get('empty') === '1' ? [] : fx?.leads) : inb.data) || [],
    [sampleOn, fx, params, inb.data],
  )
  const booked = list.filter(l => l.inbound_product === 'booked_appointment')
  const live = list.filter(l => l.inbound_product === 'live_call')
  const isEmpty = !isLoading && !isError && list.length === 0

  const nA = isLoading ? ' ' : isError ? '—' : booked.length
  const nB = isLoading ? ' ' : isError ? '—' : live.length
  const lineA = isLoading ? ' ' : isError ? "Couldn't load" : bookedLine(booked)
  const lineB = isLoading ? ' ' : isError ? "Couldn't load" : liveLine(live, tz)

  return (
    <PortalV2Layout active="inbounds" crumb="Leads" title="Leads" icon={Inbox}>
      <div className="pv-flow inb-page">
        {/* Goal fe2f2055 (Billing) mounts the Get inbounds panel here, without rewriting this page. */}
        <GetInboundsSlot />

        {isEmpty && <StartHero />}

        <nav className="inb-tabs" aria-label="Inbound type">
          <InbTab to={tabTo('booked', params)} on={tab === 'booked'} icon={CalendarDays} name="Booked appointments" n={nA} line={lineA} />
          <InbTab to={tabTo('live', params)} on={tab === 'live'} live icon={Phone} name="Live calls" n={nB} line={lineB} />
        </nav>

        {tab === 'booked' ? (
          <Explainer key={`booked-${isEmpty}`} id="booked" title="How booked appointments work" sub="6 steps, from the form to your calendar"
            steps={BOOKED_STEPS} cols="six" forceOpen={isEmpty}
            part="show up to the appointment, then mark it Sold, Follow up or Not interested. Sold makes them your client and servicing starts." />
        ) : (
          <Explainer key={`live-${isEmpty}`} id="live" title="How live calls work" sub="4 steps, from the call to you"
            steps={LIVE_STEPS} cols="four" forceOpen={isEmpty}
            part="be active when you want live transfers, and mark each call Sold, Follow up or Not interested afterwards." />
        )}

        {isLoading ? (
          tab === 'booked' ? <BoardSkeleton /> : (
            [0, 1].map(i => (
              <section key={i} className="ov-card pv-card" aria-busy="true"><Skel w="40%" h={14} /><Skel w="70%" h={12} style={{ marginTop: 10 }} /><Skel w="30%" h={12} style={{ marginTop: 10 }} /></section>
            ))
          )
        ) : isError ? (
          <ErrorCard title="We couldn't load your inbounds" text="Nothing was lost. Check your connection and try again." onRetry={retry} />
        ) : isEmpty ? null : tab === 'booked' ? <Board list={booked} evMap={evMap} tz={tz} /> : <LiveLog list={live} evMap={evMap} tz={tz} />}
      </div>
    </PortalV2Layout>
  )
}
