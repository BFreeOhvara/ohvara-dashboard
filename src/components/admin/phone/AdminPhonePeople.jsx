import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus, Search, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useRevokeInvite, useSendAgentInvite } from '../../../hooks/useProfiles'
import { usePayouts } from '../../../hooks/useFulfillmentPayouts'
import { usePeopleWeek } from '../../../hooks/usePeopleWeek'
import { dmId } from '../../../hooks/useDirectMessages'
import { useNow } from '../../../lib/agentBookings'
import { phoneText } from '../../../lib/policyFormat'
import { DEFAULT_TIMEZONE } from '../../../lib/timezones'
import { Avatar } from '../../ui/Avatar'
import { PhoneSheet } from '../../agent/phone/PhoneSheet'
import { AddSomeoneSheet } from './AddSomeoneSheet'
import { PhoneToast } from './PhoneToast'
import { LoadError } from '../../agent/AgentUI'
import { useOnce } from '../../../hooks/useOneAtATime'
import { webUrl } from '../../../lib/native'

// Prompt 774 — People (Admin Users) on a phone, from More: Agents /
// Fulfillment, search, one row per person with this week's numbers (the
// desktop's usePeopleWeek), pending invites (Resend / cancel), Add someone;
// a row opens the person as a sheet (four numbers, View pipeline / on the
// desk, Message). Role and access changes stay on desktop.

