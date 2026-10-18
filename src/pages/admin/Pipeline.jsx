import { useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Users, MapPin, Lock } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useAllProfiles } from '../../hooks/useProfiles'
import { dmId } from '../../hooks/useDirectMessages'
import {
  ClientSearch, PipelineSummary, PipelineList, ClientDrawer, InfoTile, StatusNote, Journey, OvSelect, LoadError,
} from '../../components/agent/AgentUI'
import { attentionReason } from '../../lib/fulfillmentFlags'
import { whenShort } from '../../lib/fulfillmentDay'
import { callWhen } from '../../lib/scheduling'
import { isLive, stageOf, fulfillTabOf, RANGES, useNow, startOfWeek, startOfMonth, placeOf } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'

// Admin Pipeline (Prompt 759) — everyone's pipelines put together, view only.
// Same components as the agent's My Pipeline and the Fulfillment Pipeline,
// switched with props: "Find any client" with everyone's latest activity,
// "Everyone's pipeline" (total, agent filter, range, bar, four status rows, the
// View only note), and one list with four tabs. Needs attention comes first and
// is selected by default; it's the lib/fulfillmentFlags.js rules (past call
// time, stuck, a call left open), and a flagged row sits only there, so the four
// tabs add up to the total. A row opens the client read-only.
//
// ?agent=<id> narrows the whole page (Users links here with it, P762); ?stage=,
// ?range= and ?open= work like the other two Pipelines. Times are the admin's zone.
//
// The server enforces view only (migration 141): admin can read every client
// but not change a status, booking or detail unless it's their own booking.

const TABS = ['needs', 'booked', 'noAnswer', 'cancelled']
const MEANINGS = { needs: 'Stuck or overdue', booked: 'Waiting for Fulfillment’s call', noAnswer: 'Being retried', cancelled: 'Old policy cancelled' }
const RANGE_VALUES = RANGES.map(r => r.value)
// Old ?stage= values (the agent page's) land on their admin tab.
const STAGE_ALIAS = { all: 'needs', attention: 'needs', needsAttention: 'needs', confirmNumber: 'needs', inProgress: 'booked' }

// Why a row needs attention, or null when it doesn't.
const reasonOf = attentionReason

