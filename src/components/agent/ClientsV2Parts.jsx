import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, ShieldCheck, ListChecks, Trash2, Phone, MessageSquareText, Users, ChevronLeft } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useIsPhone } from '../../hooks/usePhoneLayout'
import { useInbounds } from '../../hooks/useInbounds'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useServicingTasks, useClientPolicies, TASK_LABEL, TASK_STATUS, watchProgress } from '../../hooks/useServicingTasks'
import { ClientDrawer, StatusNote, Journey, LoadError } from './AgentUI'
import { CancellationFlow } from '../../pages/agent/Clients'
import { leadName, stateName, dateText, timeText, telHref } from '../../lib/inbounds'
import { fullName, money } from '../../lib/policyFormat'
import { agentStageOf, STAGE, placeOf, digits, useNow } from '../../lib/agentBookings'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import './clientsV2Parts.css'

// The v2 Clients page's own parts (portal parity T5), drawn in the old My Pipeline's cards and list
// style: one list of the people the agent sold (inbounds with outcome 'sold') and the clients they
// already had (their booked cancellations, useAgentBookings). A booking with the same phone as a sold
// inbound is that client's old policy, so it joins them instead of showing twice. A client opens in
// the old drawer with Call / Text, Policies, Servicing, the cancellation flow (the old page's own
// CancellationFlow, not a copy) and Consent. My Pipeline (pages/agent/Clients.jsx) renders
// MyPipelineClients for every agent; the old v2 page (pages/agent/v2/Clients.jsx) renders the same parts.
// Classes are .cv2-* (clientsV2Parts.css) on top of .ov-card / .ov-tile / .ov-range / .ov-input / .ov-ghost.

const CLIENT_FILTERS = [
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

// ── Data ─────────────────────────────────────────────────────────────────────
// Everything the parts read: sold inbounds + bookings + servicing tasks, merged, and their policies.
function useV2Clients() {
  const { profile } = useAuth()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const inb = useInbounds()
  const bk = useAgentBookings(profile?.id, { enabled: !!profile?.id })
  const tasks = useServicingTasks()
  const clients = useMemo(
    () => buildClients((inb.data || []).filter(l => l.outcome === 'sold'), bk.data || [], tasks.data || []),
    [inb.data, bk.data, tasks.data],
  )
  const pol = useClientPolicies(clients.flatMap(c => [c.newPolicyId, ...c.bookings.map(p => p.id)]))
  return {
    tz, clients, policies: pol.data, agentRows: bk.data || [],
    loading: inb.isLoading || bk.isLoading, error: inb.isError || bk.isError,
    refetch: () => { inb.refetch(); bk.refetch() },
    tasksError: tasks.isError, refetchTasks: () => tasks.refetch(),
  }
}

// Search (name, or 3+ digits of the phone) and the All / From inbounds / Existing filter.
function useClientFilter(clients) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const counts = {
    all: clients.length,
    inbound: clients.filter(c => c.source === 'inbound').length,
    existing: clients.filter(c => c.source === 'existing').length,
  }
  const q = query.trim().toLowerCase()
  const qd = digits(q)
  const shown = clients.filter(c => (filter === 'all' || c.source === filter)
    && (!q || c.name.toLowerCase().includes(q) || (qd.length >= 3 && digits(c.phone).includes(qd))))
  return { query, setQuery, filter, setFilter, counts, shown }
}

// ── List ─────────────────────────────────────────────────────────────────────
export function SourceChip({ c }) {
  return c.source === 'inbound' ? <span className="cv2-chip a">From an inbound</span> : <span className="cv2-chip">Existing</span>
}

export function ClientsV2Row({ c, on, tz, onOpen }) {
  const sub = [policyCount(c) ? plural(policyCount(c), 'policy', 'policies') : 'No policy on file yet', stateName(c.state)].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`cv2-row${on ? ' is-on' : ''}`} aria-current={on ? 'true' : undefined} onClick={() => onOpen(c.id)}>
      <span className={`cv2-av${c.source === 'existing' ? ' b' : ''}`} aria-hidden="true">{initials(c.name)}</span>
      <span className="cv2-grow">
        <span className="cv2-nm">{c.name}</span>
        <span className="cv2-sub">{sub}</span>
        <span className="cv2-nx">{nextLine(c, tz)}</span>
      </span>
      <span className="cv2-end">
        <SourceChip c={c} />
        {c.soldAt && <span className="cv2-sub">Sold {dateText(c.soldAt, tz)}</span>}
      </span>
    </button>
  )
}

