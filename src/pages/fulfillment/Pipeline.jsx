import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, UserRound } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { ClientSearch, PipelineSummary, PipelineList, ClientDrawer, OvSelect } from '../../components/agent/AgentUI'
import { CallDrawer } from '../../components/fulfillment/CallDrawer'
import { whenShort, timeText } from '../../lib/fulfillmentDay'
import { isLive, stageOf, fulfillTabOf, FULFILL_TABS, RANGES, useNow, startOfWeek, startOfMonth } from '../../lib/agentBookings'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { PhoneFulClients } from '../../components/fulfillment/phone/PhoneFulClients'
import { PhoneSheet } from '../../components/agent/phone/PhoneSheet'

// Fulfillment Pipeline (Prompt 681, rebuilt by Prompt 749) — the agent's My
// Pipeline (P726/P729) scoped to the rep: "Find any client" with the rep's
// recent calls, "Your pipeline" (total, agent filter, range, bar, three status
// rows, the next call), and one list box with three tabs (Booked, No answer,
// Cancelled; no Needs attention, that's the agent's). It's the same components as
// src/pages/agent/Clients.jsx, switched with props, so the two can't drift.
//
// A rep sees the rows assigned to them; admin sees every rep's, with a rep
// picker above the agent one. A row opens the My calls drawer (P748) over this
// page: ?open=<id>. ?stage= (booked / noAnswer / cancelled) and ?range= (week /
// month) are in the URL, like the agent side; Overview links ?stage=cancelled.
// Times are in the rep's zone.
// Prompt 773 — on a rep's phone layout the page is PhoneFulClients (no
// ?stage= = no filter there), and a row's call opens as a bottom sheet.

const RANGE_VALUES = RANGES.map(r => r.value)
// Old ?stage= values (the P681 pills) land on Booked.
const STAGE_ALIAS = { all: 'booked', inProgress: 'booked', attention: 'booked' }
const MEANINGS = { booked: 'Waiting for your call', noAnswer: 'On your calendar to try again', cancelled: 'Old policy cancelled' }
const MEANINGS_ADMIN = { booked: 'Waiting for a call', noAnswer: 'On the calendar to try again', cancelled: 'Old policy cancelled' }

