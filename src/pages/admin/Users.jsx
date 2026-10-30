import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, Plus, ChevronRight, X, ArrowUpDown, PhoneIncoming } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useRevokeInvite, useSendAgentInvite, useSetUserRole, useSetUserAccess } from '../../hooks/useProfiles'
import { useMissedStrikes } from '../../hooks/useRepCallEvents'
import { usePeopleWeek } from '../../hooks/usePeopleWeek'
import { usePayouts } from '../../hooks/useFulfillmentPayouts'
import { dmId } from '../../hooks/useDirectMessages'
import { useOnDutyAgents, isDutyMissing } from '../../hooks/useOnDutyAgents'
import { OvSelect, LoadError, SettingsCard, SettingsChip } from '../../components/agent/AgentUI'
import { AddSomeone } from '../../components/shared/AddSomeone'
import { Avatar } from '../../components/ui/Avatar'
import { attentionReason } from '../../lib/fulfillmentFlags'
import { whenShort } from '../../lib/fulfillmentDay'
import { isLive, stageOf, useNow } from '../../lib/agentBookings'
import { fullName, phoneText } from '../../lib/policyFormat'
import { DEFAULT_TIMEZONE } from '../../lib/timezones'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { AdminPhonePeople } from '../../components/admin/phone/AdminPhonePeople'
import { webUrl } from '../../lib/native'
import { useOnce } from '../../hooks/useOneAtATime'

// Admin Users (Prompt 762) — replaces Users & Access. Left: an Agents /
// Fulfillment switch, search with a sort, one row per person (this week's
// numbers and a bar against the top person), pending invites as dashed rows,
// and Add someone. Right: the selected person — a coloured panel (View
// pipeline, Message, four numbers), this week day by day, their latest
// clients (Fulfillment: calls), and an Access strip (role, how they sign in,
// turn access off / back on). No Admins tab.
//
// One set of numbers, the Overview's (adminWeek): buildCalls this week with
// that week's outcomes, so every call on the calendar, done or to come, and
// cancelled = the ones that ended Cancelled. Split by person:
//   agent        their clients' calls (all agents add up to the Overview's
//                "Calls booked this week")
//   Fulfillment  the calls on their row: whoever ended it, else the assigned
//                person (Admin Fulfillment's rule); hours = their pay week's
// Weeks are Monday to Sunday in the admin's zone. Rank is among people with
// access, by the main number. "On now" = on a call, or signed in within 15
// minutes (profiles.last_login_at is the only presence there is).
//
// Role and access go through admin-only RPCs (migration 144); they refuse
// non-admins and your own account, and want a confirm when the person still
// has open clients. Invites reuse send-agent-invite (text or email, with a
// role for admin) and the old copy-a-link flow.

const ROLES = { agents: 'agent', fulfillment: 'fulfillment' }
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ONLINE_MS = 15 * 60e3
const DOT = { cx: '#4ADE80', bk: '#60A5FA', na: '#A3B2CC', at: '#FBBF24', live: '#F87171' }

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const firstOf = name => String(name || '').trim().split(/\s+/)[0] || 'They'
const shortName = name => {
  const [first, ...rest] = String(name || '').trim().split(/\s+/)
  const last = rest.pop()
  return first ? `${first}${last ? ` ${last[0]}.` : ''}` : 'Unknown'
}
const shortDate = (iso, tz) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz })
const hrs = h => String(Math.round((Number(h) || 0) * 10) / 10)
const realEmail = e => (e && !/@ohvara\.internal$/i.test(e) ? e : null)