const ONLINE_MS = 15 * 60e3
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const daysAgo = (iso, now) => {
  const n = Math.floor((now - new Date(iso).getTime()) / 86400e3)
  return n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`
}
function ago(iso, now) {
  const d = now - new Date(iso).getTime()
  if (d < 60e3) return 'just now'
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`
  if (d < 86400e3) return `${Math.floor(d / 3600e3)}h ago`
  const days = Math.floor(d / 86400e3)
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
const isOn = (u, s, now) => u.is_active && (s.live || (u.last_login_at && now - new Date(u.last_login_at).getTime() < ONLINE_MS))

function InviteRow({ inv, now }) {
  const send = useSendAgentInvite()
  const revoke = useRevokeInvite()
  const [state, setState] = useState(null)
  const to = inv.channel === 'email' ? inv.invited_email : inv.channel === 'sms' ? phoneText(inv.invited_phone) : null
  const name = to || 'Invite link'
  const once = useOnce() // P780: a double-tap sends once
  const resend = once(async () => {
    setState(null)
    if (!inv.channel) {
      try { await navigator.clipboard.writeText(webUrl(`/join?t=${inv.token}`)); setState({ ok: 'Link copied' }) } catch { setState({ err: 'Couldn’t copy the link' }) }
      return
    }
    try {
      await send.mutateAsync({ channel: inv.channel, to: inv.channel === 'email' ? inv.invited_email : inv.invited_phone, role: inv.role })
      await revoke.mutateAsync(inv.id)
    } catch (e) { setState({ err: e.message }) }
  })
  return (
    <div className="ph-row" style={{ cursor: 'default' }}>
      <span className="aph-noav is-invite">{name[0].toUpperCase()}</span>
      <span className="ph-row-main">
        <span className="ph-row-title">{name}</span>
        <span className="ph-row-sub" style={state?.err ? { color: 'var(--danger)' } : undefined}>
          {state?.err || state?.ok || `Invite sent ${daysAgo(inv.created_at, now)}`}
        </span>
      </span>
      {!state && (
        <button type="button" className="aph-givebtn" onClick={resend} disabled={send.isPending || revoke.isPending}>
          {send.isPending ? 'Sending…' : inv.channel ? 'Resend' : 'Copy link'}
        </button>
      )}
      <button type="button" className="aph-x" aria-label="Cancel invite" onClick={() => revoke.mutate(inv.id)} disabled={revoke.isPending}>
        <X size={16} strokeWidth={2.2} />
      </button>
    </div>
  )
}

function PersonSheet({ u, s, now, tz, week, rank, of, numbersLoading, onClose }) {
  const navigate = useNavigate()
  const isAgent = u.role === 'agent'
  const payouts = usePayouts(null, !isAgent)
  const hours = useMemo(() => {
    if (isAgent) return null
    const r = (payouts.data || []).find(w => w.rep_id === u.id && w.period_start === week.from)
    return r ? Math.round((Number(r.hours) || 0) * 10) / 10 : 0
  }, [isAgent, payouts.data, u.id, week.from])
  const on = isOn(u, s, now)
  const status = !u.is_active ? 'Access off' : s.live ? 'On a call now' : on ? 'On now' : u.last_login_at ? `Last on ${ago(u.last_login_at, now)}` : 'Hasn’t signed in yet'
  const n = v => (numbersLoading ? '–' : v)
  const tiles = isAgent
    ? [[n(s.main), 'booked this week'], [n(s.cx), 'cancelled this week'], [n(s.clients), 'clients all time'], [u.is_active && rank ? `#${rank}` : '–', `of ${plural(of, 'agent')}`]]
    : [[n(s.main), 'calls this week'], [n(s.cx), 'cancelled this week'], [payouts.isLoading ? '–' : hours, 'hours this week'], [u.is_active && rank ? `#${rank}` : '–', `of ${of} on Fulfillment`]]
  return (
    <PhoneSheet label={u.full_name || 'Person'} onClose={onClose}
      head={(
        <>
          <span className="aph-avwrap"><Avatar profile={u} size={48} /><i style={{ background: on ? 'var(--ov-up)' : 'var(--ov-mute)' }} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="aph-title" style={{ marginTop: 0, fontSize: 21 }}>{u.full_name || 'Unnamed'}</span>
            <span className="aph-sub">{isAgent ? 'Agent' : 'Fulfillment'} · {status}</span>
          </span>
        </>
      )}
      foot={(
        <div className="ph-foot-main" style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="aph-pay" style={{ flex: 1 }}
            onClick={() => navigate(isAgent ? `/admin/pipeline?agent=${u.id}` : '/admin/fulfillment')}>
            {isAgent ? 'View pipeline' : 'View on the desk'}
          </button>
          <button type="button" className="aph-nopay" style={{ flex: 1 }} onClick={() => navigate(`/messages?dm=${dmId(u.id, 'admin')}`)}>Message</button>
        </div>
      )}>
      <div className="aph-tiles">
        {tiles.map(([v, l]) => <div key={l} className="aph-tile"><b>{v}</b><span>{l}</span></div>)}
      </div>
      <div className="ph-info">
        {u.email && !/@ohvara\.internal$/i.test(u.email) && <div className="ph-info-row"><span><span className="ph-info-k">Email</span><span className="ph-info-v">{u.email}</span></span></div>}
        {u.phone && <div className="ph-info-row"><span><span className="ph-info-k">Phone</span><span className="ph-info-v">{phoneText(u.phone)}</span></span></div>}
        <div className="ph-info-row"><span><span className="ph-info-k">Joined</span><span className="ph-info-v">{new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz })}</span></span></div>
      </div>
      <p className="ph-mute" style={{ margin: '14px 2px 0' }}>Change role or access on a computer, in Users.</p>
    </PhoneSheet>
  )
}

