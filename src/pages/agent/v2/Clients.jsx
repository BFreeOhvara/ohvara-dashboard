import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Users, Search, ShieldCheck, ListChecks, Trash2, ChevronLeft } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useInbounds } from '../../../hooks/useInbounds'
import { useAgentBookings } from '../../../hooks/useAgentBookings'
import { useServicingTasks, useClientPolicies, TASK_LABEL, TASK_STATUS, watchProgress } from '../../../hooks/useServicingTasks'
import { useIsPhone } from '../../../hooks/usePhoneLayout'
import { PortalV2Layout, Ico, Skel, ErrorCard } from '../../../components/agent/PortalV2Nav'
import { StatusNote, Journey } from '../../../components/agent/AgentUI'
import { CancellationFlow } from '../Clients'
import { leadName, stateName, dateText, timeText, telHref } from '../../../lib/portalV2'
import { fullName, money } from '../../../lib/policyFormat'
import { agentStageOf, STAGE, placeOf, digits, useNow } from '../../../lib/agentBookings'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'

// Clients (/agent/clients when the v2 portal is on): one list of the people the agent sold
// (inbounds with outcome 'sold') and the clients they already had (their booked cancellations,
// useAgentBookings). A booking with the same phone as a sold inbound is that client's old policy,
// so it joins them instead of showing twice. The detail shows policies, servicing_tasks and the
// cancellation flow, which is the old page's own (CancellationFlow from ../Clients, with
// AgentUI's StatusNote and Journey), not a copy. Mockup: ohvara/mockups/build-calendar-clients-and-plan-billing-.html.

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'inbound', label: 'From inbounds' },
  { key: 'existing', label: 'Existing' },
]
const phone10 = raw => digits(raw).slice(-10)
const initials = name => (name || '').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const cap = s => s[0].toUpperCase() + s.slice(1)

function buildClients(sold, bookings, tasks) {
  const used = new Set()
  const out = []
  for (const l of sold) {
    const ph = phone10(l.phone)
    const old = ph.length === 10 ? bookings.filter(p => phone10(p.client_phone) === ph) : []
    old.forEach(p => used.add(p.id))
    const ids = new Set(old.map(p => p.id))
    out.push({
      id: l.lead_id, source: 'inbound', name: leadName(l), phone: l.phone, state: l.state,
      place: [l.city, l.state].filter(Boolean).join(', '), soldAt: l.outcome_at, newPolicyId: l.client_policy_id, bookings: old,
      tasks: tasks.filter(t => t.lead_id === l.lead_id || (t.policy_id && (t.policy_id === l.client_policy_id || ids.has(t.policy_id)))),
    })
  }
  for (const p of bookings) {
    if (used.has(p.id)) continue
    out.push({
      id: p.id, source: 'existing', name: fullName(p), phone: p.client_phone, state: p.state, place: placeOf(p),
      soldAt: null, newPolicyId: null, bookings: [p], tasks: tasks.filter(t => t.policy_id === p.id),
    })
  }
  return out
}

const policyCount = c => (c.newPolicyId ? 1 : 0) + c.bookings.length
const openTasks = c => c.tasks.filter(t => t.kind !== 'chargeback_watch' && t.status !== 'done')
  .sort((a, b) => (a.status === 'scheduled' ? 0 : 1) - (b.status === 'scheduled' ? 0 : 1) || new Date(a.due_at || a.created_at) - new Date(b.due_at || b.created_at))

function nextLine(c, tz) {
  const t = openTasks(c)[0]
  if (t?.status === 'scheduled') return `Next: ${TASK_LABEL[t.kind]}${t.due_at ? `, ${dateText(t.due_at, tz)}` : ''}`
  if (t) return `${TASK_LABEL[t.kind]} requested`
  const b = c.bookings.find(p => agentStageOf(p) !== 'cancelled')
  if (b) {
    const s = agentStageOf(b)
    return s === 'booked' && b.scheduled_call_at ? `Cancellation call booked, ${dateText(b.scheduled_call_at, tz)}` : `Cancellation: ${STAGE[s].label.toLowerCase()}`
  }
  return 'Nothing open'
}