// The "Your clients" box: title, search, filter and the merged list. Inside My Pipeline's right
// column (.cv2-col) its list scrolls inside the box when the page fills the screen.
export function ClientsV2Card({ data, activeId, onOpen, className = '' }) {
  const { tz, clients, loading, error, refetch } = data
  const f = useClientFilter(clients)
  let body
  if (error) body = <LoadError what="your clients" onRetry={refetch} />
  else if (loading) body = <p className="cv2-sub cv2-pad" role="status">Loading your clients…</p>
  else if (clients.length === 0) {
    body = (
      <div className="cv2-empty">
        <p className="cv2-sub">When you mark an inbound Sold, they show up here and servicing starts. Clients you already had show up once you book a cancellation for them.</p>
        <Link className="ov-ghost cv2-btn" to="/agent/book">Book a cancellation call</Link>
      </div>
    )
  } else if (f.shown.length === 0) body = <p className="cv2-sub cv2-pad">No clients match.</p>
  else body = <div className="cv2-list">{f.shown.map(c => <ClientsV2Row key={c.id} c={c} on={activeId === c.id} tz={tz} onOpen={onOpen} />)}</div>

  return (
    <section className={`ov-card cv2-card cv2-clients ${className}`} aria-label="Your clients">
      <div className="cv2-head">
        <span className="cv2-tile a" aria-hidden="true"><Users size={20} strokeWidth={2} /></span>
        <div className="cv2-grow">
          <h3 className="cv2-h3">Your clients</h3>
          <p className="cv2-sub">People you&rsquo;ve sold and the clients you already had</p>
        </div>
      </div>
      {!loading && !error && clients.length > 0 && (
        <div className="cv2-tools">
          <label className="ov-input cv2-search">
            <Search size={16} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
            <input type="search" value={f.query} onChange={e => f.setQuery(e.target.value)} placeholder="Find a client" aria-label="Find a client" />
          </label>
          <div className="ov-range cv2-range" role="group" aria-label="Show">
            {CLIENT_FILTERS.map(x => (
              <button key={x.key} type="button" className={f.filter === x.key ? 'is-on' : ''} aria-pressed={f.filter === x.key} onClick={() => f.setFilter(x.key)}>
                {x.label}<b>{f.counts[x.key]}</b>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cv2-body">{body}</div>
    </section>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────
function CardHead({ icon: Icon, tone, title, sub }) {
  return (
    <div className="cv2-head">
      <span className={`cv2-tile ${tone}`} aria-hidden="true"><Icon size={20} strokeWidth={2} /></span>
      <div className="cv2-grow"><h3 className="cv2-h3">{title}</h3><p className="cv2-sub">{sub}</p></div>
    </div>
  )
}

export function CallTextLinks({ c }) {
  const call = telHref(c.phone)
  if (!call) return null
  return (
    <div className="cv2-acts">
      <a className="ov-ghost cv2-btn" href={call}><Phone size={16} strokeWidth={2} aria-hidden="true" />Call</a>
      <a className="ov-ghost cv2-btn" href={call.replace('tel:', 'sms:')}><MessageSquareText size={16} strokeWidth={2} aria-hidden="true" />Text</a>
    </div>
  )
}

export function PoliciesCard({ c, policies, tz }) {
  const fresh = c.newPolicyId ? policies?.get(c.newPolicyId) : null
  const rows = []
  if (c.newPolicyId) rows.push({ key: c.newPolicyId, p: fresh, old: false })
  for (const b of c.bookings) rows.push({ key: b.id, p: { ...b, ...(policies?.get(b.id) || {}) }, old: true })
  const placed = p => p?.policy_sold_date || p?.effective_date
  return (
    <section className="ov-card cv2-card" aria-label="Policies">
      <CardHead icon={ShieldCheck} tone="a" title="Policies" sub={rows.length ? `${rows.length} on file` : 'None on file yet'} />
      {rows.length === 0 ? <p className="cv2-sub">No policy on file yet. It shows here once the sale is placed.</p> : (
        <div className="cv2-stack">
          {rows.map(({ key, p, old }) => {
            const done = old && agentStageOf(p) === 'cancelled'
            const title = [p?.carrier_name || p?.current_carrier || (old ? 'Old policy' : 'New policy'), p?.product_type].filter(Boolean).join(' · ')
            return (
              <div key={key} className="ov-tile cv2-pol">
                <div className="cv2-grow">
                  <h4 className="cv2-h4">{title}{old ? ' (old policy)' : ''}</h4>
                  <p className="cv2-sub">
                    {old ? (fresh || c.newPolicyId ? 'Replaced by the new policy' : `Cancellation booked ${dateText(p.created_at, tz)}`)
                      : placed(p) ? `Placed ${dateText(`${placed(p)}T12:00:00Z`, 'UTC')}` : 'Being placed'}
                  </p>
                </div>
                {old
                  ? <span className={`cv2-chip ${done ? 'done' : 'req'}`}>{done ? 'Cancelled' : 'Being cancelled'}</span>
                  : <span className="cv2-chip sch">{p?.status || 'Sold'}</span>}
                {(p?.monthly_premium != null || p?.effective_date) && (
                  <div className="cv2-nums">
                    {p.monthly_premium != null && <span>Premium <b className="cv2-mono">{money(p.monthly_premium)}</b>/mo</span>}
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

export function ServicingCard({ c, tz, now, tasksError, onRetry }) {
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
    <section className="ov-card cv2-card" aria-label="Servicing">
      <CardHead icon={ListChecks} tone="b" title="Servicing" sub="What Ohvara is doing for this client" />
      {tasksError ? (
        <div className="cv2-err" role="alert"><span>We couldn&rsquo;t load the servicing for this client.</span><button type="button" onClick={onRetry}>Try again</button></div>
      ) : (
        <>
          {w && (
            <div className="ov-tile cv2-watch">
              <div className="cv2-watch-top"><span>Chargeback watch</span>{w.end && <span className="cv2-sub">{w.done ? 'ended' : 'ends'} {new Date(w.end).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' })}</span>}</div>
              <div className="cv2-track" role="progressbar" aria-valuemin={0} aria-valuemax={w.months} aria-valuenow={w.month} aria-label={`Month ${w.month} of ${w.months}`}>
                <i style={{ width: `${(w.month / w.months) * 100}%` }} />
              </div>
              <p className="cv2-sub">{w.done ? 'The 12-month watch is over.' : `Month ${w.month} of ${w.months}. We watch every draft and step in if one fails.`}</p>
            </div>
          )}
          {rows.length > 0 ? (
            <div className="cv2-tasks">
              {rows.map(t => (
                <div key={t.id} className="cv2-task">
                  <div className="cv2-grow"><h4 className="cv2-h4">{TASK_LABEL[t.kind] || 'Servicing task'}</h4><p className="cv2-sub">{sub(t)}</p></div>
                  <span className={`cv2-chip ${TASK_STATUS[t.status].chip}`}>{TASK_STATUS[t.status].label}</span>
                </div>
              ))}
            </div>
          ) : !w && <p className="cv2-sub">Servicing starts once the policy is placed: packet check, review call and chargeback watch.</p>}
        </>
      )}
      <button type="button" className="cv2-soon" disabled aria-disabled="true">Request servicing &middot; Coming soon</button>
    </section>
  )
}

// The old page's cancellation flow for one booking, drawn inline.
function Cancellation({ p, now, startRebook, agentRows }) {
  return (
    <CancellationFlow p={p} now={now} canMove startRebook={startRebook} isAdmin={false} agentRows={agentRows} phone={false}>
      {flow => (
        <div className="cv2-cancel">
          {flow.moving ? flow.move.picker : (
            <>
              <StatusNote tab={flow.tab} live={flow.live && flow.stage === 'booked'}>{cap(flow.statusText)}</StatusNote>
              <Journey steps={flow.steps} tab={flow.tab} />
            </>
          )}
          {flow.footer}
          {!flow.moving && <button type="button" className="ov-ghost cv2-btn" onClick={flow.onMessage}>{flow.messageLabel}</button>}
        </div>
      )}
    </CancellationFlow>
  )
}

export function CancellationsCard({ c, now, startRebook, agentRows }) {
  return (
    <section className="ov-card cv2-card" aria-label="Cancellations">
      <CardHead icon={Trash2} tone="a" title="Cancellations" sub="Cancel the old policy once the new one is in force" />
      {c.bookings.length ? c.bookings.map(p => <Cancellation key={p.id} p={p} now={now} startRebook={startRebook} agentRows={agentRows} />) : (
        <>
          <p className="cv2-sub" style={{ marginBottom: 12 }}>Replacing an old policy? Book a call and Fulfillment cancels it with the carrier.</p>
          <Link className="ov-ghost cv2-btn" to="/agent/book">Book a cancellation call</Link>
        </>
      )}
    </section>
  )
}

export function ConsentCard() {
  return (
    <section className="ov-card cv2-card" aria-label="Consent">
      <div className="cv2-consent"><b>Consent</b>Consent wording goes here once Ohvara sets it.</div>
    </section>
  )
}

function clientSubLine(c, tz) {
  return c.source === 'inbound'
    ? [c.soldAt ? `Sold ${dateText(c.soldAt, tz)} from an inbound` : 'Sold from an inbound', c.place].filter(Boolean).join(' · ')
    : ['Existing client', c.place].filter(Boolean).join(' · ')
}

// Call / Text, Policies, Servicing, Cancellations and Consent for one client.
export function ClientV2Cards({ c, data, now, startRebook }) {
  return (
    <>
      <CallTextLinks c={c} />
      <PoliciesCard c={c} policies={data.policies} tz={data.tz} />
      <ServicingCard c={c} tz={data.tz} now={now} tasksError={data.tasksError} onRetry={data.refetchTasks} />
      <CancellationsCard c={c} now={now} startRebook={startRebook} agentRows={data.agentRows} />
      <ConsentCard />
    </>
  )
}

// One client in the old right-side drawer (a bottom-up sheet on phones; portaled to <body>).
export function ClientV2Drawer({ c, data, now, startRebook, onClose }) {
  return (
    <ClientDrawer name={c.name} meta={<><SourceChip c={c} /><span className="cv2-meta">{clientSubLine(c, data.tz)}</span></>} onClose={onClose}>
      <ClientV2Cards c={c} data={data} now={now} startRebook={startRebook} />
    </ClientDrawer>
  )
}

// ── Inside My Pipeline ───────────────────────────────────────────────────────
// The "Your clients" box plus its drawer. ?client=<lead or booking id> opens a client, so the old
// page's ?open= (a booking's drawer) keeps working as before.
export function MyPipelineClients({ className }) {
  const data = useV2Clients()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const openId = params.get('client')
  const open = openId ? data.clients.find(c => c.id === openId || c.bookings.some(p => p.id === openId)) : null
  const update = fn => setParams(prev => { const n = new URLSearchParams(prev); fn(n); return n }, { replace: true })
  const onOpen = id => update(n => { n.set('client', id); n.delete('open'); n.delete('rebook') })
  const onClose = () => update(n => { n.delete('client'); n.delete('rebook') })
  return (
    <>
      <ClientsV2Card data={data} activeId={open?.id} onOpen={onOpen} className={className} />
      {open && <ClientV2Drawer key={open.id} c={open} data={data} now={now} startRebook={params.get('rebook') === '1'} onClose={onClose} />}
    </>
  )
}

// ── The old v2 page's body ───────────────────────────────────────────────────
// The list and the picked client's detail beside it (on a phone, in place of it, with "All clients"
// to go back). ?open=<lead or booking id> picks the client. pages/agent/v2/Clients.jsx wraps this in
// the v2 shell.
export function ClientsV2Split({ gridClass, colClass, backClass, children }) {
  const now = useNow()
  const phone = useIsPhone()
  const [params, setParams] = useSearchParams()
  const data = useV2Clients()
  const openId = params.get('open')
  const open = data.clients.find(c => c.id === openId || c.bookings.some(p => p.id === openId)) || (!phone ? data.clients[0] : null) || null
  const openClient = id => setParams(prev => { const n = new URLSearchParams(prev); n.set('open', id); n.delete('rebook'); return n })
  const back = () => setParams(prev => { const n = new URLSearchParams(prev); n.delete('open'); n.delete('rebook'); return n })

  const detail = open && !data.error && !data.loading && (
    <div key={open.id} className="cv2-stack">
      {phone && <button type="button" className={backClass} onClick={back}><ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />All clients</button>}
      <section className="ov-card cv2-card" aria-label="Client">
        <div className="cv2-head" style={{ marginBottom: 0 }}>
          <span className={`cv2-av${open.source === 'existing' ? ' b' : ''}`} aria-hidden="true">{initials(open.name)}</span>
          <div className="cv2-grow"><h2 className="cv2-h3">{open.name}</h2><p className="cv2-sub">{clientSubLine(open, data.tz)}</p></div>
          <SourceChip c={open} />
        </div>
      </section>
      <ClientV2Cards c={open} data={data} now={now} startRebook={params.get('rebook') === '1'} />
    </div>
  )
  const phoneDetail = phone && !!detail
  return (
    <>
      {!phoneDetail && children}
      <div className={gridClass}>
        {!phoneDetail && <div className={colClass}><ClientsV2Card data={data} activeId={open?.id} onOpen={openClient} /></div>}
        {detail && <aside className={colClass} aria-label="Client detail">{detail}</aside>}
      </div>
    </>
  )
}
