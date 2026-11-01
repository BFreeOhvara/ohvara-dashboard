import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, Check, ShieldCheck, ClipboardList } from 'lucide-react'
import { LoadError } from '../../components/agent/AgentUI'
import {
  useV2Clients, SourceChip, CallTextLinks, RequestLink, ConsentCard, clientZoneOf, nextLine, initials,
} from '../../components/agent/ClientsV2Parts'
import { ContactLogCard, TeamThreadCard, ClientActivityCard } from '../../components/agent/ClientPageLog'
import { useClientTimezone } from '../../hooks/useClientTimezone'
import { TASK_LABEL, TASK_STATUS, watchProgress } from '../../hooks/useServicingTasks'
import { dateText } from '../../lib/inbounds'
import { money } from '../../lib/policyFormat'
import { agentStageOf, STAGE, useNow } from '../../lib/agentBookings'
import { formatDual } from '../../lib/timezones'
import '../../components/agent/clientsV2Parts.css'

// One client's page (/agent/clients/:clientId): who they are, one card per policy with its servicing
// timeline, open requests, every text and call, the team thread, activity and the stored text consent.
// :clientId is the id My Pipeline's ?client= takes (a sold lead's id or a booking id). Composed from
// useV2Clients (inbounds + bookings + servicing tasks + policies); the log cards read their own data.
// Times are the agent's zone with the client's beside them (formatDual). Layout is .cv2p-* in clientsV2Parts.css.

const BEST = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }
// A client's own steps, in the order they happen. Anything else is a request the agent asked for.
const STEP_ORDER = ['packet_check', 'review_call', 'chargeback_watch', 'annual_review']
const isStep = t => STEP_ORDER.includes(t.kind)
const stepRank = t => { const i = STEP_ORDER.indexOf(t.kind); return i < 0 ? 1.5 : i }
const byTime = (a, b) => new Date(a.done_at || a.due_at || a.created_at) - new Date(b.done_at || b.due_at || b.created_at)
const day = d => dateText(`${d}T12:00:00Z`, 'UTC')

function Skeleton() {
  return (
    <div className="cv2p-grid" aria-busy="true" aria-label="Loading the client">
      {[0, 1, 2].map(i => (
        <div key={i} className="ov-card cv2-card cv2p-skel">
          {[70, 45, 60].map(w => <span key={w} className="ov-skel" style={{ width: `${w}%`, height: 14 }} />)}
        </div>
      ))}
    </div>
  )
}

function NotFound() {
  return (
    <section className="ov-card cv2-card cv2p-gone" aria-label="Client not found">
      <h2 className="cv2-h3">Client not found</h2>
      <p className="cv2-sub">This client isn’t on your list.</p>
      <Link className="ov-ghost cv2-btn" to="/agent/clients"><ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />Back to Clients</Link>
    </section>
  )
}

// One servicing step: done (check), the next one (filled dot) or still to come (hollow).
function Step({ t, next, tz, clientTz, w }) {
  const done = t.status === 'done'
  const iso = done ? t.done_at || t.due_at : t.due_at
  // The watch and the annual review land a year out: a date with the year, no clock time.
  const far = !done && (t.kind === 'chargeback_watch' || t.kind === 'annual_review')
  const farText = iso && new Date(iso).toLocaleDateString('en-US', { timeZone: tz, ...(t.kind === 'chargeback_watch' ? { month: 'short', day: 'numeric' } : { month: 'short' }), year: 'numeric' })
  const when = iso && !far ? formatDual(iso, tz, clientTz) : ''
  const status = TASK_STATUS[t.status]
  return (
    <li className={`cv2p-step${next ? ' is-next' : ''}${done ? ' is-done' : ''}`}>
      <span className="cv2p-mark" aria-hidden="true">{done ? <Check size={12} strokeWidth={3} /> : <i />}</span>
      <div className="cv2-grow">
        <div className="cv2p-steptop">
          <span className="cv2-h4">{TASK_LABEL[t.kind] || 'Servicing task'}</span>
          <span className="cv2-sub">{done ? `Done ${iso ? dateText(iso, tz) : ''}`.trim() : far && iso ? `${t.kind === 'chargeback_watch' ? 'Ends ' : ''}${farText}` : iso ? dateText(iso, tz) : status?.label || 'To come'}</span>
        </div>
        {(when || t.note) && <span className="cv2-sub">{[when, t.note].filter(Boolean).join(' · ')}</span>}
        {w && (
          <>
            <div className="cv2p-seg" role="progressbar" aria-valuemin={0} aria-valuemax={w.months} aria-valuenow={w.month} aria-label={`Month ${w.month} of ${w.months}`}>
              {Array.from({ length: w.months }, (_, i) => <i key={i} className={i < w.month ? 'on' : ''} />)}
            </div>
            <span className="cv2-sub">{w.done ? 'The 12-month watch is over.' : `Month ${w.month} of ${w.months}. We check every draft.`}</span>
          </>
        )}
      </div>
    </li>
  )
}