// ── List ─────────────────────────────────────────────────────────────────────
function ClientRow({ c, on, tz, onOpen }) {
  const sub = [policyCount(c) ? plural(policyCount(c), 'policy', 'policies') : 'No policy on file yet', stateName(c.state)].filter(Boolean).join(' · ')
  return (
    <Link to={`?open=${c.id}`} className={`pv-crow${on ? ' on' : ''}`} aria-current={on ? 'true' : undefined} onClick={e => { e.preventDefault(); onOpen(c.id) }}>
      <span className={`pv-cav${c.source === 'existing' ? ' b' : ''}`} aria-hidden="true">{initials(c.name)}</span>
      <div className="pv-grow">
        <h4>{c.name}</h4>
        <p className="pv-sub">{sub}</p>
        <p className="nx">{nextLine(c, tz)}</p>
      </div>
      <div className="r">
        {c.source === 'inbound' ? <span className="pv-chip a">From an inbound</span> : <span className="pv-chip">Existing</span>}
        {c.soldAt && <span className="pv-sub">Sold {dateText(c.soldAt, tz)}</span>}
      </div>
    </Link>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────
function Policies({ c, policies, tz }) {
  const fresh = c.newPolicyId ? policies?.get(c.newPolicyId) : null
  const rows = []
  if (c.newPolicyId) rows.push({ key: c.newPolicyId, p: fresh, old: false })
  for (const b of c.bookings) rows.push({ key: b.id, p: { ...b, ...(policies?.get(b.id) || {}) }, old: true })
  const placed = p => p?.policy_sold_date || p?.effective_date
  return (
    <section className="ov-card pv-card" aria-label="Policies">
      <div className="pv-card-head">
        <span className="pv-tile a"><Ico icon={ShieldCheck} size={20} /></span>
        <div className="pv-grow"><h3>Policies</h3><p className="pv-sub">{rows.length ? `${rows.length} on file` : 'None on file yet'}</p></div>
      </div>
      {rows.length === 0 ? <p className="pv-sub">No policy on file yet. It shows here once the sale is placed.</p> : (
        <div className="pv-pol">
          {rows.map(({ key, p, old }) => {
            const done = old && agentStageOf(p) === 'cancelled'
            const title = [p?.carrier_name || p?.current_carrier || (old ? 'Old policy' : 'New policy'), p?.product_type].filter(Boolean).join(' · ')
            return (
              <div key={key} className="pv-pol-row">
                <div className="pv-grow">
                  <h4>{title}{old ? ' (old policy)' : ''}</h4>
                  <p className="pv-sub">
                    {old ? (fresh || c.newPolicyId ? 'Replaced by the new policy' : `Cancellation booked ${dateText(p.created_at, tz)}`)
                      : placed(p) ? `Placed ${dateText(`${placed(p)}T12:00:00Z`, 'UTC')}` : 'Being placed'}
                  </p>
                </div>
                {old
                  ? <span className={`pv-chip ${done ? 'done' : 'req'}`}>{done ? 'Cancelled' : 'Being cancelled'}</span>
                  : <span className="pv-chip sch">{p?.status || 'Sold'}</span>}
                {(p?.monthly_premium != null || p?.effective_date) && (
                  <div className="nums">
                    {p.monthly_premium != null && <span>Premium <b className="mono">{money(p.monthly_premium)}</b>/mo</span>}
                    {p.effective_date && <span>Effective <b>{dateText(`${p.effective_date}T12:00:00Z`, 'UTC')}</b></span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Servicing({ c, tz, now, tasksError, onRetry }) {
  const watch = c.tasks.find(t => t.kind === 'chargeback_watch')
  const w = watch && watchProgress(watch, now)
  const rank = { scheduled: 0, requested: 1, done: 2 }
  const rows = c.tasks.filter(t => t.kind !== 'chargeback_watch' && TASK_STATUS[t.status])
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === 'done'
      ? new Date(b.done_at || b.due_at || b.created_at) - new Date(a.done_at || a.due_at || a.created_at)
      : new Date(a.due_at || a.created_at) - new Date(b.due_at || b.created_at)))
  const sub = t => {
    const note = t.note ? ` · ${t.note}` : ''
    if (t.status === 'done') return `${t.done_at || t.due_at ? dateText(t.done_at || t.due_at, tz) : 'Done'}${note}`
    if (t.status === 'scheduled') return `${t.due_at ? `${dateText(t.due_at, tz)}, ${timeText(t.due_at, tz)}` : 'Scheduled'}${note}`
    return `Asked ${dateText(t.created_at, tz)}${note}`
  }
  return (
    <section className="ov-card pv-card" aria-label="Servicing">
      <div className="pv-card-head">
        <span className="pv-tile b"><Ico icon={ListChecks} size={20} /></span>
        <div className="pv-grow"><h3>Servicing</h3><p className="pv-sub">What Ohvara is doing for this client</p></div>
      </div>
      {tasksError ? (
        <div className="pv-inline-err" role="alert"><span>We couldn&rsquo;t load the servicing for this client.</span><button type="button" onClick={onRetry}>Try again</button></div>
      ) : (
        <>
          {w && (
            <div className="pv-watch">
              <div className="top"><span>Chargeback watch</span>{w.end && <span className="pv-sub">{w.done ? 'ended' : 'ends'} {new Date(w.end).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })}</span>}</div>
              <div className="pv-track" role="progressbar" aria-valuemin={0} aria-valuemax={w.months} aria-valuenow={w.month} aria-label={`Month ${w.month} of ${w.months}`}>
                <i style={{ width: `${(w.month / w.months) * 100}%` }} />
              </div>
              <p className="pv-sub">{w.done ? 'The 12-month watch is over.' : `Month ${w.month} of ${w.months}. We watch every draft and step in if one fails.`}</p>
            </div>
          )}
          {rows.length > 0 ? (
            <div className="pv-tasks">
              {rows.map(t => (
                <div key={t.id} className="pv-task">
                  <div className="pv-grow"><h4>{TASK_LABEL[t.kind] || 'Servicing task'}</h4><p className="pv-sub">{sub(t)}</p></div>
                  <span className={`pv-chip ${TASK_STATUS[t.status].chip}`}>{TASK_STATUS[t.status].label}</span>
                </div>
              ))}
            </div>
          ) : !w && <p className="pv-sub">Servicing starts once the policy is placed: packet check, review call and chargeback watch.</p>}
        </>
      )}
      <div className="pv-soon-row"><button type="button" className="pv-soon" disabled aria-disabled="true">Request servicing &middot; Coming soon</button></div>
    </section>
  )
}

// The old page's cancellation flow for one booking, drawn inline.
function Cancellation({ p, now, startRebook, agentRows }) {
  return (
    <CancellationFlow p={p} now={now} canMove startRebook={startRebook} isAdmin={false} agentRows={agentRows} phone={false}>
      {flow => (
        <div className="pv-cancel">
          {flow.moving ? flow.move.picker : (
            <>
              <StatusNote tab={flow.tab} live={flow.live && flow.stage === 'booked'}>{cap(flow.statusText)}</StatusNote>
              <Journey steps={flow.steps} tab={flow.tab} />
            </>
          )}
          {flow.footer}
          {!flow.moving && <button type="button" className="ov-ghost pv-btn" onClick={flow.onMessage}>{flow.messageLabel}</button>}
        </div>
      )}
    </CancellationFlow>
  )
}

function Cancellations({ c, now, startRebook, agentRows }) {
  return (
    <section className="ov-card pv-card" aria-label="Cancellations">
      <div className="pv-card-head">
        <span className="pv-tile a"><Ico icon={Trash2} size={20} /></span>
        <div className="pv-grow"><h3>Cancellations</h3><p className="pv-sub">Cancel the old policy once the new one is in force</p></div>
      </div>
      {c.bookings.length ? c.bookings.map(p => <Cancellation key={p.id} p={p} now={now} startRebook={startRebook} agentRows={agentRows} />) : (
        <>
          <p className="pv-sub" style={{ marginBottom: 12 }}>Replacing an old policy? Book a call and Fulfillment cancels it with the carrier.</p>
          <Link className="ov-hero-btn pv-btn-hero" to="/agent/book">Book a cancellation call</Link>
        </>
      )}
    </section>
  )
}

function Detail({ c, tz, now, policies, tasksError, onRetryTasks, startRebook, agentRows, onBack }) {
  const call = telHref(c.phone)
  const sms = call ? call.replace('tel:', 'sms:') : null
  const sub = c.source === 'inbound'
    ? [c.soldAt ? `Sold ${dateText(c.soldAt, tz)} from an inbound` : 'Sold from an inbound', c.place].filter(Boolean).join(' · ')
    : ['Existing client', c.place].filter(Boolean).join(' · ')
  return (
    <>
      {onBack && <button type="button" className="pv-back" onClick={onBack}><Ico icon={ChevronLeft} size={16} />All clients</button>}
      <section className="ov-card pv-card" aria-label="Client">
        <div className="pv-det-h">
          <span className={`pv-cav lg${c.source === 'existing' ? ' b' : ''}`} aria-hidden="true">{initials(c.name)}</span>
          <div className="pv-grow"><h2>{c.name}</h2><p className="pv-sub">{sub}</p></div>
        </div>
        {call && <div className="pv-acts2"><a className="ov-ghost pv-btn" href={call}>Call</a><a className="ov-ghost pv-btn" href={sms}>Text</a></div>}
      </section>
      <Policies c={c} policies={policies} tz={tz} />
      <Servicing c={c} tz={tz} now={now} tasksError={tasksError} onRetry={onRetryTasks} />
      <Cancellations c={c} now={now} startRebook={startRebook} agentRows={agentRows} />
      <section className="ov-card pv-card" aria-label="Consent">
        <div className="pv-consent"><b>Consent</b>Consent wording goes here once Ohvara sets it.</div>
      </section>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function Clients() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const now = useNow()
  const phone = useIsPhone()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const inb = useInbounds()
  const bk = useAgentBookings(profile?.id, { enabled: !!profile?.id })
  const tasks = useServicingTasks()
  const clients = useMemo(
    () => buildClients((inb.data || []).filter(l => l.outcome === 'sold'), bk.data || [], tasks.data || []),
    [inb.data, bk.data, tasks.data],
  )
  const pol = useClientPolicies(clients.flatMap(c => [c.newPolicyId, ...c.bookings.map(p => p.id)]))

  const counts = { all: clients.length, inbound: clients.filter(c => c.source === 'inbound').length, existing: clients.filter(c => c.source === 'existing').length }
  const q = query.trim().toLowerCase()
  const qd = digits(q)
  const shown = clients.filter(c => (filter === 'all' || c.source === filter)
    && (!q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && digits(c.phone).includes(qd))))

  const openId = params.get('open')
  const open = clients.find(c => c.id === openId || c.bookings.some(p => p.id === openId)) || (!phone ? shown[0] : null) || null
  const openClient = id => setParams(prev => { const n = new URLSearchParams(prev); n.set('open', id); n.delete('rebook'); return n })
  const back = () => setParams(prev => { const n = new URLSearchParams(prev); n.delete('open'); n.delete('rebook'); return n })
  const loading = inb.isLoading || bk.isLoading
  const error = inb.isError || bk.isError

  let list
  if (error) {
    list = <ErrorCard title="We couldn't load your clients" text="Nothing was changed. Try again in a moment." onRetry={() => { inb.refetch(); bk.refetch() }} />
  } else if (loading) {
    list = (
      <section className="ov-card pv-card" aria-busy="true">
        <Skel w="100%" h={44} style={{ borderRadius: 999 }} />
        {[60, 50].map(w => (
          <div key={w} style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}>
            <Skel w={40} h={40} style={{ borderRadius: '50%' }} />
            <span className="pv-grow"><Skel w={`${w}%`} h={16} /><Skel w={`${w - 20}%`} h={12} style={{ marginTop: 6 }} /></span>
          </div>
        ))}
      </section>
    )
  } else if (clients.length === 0) {
    list = (
      <section className="ov-card pv-card pv-empty">
        <h3>No clients yet</h3>
        <p className="pv-sub">When you mark an inbound Sold, they show up here and servicing starts. Clients you already had show up once you book a cancellation for them.</p>
        <Link className="ov-ghost pv-btn" to="/agent/book">Book a cancellation call</Link>
      </section>
    )
  } else {
    list = (
      <section className="ov-card pv-card" aria-label="Your clients">
        <div className="pv-searchrow">
          <label className="pv-field"><Ico icon={Search} size={16} /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a client" aria-label="Find a client" /></label>
          <div className="pv-seg full" role="group" aria-label="Show">
            {FILTERS.map(f => (
              <button key={f.key} type="button" className={filter === f.key ? 'on' : undefined} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}<b className="tab">{counts[f.key]}</b>
              </button>
            ))}
          </div>
        </div>
        {shown.length ? (
          <div className="pv-clist">
            {shown.map(c => <ClientRow key={c.id} c={c} on={open?.id === c.id} tz={tz} onOpen={openClient} />)}
          </div>
        ) : <p className="pv-sub" style={{ padding: '12px 4px' }}>No clients match.</p>}
      </section>
    )
  }

  const detail = open && !error && !loading && (
    <Detail
      key={open.id} c={open} tz={tz} now={now} policies={pol.data} tasksError={tasks.isError} onRetryTasks={() => tasks.refetch()}
      startRebook={params.get('rebook') === '1'} agentRows={bk.data || []} onBack={phone ? back : null}
    />
  )
  const phoneDetail = phone && !!detail

  return (
    <PortalV2Layout active="clients" title="Clients" icon={Users}>
      {!phoneDetail && (
        <div className="pv-ph1"><h1>Clients</h1><p className="pv-sub">People you&rsquo;ve sold and the clients you already had. We help keep their policies on the books.</p></div>
      )}
      <div className="pv-grid2 cli">
        {!phoneDetail && <div className="pv-col2">{list}</div>}
        {detail && <aside className="pv-col2" aria-label="Client detail">{detail}</aside>}
      </div>
    </PortalV2Layout>
  )
}