function ago(iso, now) {
  const d = now - new Date(iso).getTime()
  if (d < 60e3) return 'just now'
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  const days = Math.floor(d / 86400e3)
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const daysAgo = (iso, now) => {
  const n = Math.floor((now - new Date(iso).getTime()) / 86400e3)
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`
}

// A client's status as a word and a colour (the Pipeline's statuses).
function clientStatus(p, now) {
  if (isLive(p)) return { text: 'On a call', c: DOT.live }
  const s = stageOf(p)
  if (s === 'cancelled') return { text: 'Cancelled', c: DOT.cx }
  if (attentionReason(p, now)) return { text: 'Needs attention', c: DOT.at }
  if (s === 'noAnswer') return { text: 'No answer', c: DOT.na }
  return { text: 'Booked', c: DOT.bk }
}

// Prompt 774 — under 768px, inside the admin phone shell, the phone screen.
export default function AdminUsers() {
  return usePhoneLayout() ? <AdminPhonePeople /> : <AdminUsersDesktop />
}

function AdminUsersDesktop() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params, setParams] = useSearchParams()
  const tab = params.get('role') === 'fulfillment' ? 'fulfillment' : 'agents'
  const role = ROLES[tab]
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('top')
  const [adding, setAdding] = useState(false)

  const { invites, rows, events, week, dates, todayStr, people, byId, stats, peopleLoading, rowsLoading, eventsLoading, peopleFailed, numbersFailed, retry } = usePeopleWeek(now, tz)

  // Rank among people with access in this role.
  const ranked = useMemo(() => people
    .filter(u => u.role === role && u.is_active)
    .sort((x, y) => stats.get(y.id).main - stats.get(x.id).main || stats.get(y.id).cx - stats.get(x.id).cx || (x.full_name || '').localeCompare(y.full_name || '')), [people, role, stats])

  const inRole = useMemo(() => people.filter(u => u.role === role), [people, role])
  const roleInvites = useMemo(() => invites.filter(i => i.role === role), [invites, role])
  const counts = {
    agents: people.filter(u => u.role === 'agent').length + invites.filter(i => i.role === 'agent').length,
    fulfillment: people.filter(u => u.role === 'fulfillment').length + invites.filter(i => i.role === 'fulfillment').length,
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hit = u => !q || [u.full_name, u.email, u.username, u.phone].filter(Boolean).join(' ').toLowerCase().includes(q)
    const by = {
      top: (x, y) => stats.get(y.id).main - stats.get(x.id).main || (x.full_name || '').localeCompare(y.full_name || ''),
      name: (x, y) => (x.full_name || '').localeCompare(y.full_name || ''),
      last: (x, y) => (y.last_login_at || '').localeCompare(x.last_login_at || ''),
    }[sort]
    return inRole.filter(hit).sort((x, y) => (y.is_active - x.is_active) || by(x, y))
  }, [inRole, query, sort, stats])
  const shownInvites = useMemo(() => {
    const q = query.trim().toLowerCase()
    return roleInvites.filter(i => !q || [i.invited_email, i.invited_phone].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [roleInvites, query])
  const top = Math.max(1, ...inRole.map(u => stats.get(u.id).main))

  const userParam = params.get('user')
  const selected = (userParam && byId.get(userParam)?.role === role ? byId.get(userParam) : null) || list[0] || null
  const update = fn => {
    const next = new URLSearchParams(params)
    fn(next)
    setParams(next, { replace: true })
  }
  const pick = id => update(next => next.set('user', id))
  const switchTab = t => update(next => {
    if (t === 'fulfillment') next.set('role', 'fulfillment'); else next.delete('role')
    next.delete('user')
  })
  // A role change moves the person to the other tab; follow them there.
  const follow = (id, newRole) => update(next => {
    next.set('user', id)
    if (newRole === 'fulfillment') next.set('role', 'fulfillment'); else next.delete('role')
  })

  const loading = peopleLoading || !profile || peopleFailed
  const numbersLoading = rowsLoading || eventsLoading || numbersFailed
  const isAgents = tab === 'agents'

  return (
    <>
    <OnDutyCard />
    <div className="au-page">
      <section className="ov-card au-list" aria-label="People">
        <div className="au-list-top">
          <div className="au-switch" role="tablist" aria-label="Who">
            {[['agents', 'Agents'], ['fulfillment', 'Fulfillment']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => switchTab(k)}>
                {label}<b>{counts[k]}</b>
              </button>
            ))}
          </div>
          <div className="au-find">
            <Search size={15} strokeWidth={2} aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={isAgents ? 'Find an agent' : 'Find a Fulfillment person'} aria-label="Search people" />
            <label className="au-sort">
              <ArrowUpDown size={12} strokeWidth={2.2} aria-hidden="true" />
              <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort">
                <option value="top">{isAgents ? 'Most booked' : 'Most calls'}</option>
                <option value="name">Name</option>
                <option value="last">Last on</option>
              </select>
            </label>
          </div>
        </div>

        <div className="au-rows">
          {peopleFailed ? <LoadError what="people" onRetry={retry} style={{ margin: '4px 12px' }} /> : loading && <p className="au-empty">Loading…</p>}
          {!loading && !list.length && !shownInvites.length && (
            <p className="au-empty">{query ? 'Nobody matches that.' : isAgents ? 'No agents yet.' : 'Nobody on Fulfillment yet.'}</p>
          )}
          {list.map(u => {
            const s = stats.get(u.id)
            const on = u.is_active && (s.live || (u.last_login_at && now - new Date(u.last_login_at).getTime() < ONLINE_MS))
            return (
              <button key={u.id} type="button" className={`au-row${selected?.id === u.id ? ' is-sel' : ''}${u.is_active ? '' : ' is-off'}`}
                aria-current={selected?.id === u.id ? 'true' : undefined} onClick={() => pick(u.id)}>
                <span className="au-av">
                  <Avatar profile={u} size={38} />
                  <i style={{ background: on ? '#4ADE80' : 'var(--ov-mute)' }} />
                </span>
                <span className="au-row-t">
                  <b>{u.full_name || 'Unnamed'}</b>
                  <span>{!u.is_active ? 'Access off'
                    : numbersLoading ? '…'
                      : `${isAgents ? `${s.main} booked` : plural(s.main, 'call')} · ${s.cx} cancelled`}</span>
                </span>
                {u.is_active && <span className="au-bar" aria-hidden="true"><span style={{ width: `${(s.main / top) * 100}%` }} /></span>}
              </button>
            )
          })}
          {shownInvites.map(inv => <InviteRow key={inv.id} inv={inv} now={now} meName={profile?.full_name} />)}
        </div>

        <div className="au-add-wrap">
          <button type="button" className="au-add" onClick={() => setAdding(true)}>
            <Plus size={16} strokeWidth={2.4} aria-hidden="true" />Add someone
          </button>
        </div>
      </section>

      {selected ? (
        <Person
          key={selected.id} u={selected} s={stats.get(selected.id)} rows={rows} events={events} now={now} tz={tz}
          dates={dates} todayStr={todayStr} week={week} numbersLoading={numbersLoading}
          rank={ranked.findIndex(r => r.id === selected.id) + 1} of={ranked.length}
          onPipeline={() => navigate(selected.role === 'agent' ? `/admin/pipeline?agent=${selected.id}` : `/admin/fulfillment?rep=${selected.id}`)}
          onMessage={() => navigate(`/messages?dm=${dmId(selected.id, 'admin')}`)}
          onRole={follow}
        />
      ) : (
        <section className="ov-card au-none">
          {peopleFailed ? 'Couldn’t load people.' : loading ? 'Loading…' : isAgents ? 'No agents yet. Add someone to get started.' : 'Nobody on Fulfillment yet. Add someone to get started.'}
        </section>
      )}

      {adding && <AddSomeone defaultRole={role} onClose={() => setAdding(false)} />}
    </div>
    </>
  )
}

const dutyTime = iso => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '—')

// Who can take a live transfer right now. Count and rows share one array.
function OnDutyCard() {
  const { data, error, isLoading, refetch } = useOnDutyAgents()
  const rows = data || []
  const note = { margin: 0, fontSize: 14, color: 'var(--ov-mute)' }
  return (
    <SettingsCard
      icon={PhoneIncoming}
      title="Live transfers · on duty now"
      sub="Agents who can take a live transfer right now."
      right={!error && !isLoading && <SettingsChip tone={rows.length ? 'on' : 'off'}><span style={{ fontFamily: 'var(--font-mono)' }}>{rows.length}</span></SettingsChip>}
      gap={10}
    >
      {error ? (isDutyMissing(error)
        ? <p style={note}>Duty status isn't set up yet.</p>
        : <LoadError what="duty status" onRetry={refetch} />)
        : isLoading ? <p style={note}>Loading…</p>
        : !rows.length ? <p style={note}>No agents on duty.</p>
        : (
          <div>
            {rows.map((a, i) => (
              <div key={a.agent_id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 2, padding: '10px 0', borderTop: i ? '1px solid var(--ov-line)' : 'none' }}>
                <b style={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{a.full_name || 'Unnamed'}</b>
                <span style={{ fontSize: 13.5, color: 'var(--ov-mute)' }}>On since <span style={{ fontFamily: 'var(--font-mono)' }}>{dutyTime(a.since)}</span></span>
              </div>
            ))}
          </div>
        )}
    </SettingsCard>
  )
}

// ── a pending invite ──────────────────────────────────────────────────────
function InviteRow({ inv, now, meName }) {
  const send = useSendAgentInvite()
  const revoke = useRevokeInvite()
  const [state, setState] = useState(null)
  const once = useOnce() // P780: a double-tap sends once
  const to = inv.channel === 'email' ? inv.invited_email : inv.channel === 'sms' ? phoneText(inv.invited_phone) : null
  const name = to || 'Invite link'

  // Resend: a sent invite goes again to the same place (a new link) and the
  // old one is cancelled; a link invite is copied again.
  const resend = once(async () => {
    setState(null)
    if (!inv.channel) {
      try {
        await navigator.clipboard.writeText(webUrl(`/join?t=${inv.token}`))
        setState({ ok: 'Link copied' })
      } catch { setState({ err: 'Couldn’t copy the link' }) }
      return
    }
    try {
      await send.mutateAsync({ channel: inv.channel, to: inv.channel === 'email' ? inv.invited_email : inv.invited_phone, role: inv.role })
      await revoke.mutateAsync(inv.id)
    } catch (e) { setState({ err: e.message }) }
  })

  return (
    <div className="au-row is-invite">
      <span className="au-av"><span className="au-av-inv">{name[0].toUpperCase()}</span><i style={{ background: '#7FA6F2' }} /></span>
      <span className="au-row-t">
        <b title={name}>{name}</b>
        <span>
          {state?.err ? <em className="is-err">{state.err}</em> : state?.ok ? <em>{state.ok}</em> : (
            <>Invite sent {daysAgo(inv.created_at, now)}{inv.creator?.full_name && inv.creator.full_name !== meName ? ` by ${firstOf(inv.creator.full_name)}` : ''} · </>
          )}
          {!state && (
            <button type="button" className="au-link" onClick={resend} disabled={send.isPending || revoke.isPending}>
              {send.isPending ? 'Sending…' : inv.channel ? 'Resend' : 'Copy link'}
            </button>
          )}
        </span>
      </span>
      <button type="button" className="au-inv-x" aria-label="Cancel invite" title="Cancel invite" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}

// ── the selected person ─────────────────────────────────────────────────────
function Person({ u, s, rows, events, now, tz, dates, todayStr, week, numbersLoading, rank, of, onPipeline, onMessage, onRole }) {
  const isAgent = u.role === 'agent'
  const payouts = usePayouts(null, !isAgent)
  const hours = useMemo(() => {
    if (isAgent) return null
    const r = (payouts.data || []).find(w => w.rep_id === u.id && w.period_start === week.from)
    return r ? Number(r.hours) || 0 : 0
  }, [isAgent, payouts.data, u.id, week.from])

  const on = u.is_active && (s.live || (u.last_login_at && now - new Date(u.last_login_at).getTime() < ONLINE_MS))
  const status = !u.is_active ? 'access off'
    : s.live ? 'on a call now'
      : on ? 'on now'
        : u.last_login_at ? `last on ${ago(u.last_login_at, now)}` : 'hasn’t signed in yet'
  const strikes = useMissedStrikes(u.id, !isAgent)
  const missed = !isAgent && strikes.data != null ? `Missed calls: ${strikes.data} in 30 days` : null
  const line = [isAgent ? 'Agent' : 'Fulfillment', `joined ${shortDate(u.created_at, tz)}`, status, missed].filter(Boolean).join(' · ')

  const n = v => (numbersLoading ? '–' : v)
  const tiles = isAgent
    ? [[n(s.main), 'booked this week', 'is-a'], [n(s.cx), 'cancelled this week', 'is-b'], [n(s.clients), 'clients all time', ''], [u.is_active && rank ? `#${rank}` : '–', `of ${plural(of, 'agent')}`, 'is-c']]
    : [[n(s.main), 'calls this week', 'is-a'], [n(s.cx), 'cancelled this week', 'is-b'], [payouts.isLoading ? '–' : hrs(hours), 'hours this week', ''], [u.is_active && rank ? `#${rank}` : '–', `of ${of} on Fulfillment`, 'is-c']]

  // Latest clients (agent: last 6 booked) / calls (Fulfillment: last 6 they made).
  const latest = useMemo(() => {
    if (isAgent) {
      return rows.filter(p => p.agent_id === u.id)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 6)
        .map(p => {
          const at = stageOf(p) === 'cancelled' ? (p.fulfillment_completed_at || p.updated_at) : p.scheduled_call_at
          const when = at ? (stageOf(p) === 'cancelled' ? whenShort(at, now, tz).replace(/ \d.*$/, '') : whenShort(at, now, tz)) : 'no call time'
          return { id: p.id, name: fullName(p), sub: `${p.current_carrier || p.carrier_name || 'Carrier not noted'} · ${when.replace(/^(Today|Tomorrow|Yesterday)/, w => w.toLowerCase())}`, ...clientStatus(p, now) }
        })
    }
    const mine = new Map()
    for (const e of events) if (e.actor_id === u.id) mine.set(e.policy_id, e.at > (mine.get(e.policy_id) || '') ? e.at : mine.get(e.policy_id))
    for (const p of rows) {
      if (p.assigned_fulfillment_id !== u.id) continue
      const at = isLive(p) ? p.call_live_since : p.fulfillment_completed_at || p.last_call_at
      if (at && at > (mine.get(p.id) || '')) mine.set(p.id, at)
    }
    const byPolicy = new Map(rows.map(p => [p.id, p]))
    return [...mine.entries()]
      .filter(([id]) => byPolicy.has(id))
      .sort((a, b) => b[1].localeCompare(a[1]))
      .slice(0, 6)
      .map(([id, at]) => {
        const p = byPolicy.get(id)
        return { id, name: fullName(p), sub: `Booked by ${shortName(p.agent?.full_name)} · ${whenShort(at, now, tz).replace(/^(Today|Tomorrow|Yesterday)/, w => w.toLowerCase())}`, ...clientStatus(p, now) }
      })
  }, [isAgent, rows, events, u.id, now, tz])

  const dayMax = Math.max(1, ...s.a)

  return (
    <div className="au-right">
      <section className="ov-hero au-hero" aria-label={u.full_name}>
        <div className="au-hero-head">
          <span className="au-hero-av">
            <Avatar profile={u} size={64} />
            <i style={{ background: on ? '#4ADE80' : '#8697B5' }} />
          </span>
          <div className="au-hero-name">
            <h2>{u.full_name || 'Unnamed'}</h2>
            <p>{line}</p>
          </div>
          <div className="au-hero-btns">
            <button type="button" className="au-solid" onClick={onPipeline}>
              {isAgent ? 'View pipeline' : 'View on the desk'}<ChevronRight size={15} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <button type="button" className="au-glass" onClick={onMessage}>Message</button>
          </div>
        </div>
        <div className="au-tiles">
          {tiles.map(([v, label, cls]) => (
            <div key={label} className={`au-tile ${cls}`}><b>{v}</b><span>{label}</span></div>
          ))}
        </div>
      </section>

      <div className="au-mid">
        <section className="ov-card au-days" aria-label="This week, day by day">
          <div className="au-card-head">
            <h3>This week, day by day</h3>
            <span className="au-key"><span><i className="is-a" />{isAgent ? 'Booked' : 'Calls'}</span><span><i className="is-b" />Cancelled</span></span>
          </div>
          <div className="au-day-rows">
            {dates.map((d, i) => {
              const future = d > todayStr
              const today = d === todayStr
              return (
                <div key={d} className={`au-day${future ? ' is-future' : ''}${today ? ' is-today' : ''}`}>
                  <span className="au-day-l">{DAY_LABELS[i]}</span>
                  <span className="au-day-bars">
                    <span className="is-a" style={{ width: `${(s.a[i] / dayMax) * 100}%` }} />
                    <span className="is-b" style={{ width: `${(s.b[i] / dayMax) * 100}%` }} />
                  </span>
                  <span className="au-day-v">{s.a[i]} / {s.b[i]}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="ov-card au-latest" aria-label={isAgent ? 'Latest clients' : 'Latest calls'}>
          <div className="au-card-head">
            <h3>{isAgent ? 'Latest clients' : 'Latest calls'}</h3>
            {isAgent && s.clients > 0 && <button type="button" className="au-link" onClick={onPipeline}>All {s.clients}</button>}
          </div>
          <div className="au-latest-rows">
            {numbersLoading ? <p className="au-empty">Loading…</p>
              : !latest.length ? <p className="au-empty">{isAgent ? 'No clients booked yet.' : 'No calls made yet.'}</p>
                : latest.map(c => (
                  <div key={c.id} className="au-client">
                    <span className="au-client-t"><b>{c.name}</b><span>{c.sub}</span></span>
                    <span className="au-st" style={{ color: c.c }}><i style={{ background: c.c }} />{c.text}</span>
                  </div>
                ))}
          </div>
        </section>
      </div>

      <AccessStrip u={u} rows={rows} onRole={onRole} />
    </div>
  )
}

// ── role and access ─────────────────────────────────────────────────────────
function AccessStrip({ u, rows, onRole }) {
  const setRole = useSetUserRole()
  const setAccess = useSetUserAccess()
  const [ask, setAsk] = useState(null)   // { kind: 'role', to } | { kind: 'off' }
  const [err, setErr] = useState(null)
  const isAgent = u.role === 'agent'
  const open = rows.filter(p => p.fulfillment_stage !== 'Complete' && (isAgent ? p.agent_id === u.id : p.assigned_fulfillment_id === u.id)).length
  const signIn = realEmail(u.email) || (u.phone ? phoneText(u.phone) : null) || u.username || 'no login saved'
  const busy = setRole.isPending || setAccess.isPending
  const once = useOnce() // P780: a double-tap changes once

  const run = once(async fn => {
    setErr(null)
    try {
      await fn()
      setAsk(null)
    } catch (e) {
      // The server counted open work the page didn't see: ask again with it.
      if (e.openWork && ask) setAsk({ ...ask, open: e.openWork })
      else setErr(e.message || 'That didn’t work. Try again.')
    }
  })
  const confirmRole = () => run(async () => {
    await setRole.mutateAsync({ userId: u.id, role: ask.to, confirm: true })
    onRole(u.id, ask.to)
  })
  const confirmOff = () => run(() => setAccess.mutateAsync({ userId: u.id, active: false, confirm: true }))
  const turnOn = () => run(() => setAccess.mutateAsync({ userId: u.id, active: true }))

  const first = firstOf(u.full_name)
  const openN = ask?.open ?? open

  return (
    <section className="ov-card au-access" aria-label="Access">
      <span className="au-access-h">Access</span>
      <span className="au-access-role">
        Role
        <span className="au-role-sel">
          <OvSelect
            value={u.role} placement="up" aria-label="Role"
            onChange={v => { if (v !== u.role) { setErr(null); setAsk({ kind: 'role', to: v }) } }}
            options={[{ value: 'agent', label: 'Agent' }, { value: 'fulfillment', label: 'Fulfillment' }]}
          />
        </span>
      </span>
      <span className="au-access-sign">Signs in with <b>{signIn}</b></span>
      <span className="au-access-gap" />
      {err && <span className="au-err" role="alert">{err}</span>}
      {u.is_active ? (
        <button type="button" className="au-off" onClick={() => { setErr(null); setAsk({ kind: 'off' }) }} disabled={busy}>Turn off access</button>
      ) : (
        <button type="button" className="au-on" onClick={turnOn} disabled={busy}>{setAccess.isPending ? 'Turning on…' : 'Turn access back on'}</button>
      )}

      {ask?.kind === 'role' && (
        <Dialog
          title={`Make ${first} ${ask.to === 'agent' ? 'an agent' : 'Fulfillment'}?`}
          onCancel={() => setAsk(null)} onConfirm={confirmRole} busy={setRole.isPending} confirmLabel={`Make ${ask.to === 'agent' ? 'Agent' : 'Fulfillment'}`}
          err={err}
        >
          <p>{ask.to === 'agent'
            ? `${first} will sign in to the agent portal and stop getting Fulfillment calls.`
            : `${first} will sign in to the Fulfillment desk instead of the agent portal.`}</p>
          {openN > 0 && (
            <p className="au-warn">{isAgent
              ? `${first} has ${plural(openN, 'open client')}. They stay booked under ${first}, but ${first} won't see them as an agent any more.`
              : `${first} has ${plural(openN, 'open call')}. Calls not live go to someone else on Fulfillment.`}</p>
          )}
        </Dialog>
      )}
      {ask?.kind === 'off' && (
        <Dialog
          title={`Turn off ${first}’s access?`} danger
          onCancel={() => setAsk(null)} onConfirm={confirmOff} busy={setAccess.isPending} confirmLabel="Turn off access"
          err={err}
        >
          <p>{first} can’t sign in and is signed out now. {isAgent ? 'They can’t book calls.' : 'They won’t get new calls.'} Their clients and history stay. You can turn it back on any time.</p>
          {!isAgent && openN > 0 && <p className="au-warn">{`${first} has ${plural(openN, 'open call')}. Calls not live go to someone else on Fulfillment.`}</p>}
        </Dialog>
      )}
    </section>
  )
}

function Dialog({ title, children, onCancel, onConfirm, confirmLabel, busy, danger, err }) {
  const onKey = useEffectEvent(e => { if (e.key === 'Escape' && !busy) onCancel() })
  useEffect(() => {
    const h = e => onKey(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  return createPortal(
    <>
      <div className="ov-scrim ap-scrim" onClick={busy ? undefined : onCancel} aria-hidden="true" />
      <div className="ov-card ap-modal au-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ap-modal-head">
          <div><h2>{title}</h2></div>
          <button type="button" className="ap-x" aria-label="Close" onClick={onCancel} disabled={busy}><X size={18} /></button>
        </div>
        <div className="au-modal-body">{children}</div>
        {err && <p className="au-err" role="alert">{err}</p>}
        <div className="ap-fix-foot">
          <button type="button" className="ap-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={danger ? 'au-danger' : 'ap-solid'} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </>,
    document.body,
  )
}