function PolicyCard({ title, number, premium, facts, tasks, tz, clientTz, now, line }) {
  const steps = tasks.filter(isStep).concat(tasks.filter(t => !isStep(t) && t.status === 'done'))
    .sort((a, b) => stepRank(a) - stepRank(b) || byTime(a, b))
  const nextId = steps.find(t => t.status !== 'done')?.id
  return (
    <section className="ov-card cv2-card cv2p-pol" aria-label={title}>
      <div className="cv2-head">
        <span className="cv2-tile a" aria-hidden="true"><ShieldCheck size={20} strokeWidth={2} /></span>
        <div className="cv2-grow"><h3 className="cv2-h3">{title}</h3>{number && <p className="cv2-sub">Policy {number}</p>}</div>
        {premium != null && <span className="cv2p-prem cv2-mono">{money(premium)}<small>/mo</small></span>}
      </div>
      {facts.length > 0 && (
        <dl className="ov-tile cv2p-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {line && <p className="cv2-sub cv2p-line">{line}</p>}
      {steps.length > 0 && (
        <ol className="cv2p-steps">
          {steps.map(t => (
            <Step key={t.id} t={t} next={t.id === nextId} tz={tz} clientTz={clientTz}
              w={t.kind === 'chargeback_watch' ? watchProgress(t, now) : null} />
          ))}
        </ol>
      )}
    </section>
  )
}

function OpenRequests({ tasks, tz, clientTz }) {
  return (
    <section className="ov-card cv2-card" aria-label="Open requests">
      <div className="cv2-head">
        <span className="cv2-tile b" aria-hidden="true"><ClipboardList size={20} strokeWidth={2} /></span>
        <div className="cv2-grow"><h3 className="cv2-h3">Open requests</h3></div>
      </div>
      {tasks.length === 0 ? <p className="cv2-sub">None right now. A request doesn’t use a submission.</p> : (
        <div className="cv2-tasks">
          {tasks.map(t => {
            const s = TASK_STATUS[t.status]
            const sub = t.due_at && t.status !== 'requested'
              ? `${dateText(t.due_at, tz)} · ${formatDual(t.due_at, tz, clientTz)}` : `Asked ${dateText(t.created_at, tz)}`
            return (
              <div key={t.id} className="cv2-task">
                <div className="cv2-grow"><h4 className="cv2-h4">{TASK_LABEL[t.kind] || 'Servicing task'}</h4><p className="cv2-sub">{[sub, t.note].filter(Boolean).join(' · ')}</p></div>
                {s && <span className={`cv2-chip ${s.chip}`}>{s.label}</span>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function ClientPage() {
  const { clientId } = useParams()
  const data = useV2Clients()
  const now = useNow()
  const c = data.clients.find(x => x.id === clientId || x.bookings.some(p => p.id === clientId))
  // Hooks stay above the early returns. A split state's zone is looked up from the city.
  const looked = useClientTimezone(c?.city || '', c?.state || '')
  const { tz } = data

  const back = (
    <Link className="ov-ghost cv2-btn" to="/agent/clients"><ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />Clients</Link>
  )
  if (data.error) return <LoadError what="this client" onRetry={data.refetch} />
  if (data.loading || (c && data.detailLoading)) return <Skeleton />
  if (!c) return <NotFound />

  const clientTz = clientZoneOf(c, looked.tz)
  const policies = data.policies
  const newest = c.newPolicyId ? policies?.get(c.newPolicyId) : null
  const bookings = [...c.bookings].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const best = BEST[bookings.find(b => b.best_time)?.best_time]
  const forPolicy = id => c.tasks.filter(t => t.policy_id === id)
  // A task with only the lead's id belongs to the policy the lead became.
  const leadOnly = c.tasks.filter(t => !t.policy_id)
  const requests = c.tasks.filter(t => !isStep(t) && t.status !== 'done' && TASK_STATUS[t.status])
  const watch = c.tasks.find(t => t.kind === 'chargeback_watch')
  const w = watch && watchProgress(watch, now)
  const chip = w && !w.done ? `Protected · month ${w.month} of ${w.months}` : c.newPolicyId ? 'Setting up' : null

  const cards = []
  if (c.newPolicyId) {
    const old = bookings[0]
    cards.push(
      <PolicyCard key={c.newPolicyId}
        title={[newest?.carrier_name || 'New policy', newest?.product_type].filter(Boolean).join(' ')}
        number={newest?.policy_number} premium={newest?.monthly_premium}
        facts={[
          newest?.effective_date && ['Effective', day(newest.effective_date)],
          (newest?.policy_sold_date) && ['Placed', day(newest.policy_sold_date)],
          old && ['Replaced', [old.current_carrier || old.carrier_name, old.policy_number].filter(Boolean).join(' ') || 'Old policy'],
        ].filter(Boolean)}
        tasks={[...forPolicy(c.newPolicyId), ...leadOnly]} tz={tz} clientTz={clientTz} now={now}
        line={newest ? null : 'Being placed. The steps show here once the policy is in.'} />,
    )
  }
  for (const b of bookings) {
    const p = { ...b, ...(policies?.get(b.id) || {}) }
    const s = agentStageOf(p)
    const call = p.scheduled_call_at && s !== 'cancelled'
      ? `Cancellation call booked, ${dateText(p.scheduled_call_at, tz)} · ${formatDual(p.scheduled_call_at, tz, clientTz)}`
      : `Cancellation: ${STAGE[s].label.toLowerCase()}`
    cards.push(
      <PolicyCard key={b.id}
        title={[p.carrier_name || p.current_carrier || 'Old policy', p.product_type].filter(Boolean).join(' ') + (c.newPolicyId ? ' (old policy)' : '')}
        number={p.policy_number} premium={p.monthly_premium}
        facts={[p.effective_date && ['Effective', day(p.effective_date)], ['Booked', dateText(p.created_at, tz)]].filter(Boolean)}
        tasks={c.newPolicyId ? [] : forPolicy(b.id)} tz={tz} clientTz={clientTz} now={now} line={call} />,
    )
  }

  const ids = [c.newPolicyId, ...bookings.map(b => b.id)].filter(Boolean)
  const logPolicies = ids.map(id => (id === c.newPolicyId ? { id, ...(newest || {}) } : { id, ...bookings.find(b => b.id === id), ...(policies?.get(id) || {}) }))
  const place = c.place

  return (
    <div className="cv2p">
      <section className="ov-card cv2-card cv2p-head" aria-label="Client">
        <div className="cv2p-who">
          <div className="cv2p-back">{back}</div>
          <span className={`cv2-av${c.source === 'existing' ? ' b' : ''}`} aria-hidden="true">{initials(c.name)}</span>
          <div className="cv2-grow">
            <h2 className="cv2p-name">{c.name}</h2>
            <p className="cv2p-meta">
              <SourceChip c={c} />
              {chip && <span className="cv2-chip sch">{chip}</span>}
              <span className="cv2-sub">{nextLine(c, tz)}</span>
            </p>
          </div>
        </div>
        <div className="cv2p-info">
          <div><span className="cv2-sub">Phone{place ? ` · ${place}` : ''}</span><b>{c.phone || 'No number'}</b></div>
          {best && <div><span className="cv2-sub">Best time</span><b>{best}</b></div>}
        </div>
        <div className="cv2p-acts">
          <CallTextLinks c={c} />
          <RequestLink c={c} className="ov-primary cv2p-request" />
        </div>
      </section>

      {data.tasksError && <LoadError what="the servicing for this client" onRetry={data.refetchTasks} />}
      {data.policiesError && <LoadError what="this client’s policies" onRetry={data.refetchPolicies} />}

      <div className="cv2p-grid">
        <div className="cv2p-col">{cards.length ? cards : (
          <section className="ov-card cv2-card" aria-label="Policies">
            <h3 className="cv2-h3">No policy on file yet</h3>
            <p className="cv2-sub">It shows here once the sale is placed.</p>
          </section>
        )}</div>
        <div className="cv2p-col">
          <OpenRequests tasks={requests} tz={tz} clientTz={clientTz} />
          <ContactLogCard policyIds={ids} leadId={c.source === 'inbound' ? c.id : null} tz={tz} clientTz={clientTz} />
          <ClientActivityCard policyIds={ids} tz={tz} clientTz={clientTz} />
        </div>
        <div className="cv2p-col cv2p-col3">
          <TeamThreadCard policies={logPolicies} tz={tz} />
          <ConsentCard c={c} policies={policies} tz={tz} clientTz={clientTz} />
        </div>
      </div>
    </div>
  )
}