export function AdminPhonePeople() {
  const { profile } = useAuth()
  const now = useNow(30e3)
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const [params, setParams] = useSearchParams()
  const tab = params.get('role') === 'fulfillment' ? 'fulfillment' : 'agent'
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState(null)
  const { invites, people, stats, week, peopleLoading, rowsLoading, eventsLoading, peopleFailed, numbersFailed, retry } = usePeopleWeek(now, tz)
  const numbersLoading = rowsLoading || eventsLoading || numbersFailed
  const isAgents = tab === 'agent'

  const inRole = useMemo(() => people.filter(u => u.role === tab), [people, tab])
  const ranked = useMemo(() => inRole.filter(u => u.is_active)
    .sort((x, y) => stats.get(y.id).main - stats.get(x.id).main || stats.get(y.id).cx - stats.get(x.id).cx || (x.full_name || '').localeCompare(y.full_name || '')), [inRole, stats])
  const q = query.trim().toLowerCase()
  const list = useMemo(() => inRole
    .filter(u => !q || [u.full_name, u.email, u.username, u.phone].filter(Boolean).join(' ').toLowerCase().includes(q))
    .sort((x, y) => (y.is_active - x.is_active) || stats.get(y.id).main - stats.get(x.id).main || (x.full_name || '').localeCompare(y.full_name || '')), [inRole, q, stats])
  const shownInvites = invites.filter(i => i.role === tab && (!q || [i.invited_email, i.invited_phone].filter(Boolean).join(' ').toLowerCase().includes(q)))
  const counts = {
    agent: people.filter(u => u.role === 'agent').length + invites.filter(i => i.role === 'agent').length,
    fulfillment: people.filter(u => u.role === 'fulfillment').length + invites.filter(i => i.role === 'fulfillment').length,
  }
  const open = openId ? people.find(u => u.id === openId) || null : null

  return (
    <div className="ph-stack" style={{ gap: 14 }}>
      <div className="ov-card ph-seg aph-seg2" role="tablist" aria-label="Who" style={{ marginTop: 0 }}>
        {[['agent', 'Agents', 'var(--ov-data-a)'], ['fulfillment', 'Fulfillment', 'var(--ov-data-b)']].map(([k, l, c]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ph-seg-btn${tab === k ? ' is-on' : ''}`}
            onClick={() => setParams(k === 'fulfillment' ? { role: 'fulfillment' } : {}, { replace: true })}>
            <span className="ph-seg-label" style={{ color: c }}>{l}</span>
            <span className="ph-seg-num">{peopleLoading || peopleFailed ? '—' : counts[k]}</span>
            <span className="ph-seg-bar" style={{ background: c }} aria-hidden="true" />
          </button>
        ))}
      </div>

      <label className="ov-input ph-search" style={{ marginTop: 0 }}>
        <Search size={18} strokeWidth={2} style={{ flexShrink: 0 }} aria-hidden="true" />
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={isAgents ? 'Find an agent' : 'Find a Fulfillment person'} aria-label="Search people" />
      </label>

      <div className="ov-card ph-card">
        {peopleFailed ? <LoadError what="people" onRetry={retry} style={{ margin: 12 }} /> : peopleLoading && <div className="ph-empty">Loading…</div>}
        {!peopleLoading && !peopleFailed && !list.length && !shownInvites.length && (
          <div className="ph-empty">{q ? 'Nobody matches that.' : isAgents ? 'No agents yet.' : 'Nobody on Fulfillment yet.'}</div>
        )}
        {list.map(u => {
          const s = stats.get(u.id)
          const on = isOn(u, s, now)
          return (
            <button key={u.id} type="button" className="ph-row" onClick={() => setOpenId(u.id)} style={u.is_active ? undefined : { opacity: 0.6 }}>
              <span className="aph-avwrap"><Avatar profile={u} size={40} /><i style={{ background: on ? 'var(--ov-up)' : 'var(--ov-mute)' }} /></span>
              <span className="ph-row-main">
                <span className="ph-row-title">{u.full_name || 'Unnamed'}</span>
                <span className="ph-row-sub">{!u.is_active ? 'Access off' : numbersLoading ? '…'
                  : `${isAgents ? `${s.main} booked` : plural(s.main, 'call')} · ${s.cx} cancelled`}</span>
              </span>
              <ChevronRight size={16} strokeWidth={2.2} className="ph-chev" aria-hidden="true" />
            </button>
          )
        })}
        {shownInvites.map(inv => <InviteRow key={inv.id} inv={inv} now={now} />)}
      </div>

      <button type="button" className="aph-nopay" style={{ width: '100%' }} onClick={() => setAdding(true)}>
        <Plus size={17} strokeWidth={2.4} aria-hidden="true" />Add someone
      </button>

      {open && (
        <PersonSheet u={open} s={stats.get(open.id)} now={now} tz={tz} week={week} numbersLoading={numbersLoading}
          rank={ranked.findIndex(r => r.id === open.id) + 1} of={ranked.length} onClose={() => setOpenId(null)} />
      )}
      {adding && <AddSomeoneSheet onClose={() => setAdding(false)} onSent={msg => { setAdding(false); setToast(msg) }} />}
      <PhoneToast text={toast} onDone={() => setToast(null)} />
    </div>
  )
}