const byCall = (a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9')
const SORT = {
  // Soonest call first.
  booked: byCall,
  // The next try first.
  noAnswer: byCall,
  // Newest cancellation first.
  cancelled: (a, b) => (b.fulfillment_completed_at || b.updated_at || '').localeCompare(a.fulfillment_completed_at || a.updated_at || ''),
}

const searchPhrase = tz => p => {
  const s = stageOf(p)
  if (s === 'inProgress') return 'On a call now'
  if (s === 'cancelled') return `Cancelled ${new Date(p.fulfillment_completed_at || p.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })}`
  if (s === 'noAnswer') return `No answer · try ${Math.max(1, p.call_attempts || 0)}`
  return p.scheduled_call_at ? `Call ${whenShort(p.scheduled_call_at, Date.now(), tz)}` : 'Booked'
}

const lower = s => s.replace(/^(Today|Tomorrow|Yesterday)/, w => w.toLowerCase())

export default function FulfillmentPipeline() {
  return usePhoneLayout() ? <PhonePipeline /> : <DeskPipeline />
}

function PhonePipeline() {
  const { profile } = useAuth()
  const now = useNow()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const { data: queue = [], isLoading } = useFulfillmentQueue()
  const mine = useMemo(() => queue.filter(p => p.assigned_fulfillment_id === profile?.id), [queue, profile?.id])
  const stage = params.get('stage')
  const filter = FULFILL_TABS.includes(stage) ? stage : null
  const update = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const openRow = openId ? queue.find(p => p.id === openId) : null
  const close = () => update(next => next.delete('open'))
  return (
    <>
      <PhoneFulClients
        rows={mine} loading={isLoading || !profile} now={now} tz={tz}
        filter={filter} onFilter={t => update(next => { if (t) next.set('stage', t); else next.delete('stage') })}
        onOpen={p => setParams(prev => { const next = new URLSearchParams(prev); next.set('open', p.id); return next })}
      />
      {openId && (openRow ? (
        <CallDrawer key={openRow.id} p={openRow} scope={mine} now={now} tz={tz} profile={profile} isAdmin={false}
          onClose={close} onOpenCall={id => update(next => next.set('open', id))} />
      ) : !isLoading && (
        <PhoneSheet label="Call not found" head={<b style={{ fontSize: 17 }}>Call not found</b>} onClose={close}>
          <p className="ph-empty" style={{ textAlign: 'left', padding: '12px 0 8px' }}>This client isn't on your pipeline any more.</p>
        </PhoneSheet>
      ))}
    </>
  )
}

function DeskPipeline() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params, setParams] = useSearchParams()
  const openId = params.get('open')
  const { data: queue = [], isLoading } = useFulfillmentQueue()

  const repId = isAdmin ? params.get('rep') || '' : ''
  const agentId = params.get('agent') || ''
  const stageParam = params.get('stage')
  const tab = FULFILL_TABS.includes(stageParam) ? stageParam : STAGE_ALIAS[stageParam] || 'booked'
  const range = RANGE_VALUES.includes(params.get('range')) ? params.get('range') : 'all'
  const update = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const setParam = (key, value, fallback) => update(next => { if (value === fallback) next.delete(key); else next.set(key, value) })

  // A rep's own rows; admin's: everyone's, or one rep's.
  const mine = useMemo(() => (isAdmin
    ? queue.filter(p => !repId || p.assigned_fulfillment_id === repId)
    : queue.filter(p => p.assigned_fulfillment_id === profile?.id)), [queue, isAdmin, repId, profile?.id])
  const reps = useMemo(() => [...new Map(queue.filter(p => p.assigned).map(p => [p.assigned.id, p.assigned.full_name || 'Unnamed rep'])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)), [queue])
  const agents = useMemo(() => [...new Map(mine.filter(p => p.agent_id).map(p => [p.agent_id, p.agent?.full_name || 'Unknown'])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label)), [mine])

  // Agent scope alone (recent calls and the next call ignore the range).
  const byAgent = useMemo(() => mine.filter(p => !agentId || p.agent_id === agentId), [mine, agentId])
  // Range + agent scope the search, the pipeline and the list alike.
  const scoped = useMemo(() => {
    const from = range === 'week' ? startOfWeek(new Date(now)).getTime()
      : range === 'month' ? startOfMonth(new Date(now)).getTime() : null
    return from == null ? byAgent : byAgent.filter(p => new Date(p.created_at).getTime() >= from)
  }, [byAgent, range, now])

  // The soonest call still ahead: a booked one or a No answer's next try.
  const nextCall = useMemo(() => byAgent
    .filter(p => fulfillTabOf(p) !== 'cancelled' && !isLive(p) && p.scheduled_call_at && new Date(p.scheduled_call_at).getTime() > now)
    .reduce((best, p) => (!best || p.scheduled_call_at < best.scheduled_call_at ? p : best), null), [byAgent, now])
  const recent = useMemo(() => byAgent
    .filter(p => p.last_call_at)
    .sort((a, b) => b.last_call_at.localeCompare(a.last_call_at))
    .slice(0, 4), [byAgent])

  const list = useMemo(() => scoped.filter(p => fulfillTabOf(p) === tab).sort(SORT[tab]), [scoped, tab])

  const open = id => update(next => next.set('open', id))
  const close = () => update(next => next.delete('open'))
  // A search pick also switches to that client's tab, so their row is the
  // highlighted one behind the drawer.
  const openFromSearch = p => update(next => {
    next.set('open', p.id)
    const t = fulfillTabOf(p)
    if (t === 'booked') next.delete('stage'); else next.set('stage', t)
  })
  // Looked up from every row, not the tab's list, so a link opens its client
  // whichever tab is selected.
  const openRow = openId ? queue.find(p => p.id === openId) : null

  const phrase = useMemo(() => searchPhrase(tz), [tz])
  const recentSub = p => {
    const s = stageOf(p)
    if (s === 'inProgress') return 'On a call now'
    const at = s === 'cancelled' ? p.fulfillment_completed_at || p.last_call_at : p.last_call_at
    return `${s === 'cancelled' ? 'Cancelled' : s === 'noAnswer' ? 'No answer' : 'Called'} · ${lower(whenShort(at, now, tz))}`
  }

  const filters = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {isAdmin && reps.length > 0 && (
        <OvSelect
          value={repId} onChange={v => setParam('rep', v, '')} icon={UserRound} placement="down" aria-label="Rep"
          options={[{ value: '', label: 'All reps' }, ...reps]}
        />
      )}
      <OvSelect
        value={agentId} onChange={v => setParam('agent', v, '')} icon={Users} placement="down" aria-label="Booked by"
        options={[{ value: '', label: 'All agents' }, ...agents]}
      />
    </div>
  )

  return (
    <>
      <div className="pl-page">
        <div className="pl-rail">
          <ClientSearch
            rows={scoped} recentRows={byAgent} onOpen={openFromSearch} hotkey={!openId}
            tabFn={fulfillTabOf} phraseFn={phrase}
            sub="Name, phone or agent, across every status"
            recent={recent} recentTitle="Recently worked" recentMeta={isAdmin && !repId ? 'by every rep' : isAdmin ? 'by this rep' : 'by you'}
            recentSub={recentSub} recentEmpty="No calls made yet" recentPill={false}
          />
          <PipelineSummary
            rows={scoped} tab={tab} tabs={FULFILL_TABS} tabFn={fulfillTabOf}
            range={range} ranges={RANGES} onRange={v => setParam('range', v, 'all')}
            agentFilter={filters} tz={tz}
            next={nextCall} onOpenNext={openFromSearch}
            nextLabel={nextCall ? `${isAdmin && !repId ? 'Next call' : 'Your next call'} · ${timeText(nextCall.scheduled_call_at, tz)}` : `${isAdmin && !repId ? 'Next call' : 'Your next call'}`}
            nextEmpty="Nothing waiting"
          />
        </div>
        <PipelineList
          rows={scoped} tab={tab} onTab={t => setParam('stage', t, 'booked')} list={list}
          tabs={FULFILL_TABS} tabFn={fulfillTabOf} meanings={isAdmin ? MEANINGS_ADMIN : MEANINGS}
          now={now} activeId={openId} onOpen={open} fulfill={{ tz }}
          loading={isLoading || !profile} emptyRange={scoped.length === 0 && range !== 'all' ? range : null}
        />
      </div>

      {openId && (openRow ? (
        <CallDrawer
          key={openRow.id} p={openRow} scope={isAdmin ? queue : mine}
          now={now} tz={tz} profile={profile} isAdmin={isAdmin}
          onClose={close} onOpenCall={open}
        />
      ) : !isLoading && (
        <ClientDrawer name="Call not found" meta={`This client isn't on ${isAdmin ? 'the' : 'your'} pipeline any more.`} onClose={close} />
      ))}
    </>
  )
}
