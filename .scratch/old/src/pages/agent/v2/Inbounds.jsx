import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Inbox, Info, ChevronRight, ChevronDown, Check, Clock, Phone, PenLine, Zap } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds, useInboundEvents } from '../../../hooks/useInbounds'
import { PortalV2Layout, Ico, Pill, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import {
  COLUMNS, LIVE_RESULT, leadName, phoneDisplay, appointmentAt, nextLine, cardSub, cameInAt, whenText, apptText, stageOf,
} from '../../../lib/portalV2'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'

// Inbounds (/agent/inbounds): two tabs, Booked appointments (a five-column board) and Live calls
// (filter chips and a log). Each tab has an explainer that is open on the first view and stays
// collapsed after, unless the agent opens it again (remembered per tab in this browser).
// Mockup: ohvara/mockups/build-v2-portal-shell-today-inbounds-inb.html.

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
function Explainer({ id, title, steps, cols, part }) {
  const [open, setOpen] = useState(() => readOpen(id))
  useEffect(() => {
    try { if (localStorage.getItem(storeKey(id)) === null) write(id, 'closed') } catch { /* see write() */ }
  }, [id])
  return (
    <details className="ov-card pv-card pv-explain" open={open} onToggle={e => {
      const now = e.currentTarget.open
      if (now === open) return
      setOpen(now)
      write(id, now ? 'open' : 'closed')
    }}>
      <summary>
        <span className="pv-tile"><Ico icon={Info} size={20} /></span>
        <h3 className="pv-grow">{title}</h3>
        <span className="pv-tog"><span className="when-open">Hide</span><span className="when-closed">Show</span><Ico icon={ChevronDown} size={14} /></span>
      </summary>
      <div className={`pv-steps ${cols}`}>
        {steps.map(([b, p], i) => (
          <div className="pv-step" key={b}><span className="num">{i + 1}</span><div><b>{b}</b><p>{p}</p></div></div>
        ))}
      </div>
      <p className="pv-yourpart"><Ico icon={Check} /><span><b>Your part:</b> {part}</span></p>
    </details>
  )
}

function Card({ l, appt, evs, tz }) {
  const nx = nextLine(l, evs, tz)
  const NIcon = NEXT_ICON[nx.kind]
  const done = ['sold', 'follow_up', 'lost'].includes(l.inbound_stage)
  const st = stageOf(l)
  return (
    <Link className="ov-card ov-link pv-icard" to={`/agent/inbounds/${l.lead_id}`}>
      {done && <Pill tone={st.pill}>{st.label}</Pill>}
      <h4>{leadName(l)}</h4>
      <p className="pv-sub">{cardSub(l, appt, tz)}</p>
      {!done && <p className={`pv-next${nx.up ? ' up' : ''}`}><Ico icon={NIcon} size={14} />{nx.text}</p>}
      {l.inbound_stage === 'follow_up' && nx.kind === 'clock' && nx.text !== 'Follow up' && <p className="pv-next up"><Ico icon={Clock} size={14} />{nx.text}</p>}
    </Link>
  )
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
  return (
    <div className="pv-board" aria-label="Pipeline">
      {COLUMNS.map(c => {
        const rows = list.filter(l => c.stages.includes(l.inbound_stage || 'new'))
        return (
          <section key={c.key} className={`pv-col${rows.length ? '' : ' is-empty'}`}>
            <div className="pv-col-head"><i className={`pv-c-${c.tone}`} /><b>{c.title}</b><span className="pv-count-q tab">{rows.length}</span></div>
            <p className="pv-col-sub">{c.sub}</p>
            {rows.length ? rows.map(l => {
              const evs = evMap.get(l.lead_id)
              return <Card key={l.lead_id} l={l} appt={appointmentAt(evs)} evs={evs} tz={tz} />
            }) : <p className="pv-col-empty">Nobody here right now</p>}
          </section>
        )
      })}
    </div>
  )
}

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
        <section className="ov-card pv-card" aria-label="Live call log">
          <div className="pv-log-head"><span>When</span><span>Caller</span><span>What happened</span><span>Outcome</span><span /></div>
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

export default function Inbounds() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params] = useSearchParams()
  const tab = params.get('tab') === 'live' ? 'live' : 'booked'
  const inb = useInbounds()
  const ev = useInboundEvents()
  const evMap = useMemo(() => ev.data || new Map(), [ev.data])
  const list = inb.data || []
  const booked = list.filter(l => l.inbound_product === 'booked_appointment')
  const live = list.filter(l => l.inbound_product === 'live_call')

  return (
    <PortalV2Layout active="inbounds" title="Inbounds" icon={Inbox}>
      <div className="pv-ph1"><h1>Inbounds</h1><p className="pv-sub">Everyone who came in for you, and what we&rsquo;re doing with each one.</p></div>
      <nav className="pv-seg2" aria-label="Inbound type">
        <Link to="/agent/inbounds" className={tab === 'booked' ? 'on' : undefined} aria-current={tab === 'booked' ? 'page' : undefined}>
          Booked appointments <span className="n tab">{inb.isLoading ? ' ' : booked.length}</span>
        </Link>
        <Link to="/agent/inbounds?tab=live" className={tab === 'live' ? 'on' : undefined} aria-current={tab === 'live' ? 'page' : undefined}>
          Live calls <span className="n tab">{inb.isLoading ? ' ' : live.length}</span>
        </Link>
      </nav>

      {tab === 'booked' ? (
        <Explainer key="booked" id="booked" title="How booked appointments work" steps={BOOKED_STEPS} cols="six"
          part="show up to the appointment, then mark it Sold, Follow up or Not interested. Sold makes them your client and servicing starts." />
      ) : (
        <Explainer key="live" id="live" title="How live calls work" steps={LIVE_STEPS} cols="four"
          part="be active when you want live transfers, and mark each call Sold, Follow up or Not interested afterwards." />
      )}

      {inb.isLoading ? (
        <>
          {[0, 1].map(i => (
            <section key={i} className="ov-card pv-card" aria-busy="true"><Skel w="40%" h={14} /><Skel w="70%" h={12} style={{ marginTop: 10 }} /><Skel w="30%" h={12} style={{ marginTop: 10 }} /></section>
          ))}
        </>
      ) : inb.isError ? (
        <ErrorCard title="We couldn't load your inbounds" text="Nothing was lost. Check your connection and try again." onRetry={() => inb.refetch()} />
      ) : tab === 'booked' ? <Board list={booked} evMap={evMap} tz={tz} /> : <LiveLog list={live} evMap={evMap} tz={tz} />}
    </PortalV2Layout>
  )
}