const byCall = (a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')
const SORT = {
  needs: byCall,
  booked: byCall,
  noAnswer: byCall,
  cancelled: (a, b) => (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || ''),
}

// "Jordan R."
const shortName = name => {
  const [first, ...rest] = String(name || '').trim().split(/\s+/)
  const last = rest.pop()
  return first ? `${first}${last ? ` ${last[0]}.` : ''}` : 'Unknown'
}
// A client's newest change and when: cancelled, a call, or the booking.
function lastChange(p) {
  if (stageOf(p) === 'cancelled') return { at: p.fulfillment_completed_at || p.updated_at, label: 'Cancelled' }
  if (isLive(p)) return { at: p.call_live_since, label: 'On a call' }
  if (p.last_call_at && p.last_call_at > (p.created_at || '')) return { at: p.last_call_at, label: stageOf(p) === 'noAnswer' ? 'No answer' : 'Called' }
  return { at: p.created_at, label: 'Booked' }
}
const lower = s => s.replace(/^(Today|Tomorrow|Yesterday)/, w => w.toLowerCase())

export default function AdminPipeline() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')

  const { data: raw = [], isLoading, isError, refetch } = useAgentBookings(null)
  // P780 — a failed load says so instead of "0 clients".
  const failed = isError && !raw.length
  const { data: profiles = [] } = useAllProfiles()
  const rows = useMemo(() => excludeTestAccounts(raw, profile?.id), [raw, profile?.id])

  const agentId = params.get('agent') || ''
  const stageParam = params.get('stage')
  const tab = TABS.includes(stageParam) ? stageParam : STAGE_ALIAS[stageParam] || 'needs'
  const range = RANGE_VALUES.includes(params.get('range')) ? params.get('range') : 'all'
  const update = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const setParam = (key, value, fallback) => update(next => { if (value === fallback) next.delete(key); else next.set(key, value) })

  // Every agent with a client, plus every agent account (so a Users link to
  // an agent with nobody booked still names them).
  const agents = useMemo(() => {
    const names = new Map(rows.filter(p => p.agent_id).map(p => [p.agent_id, p.agent?.full_name || 'Unknown']))
    profiles.filter(u => u.role === 'agent' && !names.has(u.id) && excludeTestAccounts([{ agent_id: u.id }], profile?.id).length)
      .forEach(u => names.set(u.id, u.full_name || 'Unnamed agent'))
    return [...names.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, profiles, profile?.id])

  const tabFn = useMemo(() => p => (reasonOf(p, now) ? 'needs' : fulfillTabOf(p)), [now])
  const reason = useMemo(() => p => reasonOf(p, now), [now])

  // Agent scope alone (latest activity ignores the range).
  const byAgent = useMemo(() => rows.filter(p => !agentId || p.agent_id === agentId), [rows, agentId])
  // Range + agent scope the search, the pipeline and the list alike.
  const scoped = useMemo(() => {
    const from = range === 'week' ? startOfWeek(new Date(now)).getTime()
      : range === 'month' ? startOfMonth(new Date(now)).getTime() : null
    return from == null ? byAgent : byAgent.filter(p => new Date(p.created_at).getTime() >= from)
  }, [byAgent, range, now])

  const recent = useMemo(() => byAgent
    .map(p => ({ p, ...lastChange(p) }))
    .filter(r => r.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4)
    .map(r => r.p), [byAgent])
  const recentSub = p => {
    const c = lastChange(p)
    return `${c.label} · ${shortName(p.agent?.full_name)} · ${lower(whenShort(c.at, now, tz))}`
  }
  const phrase = p => {
    const why = reasonOf(p, now)
    if (why) return why
    const s = stageOf(p)
    if (s === 'inProgress') return 'On a call now'
    if (s === 'cancelled') return `Cancelled ${new Date(p.fulfillment_completed_at || p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })}`
    if (s === 'noAnswer') return `No answer · try ${Math.max(1, p.call_attempts || 0)}`
    return p.scheduled_call_at ? `Call ${whenShort(p.scheduled_call_at, now, tz)}` : 'Booked'
  }

  const list = useMemo(() => scoped.filter(p => tabFn(p) === tab).sort(SORT[tab]), [scoped, tab, tabFn])

  const open = id => update(next => next.set('open', id))
  const close = () => update(next => next.delete('open'))
  const openFromSearch = p => update(next => {
    next.set('open', p.id)
    const t = tabFn(p)
    if (t === 'needs') next.delete('stage'); else next.set('stage', t)
  })
  const openRow = openId ? rows.find(p => p.id === openId) : null

  const fulfill = useMemo(() => ({
    tz, reason,
    tint: p => (isLive(p) ? 'rgba(239,68,68,0.05)' : reasonOf(p, now) ? 'rgba(245,158,11,0.05)' : null),
  }), [tz, reason, now])

  const viewOnly = (
    <>
      <span className="pl-ntile"><Lock size={18} strokeWidth={2} style={{ color: 'var(--ov-mute)' }} /></span>
      <span className="k"><b>View only</b>Only the agent and Fulfillment can change a client’s status.</span>
    </>
  )

  return (
    <>
      {failed && <LoadError what="the clients" onRetry={() => refetch()} style={{ marginBottom: 16 }} />}
      <div className="pl-page">
        <div className="pl-rail pl-rail--sum">
          <ClientSearch
            rows={scoped} recentRows={byAgent} onOpen={openFromSearch} hotkey={!openId}
            tabFn={tabFn} phraseFn={phrase}
            sub="Name, phone, agent or carrier, across everyone"
            recent={recent} recentTitle="Latest activity" recentMeta={agentId ? 'this agent' : 'everyone'}
            recentSub={recentSub} recentEmpty="Nothing yet" recentPill={false}
          />
          <PipelineSummary
            rows={scoped} tab={tab} tabs={TABS} tabFn={tabFn} title="Everyone’s pipeline"
            range={range} ranges={RANGES} onRange={v => setParam('range', v, 'all')}
            agentFilter={(
              <OvSelect
                value={agentId} onChange={v => setParam('agent', v, '')} icon={Users} placement="down" aria-label="Agent"
                options={[{ value: '', label: 'All agents' }, ...agents]}
              />
            )}
            foot={viewOnly}
          />
        </div>
        <PipelineList
          rows={scoped} tab={tab} onTab={t => setParam('stage', t, 'needs')} list={list}
          tabs={TABS} tabFn={tabFn} meanings={MEANINGS}
          now={now} activeId={openId} onOpen={open} fulfill={fulfill}
          loading={isLoading || !profile || failed} emptyRange={scoped.length === 0 && range !== 'all' ? range : null}
        />
      </div>

      {openId && (openRow ? (
        <ClientView
          key={openRow.id} p={openRow} tab={tabFn(openRow)} why={reasonOf(openRow, now)} tz={tz} onClose={close}
          onMessage={() => navigate(`/messages?dm=${dmId(openRow.agent_id, 'admin')}`)}
        />
      ) : !isLoading && !failed && (
        <ClientDrawer name="Client not found" meta="This client isn't on the pipeline any more." onClose={close} />
      ))}
    </>
  )
}

// The client's details, read-only: no status, booking or edit controls.
function ClientView({ p, tab, why, tz, onClose, onMessage }) {
  const live = isLive(p)
  const s = stageOf(p)
  const ctz = p.client_timezone || tz
  const place = placeOf(p)
  const caller = p.assigned?.full_name || 'Fulfillment'
  const attempted = (p.call_attempts || 0) > 0 || s === 'cancelled'
  const steps = [
    { label: `Booked by ${p.agent?.full_name || 'the agent'}`, at: p.created_at, done: true },
    {
      label: attempted ? `Called by ${caller}` : `Waiting for ${caller} to call`,
      at: attempted ? p.last_call_at || p.fulfillment_started_at || p.fulfillment_claimed_at : p.scheduled_call_at,
      sub: !attempted && p.scheduled_call_at ? callWhen(p.scheduled_call_at, ctz) : undefined,
      done: attempted,
    },
    { label: 'Old policy cancelled', at: p.fulfillment_completed_at, done: s === 'cancelled' },
  ]
  const status = live ? `On a call with ${caller} right now`
    : why ? `${why}. ${caller} has this one.`
      : s === 'cancelled' ? `Cancelled ${new Date(p.fulfillment_completed_at || p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : s === 'noAnswer' ? `No answer after ${p.call_attempts || 1} ${(p.call_attempts || 1) === 1 ? 'try' : 'tries'}. ${caller} will try again.`
          : `Waiting for ${caller}’s call`
  const footer = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Lock size={16} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--ov-mute)' }} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>
        View only. Only the agent and Fulfillment can change this client’s status.
      </p>
    </div>
  )
  return (
    <ClientDrawer p={p} tab={tab} onClose={onClose} footer={footer} onMessage={onMessage} messageLabel="Message agent">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
        <InfoTile label="Fulfillment call" value={callWhen(p.scheduled_call_at, ctz)} />
        <InfoTile label="Cancel with" value={p.current_carrier || 'Not noted'} />
        <InfoTile label="Booked by" value={p.agent?.full_name || 'Unknown'} />
        <InfoTile label="Fulfillment" value={p.assigned?.full_name || 'Not assigned'} />
        {place && (
          <div style={{ gridColumn: '1 / -1' }}>
            <InfoTile label="Where they live" value={
              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><MapPin size={16} strokeWidth={2} style={{ flexShrink: 0 }} />{place}</span>
            } />
          </div>
        )}
      </div>
      <StatusNote tab={tab} live={live}>{status}</StatusNote>
      <Journey steps={steps} tab={tab} />
    </ClientDrawer>
  )
}
