import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageSquare, Search } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useThreadPolicy } from '../hooks/usePolicyMessages'
import {
  useStandingThreads, useDmMessages, useSendDm, useMarkDmRead, dmId, parseDmId,
} from '../hooks/useDirectMessages'
import { DISPLAY } from '../lib/exportStyles'
import {
  InboxHero, InboxRow, InboxRowSkeleton, LineAvatar, DayDivider, ChatBubbleGroup, Composer,
} from '../components/agent/AgentUI'

// Messages (Prompt 679, rethought in 721) — the standing team lines only:
// an agent <-> each Fulfillment rep and an agent <-> Admin (Prompt 701,
// migration 123). A rep sees one line per agent, admin the Admin line per
// agent. Access is RLS (can_dm_thread), so nothing here filters by role.
// Lines open via ?dm=<agent id>.<rep id | 'admin'>.
//
// Prompt 721 removed the per-client threads from the UI for every role
// (policy_messages had 0 rows; the table, its RLS and my_message_threads stay
// dormant). An old ?thread=<policy id> link redirects to that client's
// standing line. Full screen on the v16 language: a tinted inbox column
// (inbox hero, search, rows) and the conversation on the plain page colour.
// See DESIGN.md v16 "P721 — Messages".

const MAX_LEN = 2000
const GROUP_GAP_MS = 5 * 60e3

const ROLE_LABEL = { fulfillment: 'Fulfillment', admin: 'Admin', agent: 'Agent' }

const STARTERS = {
  admin: ['I have a billing question', 'Something isn’t working', 'Question about a client'],
  fulfillment: ['Question about a client’s call', 'Heads-up before a call', 'Wrong number on file'],
}

const firstName = s => (s || '').trim().split(/\s+/)[0] || ''

function dayDiff(iso) {
  const d = new Date(iso); d.setHours(0, 0, 0, 0)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((t - d) / 864e5)
}
const clock = iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const monthDay = iso => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Inbox row time: 9:02 AM today, Yesterday, else Oct 5.
function rowTime(iso) {
  const diff = dayDiff(iso)
  return diff === 0 ? clock(iso) : diff === 1 ? 'Yesterday' : monthDay(iso)
}

function dayLabel(iso) {
  const diff = dayDiff(iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// One row shape per standing thread, newest first, then by name.
function buildItems(standing, me) {
  const agentView = me?.role === 'agent'
  return standing.map(t => {
    const kind = agentView ? (t.peer_id ? 'fulfillment' : 'admin') : 'agent'
    const title = kind === 'admin' ? 'Admin'
      : agentView ? t.peer_name || 'Fulfillment'
      : t.agent_name || 'Unknown'
    const line = kind === 'admin' ? { kind, name: 'Admin' }
      : agentView ? { kind, name: title, avatarUrl: t.peer_avatar_url, avatarColor: t.peer_avatar_color }
      : { kind, name: title, avatarUrl: t.agent_avatar_url, avatarColor: t.agent_avatar_color }
    return {
      key: dmId(t.agent_id, t.peer_key), agentId: t.agent_id, peerKey: t.peer_key,
      line, title, short: kind === 'admin' ? 'Admin' : firstName(title) || title,
      roleLine: kind === 'fulfillment' ? 'Fulfillment' : kind === 'admin' ? 'Ohvara team' : 'Agent',
      sub: kind === 'fulfillment' ? 'Fulfillment · calls your clients'
        : kind === 'admin' ? 'The Ohvara team. Billing, your account, anything else.'
        : me?.role === 'admin' ? 'Agent · Admin line' : 'Agent',
      last_body: t.last_body, last_sender_id: t.last_sender_id, last_at: t.last_at, unread_count: t.unread_count || 0,
    }
  }).sort((a, b) => {
    if (a.last_at && b.last_at) return new Date(b.last_at) - new Date(a.last_at)
    if (a.last_at) return -1
    if (b.last_at) return 1
    return a.title.localeCompare(b.title)
  })
}

// The inbox hero's bottom line.
function heroNote(items, me) {
  const unread = items.filter(i => i.unread_count > 0)
  if (unread.length === 1) {
    const [u] = unread
    return `From ${u.short}, ${dayDiff(u.last_at) === 1 ? 'yesterday' : rowTime(u.last_at)}`
  }
  if (unread.length === 2) return `From ${unread[0].short} and ${unread[1].short}`
  if (unread.length > 2) return `From ${unread.length} people`
  const latest = items.find(i => i.last_at)
  if (!latest) return 'No messages yet'
  const who = latest.last_sender_id === me?.id ? 'you' : latest.short
  const diff = dayDiff(latest.last_at)
  return `Last message from ${who} ${diff === 0 ? `at ${clock(latest.last_at)}` : diff === 1 ? 'yesterday' : `on ${monthDay(latest.last_at)}`}`
}

function useIsDesktop() {
  const query = '(min-width: 768px)'
  const [match, setMatch] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return match
}

export default function Messages() {
  const { profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const policyId = params.get('thread')
  const dmParam = params.get('dm')
  const dm = parseDmId(dmParam)
  const activeKey = dm ? dmId(dm.agentId, dm.peerKey) : null
  const desktop = useIsDesktop()

  const { data: standing = [], isLoading } = useStandingThreads()
  const items = useMemo(() => buildItems(standing, profile), [standing, profile])
  const unread = items.reduce((n, i) => n + i.unread_count, 0)

  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? items.filter(i => [i.title, i.roleLine, i.last_body].some(s => s?.toLowerCase().includes(q))) : items

  const open = id => setParams(prev => {
    const next = new URLSearchParams(prev)
    next.delete('thread'); next.delete('dm')
    if (id) next.set('dm', id)
    return next
  }, { replace: true })

  // Old per-client links (?thread=<policy id>) land on that client's standing
  // line: agent -> their rep (or Admin if none), rep -> the agent, admin ->
  // the agent's Admin line. Unreadable policy -> the param is just dropped.
  const { data: oldPolicy, isLoading: oldLoading } = useThreadPolicy(policyId)
  useEffect(() => {
    if (!policyId || oldLoading || !profile?.id) return
    let to = null
    if (oldPolicy) {
      const peer = profile.role === 'agent' ? oldPolicy.assigned_fulfillment_id || 'admin'
        : profile.role === 'fulfillment' ? profile.id
        : 'admin'
      to = dmId(oldPolicy.agent_id, peer)
    }
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('thread'); next.delete('dm')
      if (to) next.set('dm', to)
      return next
    }, { replace: true })
  }, [policyId, oldLoading, oldPolicy, profile?.id, profile?.role, setParams])

  // Desktop never shows a blank right side: open the most recent line.
  const newest = items[0]?.key
  useEffect(() => {
    if (!desktop || policyId || dmParam || !newest) return
    setParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('dm', newest)
      return next
    }, { replace: true })
  }, [desktop, policyId, dmParam, newest, setParams])

  const chatOpen = !!(activeKey || policyId)

  return (
    <div className="messages-fill ov-msg">
      <div className={`ov-msg-inbox ${chatOpen ? 'hidden md:flex' : 'flex'}`}>
        <InboxHero
          unread={unread} loading={isLoading}
          lines={items.map(i => ({ key: i.key, ...i.line }))}
          note={heroNote(items, profile)}
        />
        <label className="ov-input ov-msg-search">
          <Search size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>
        <div className="ov-msg-list scrollbar-thin">
          {isLoading ? (
            [0, 1, 2].map(i => <InboxRowSkeleton key={i} />)
          ) : items.length === 0 ? (
            <ListNote>No conversations yet.</ListNote>
          ) : shown.length === 0 ? (
            <ListNote>No conversations match</ListNote>
          ) : shown.map(t => (
            <InboxRow
              key={t.key} line={t.line} title={t.title} roleLine={t.roleLine}
              time={t.last_at ? rowTime(t.last_at) : ''}
              preview={t.last_body ? `${t.last_sender_id === profile?.id ? 'You: ' : ''}${t.last_body}` : 'No messages yet'}
              unread={t.unread_count} active={t.key === activeKey} onClick={() => open(t.key)}
            />
          ))}
        </div>
      </div>

      <div className={`ov-msg-pane ${chatOpen ? 'flex' : 'hidden md:flex'}`}>
        {dm ? (
          <Conversation
            key={activeKey} agentId={dm.agentId} peerKey={dm.peerKey}
            item={items.find(i => i.key === activeKey)} listReady={!isLoading}
            me={profile} onBack={() => open(null)}
          />
        ) : !isLoading && !policyId && items.length === 0 ? (
          <PaneNote icon={MessageSquare}>No conversations yet.</PaneNote>
        ) : null}
      </div>
    </div>
  )
}

function ListNote({ children }) {
  return <p style={{ margin: 0, padding: '28px 14px', textAlign: 'center', fontSize: 13.5, color: 'var(--ov-mute)' }}>{children}</p>
}

function PaneNote({ icon: Icon, children, action }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', color: 'var(--ov-mute)' }}>
      {Icon && <Icon size={26} />}
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ov-hi)' }}>{children}</p>
      {action}
    </div>
  )
}

// Messages split into day dividers and sender groups (same sender, each
// message within 5 minutes of the one before, same day).
function groupMessages(messages) {
  const out = []
  let day = null
  let cur = null
  for (const m of messages) {
    const d = new Date(m.created_at).toDateString()
    if (d !== day) {
      out.push({ type: 'day', key: `day:${d}`, label: dayLabel(m.created_at) })
      day = d
      cur = null
    }
    const prev = cur?.msgs[cur.msgs.length - 1]
    if (cur && cur.senderId === m.sender_id && new Date(m.created_at) - new Date(prev.created_at) <= GROUP_GAP_MS) {
      cur.msgs.push(m)
    } else {
      cur = { type: 'group', key: m.id, senderId: m.sender_id, msgs: [m] }
      out.push(cur)
    }
  }
  return out
}

// One standing line. `item` is undefined when the URL points at a pair the
// caller isn't part of (stale link, deactivated account) — shown as
// unavailable once the list has loaded rather than letting them type into it.
function Conversation({ agentId, peerKey, item, listReady, me, onBack }) {
  const { data: messages = [], isLoading } = useDmMessages(agentId, peerKey)
  const send = useSendDm(agentId, peerKey, me?.id)
  const { mutate: mark } = useMarkDmRead(me?.id)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const endRef = useRef(null)

  const lastId = messages[messages.length - 1]?.id
  useEffect(() => {
    if (me?.id && lastId) mark({ agentId, peerKey })
  }, [agentId, peerKey, lastId, me?.id, mark])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])

  const groups = useMemo(() => groupMessages(messages), [messages])
  const trimmed = draft.trim()

  function submit() {
    if (!trimmed || send.isPending) return
    send.mutate(trimmed, { onSuccess: () => setDraft('') })
  }

  function pickStarter(text) {
    setDraft(text)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(text.length, text.length)
    })
  }

  if (listReady && !item) {
    return (
      <PaneNote action={<button type="button" className="ov-ghost" onClick={onBack} style={{ height: 40, padding: '0 18px', borderRadius: 999, font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Back to inbox</button>}>
        This conversation isn’t available.
      </PaneNote>
    )
  }

  const starters = me?.role === 'agent' && item ? STARTERS[item.line.kind] : null
  const emptyCopy = !item ? '' : item.line.kind === 'admin'
    ? 'Ask about billing, your account, or anything that isn’t working. Replies land right here.'
    : item.line.kind === 'fulfillment'
      ? 'Ask about a client’s call, or let them know something before they dial.'
      : `Send ${item.short} a note. They’ll see it in their Messages.`
  const empty = !isLoading && messages.length === 0

  return (
    <>
      <div className="ov-msg-head">
        <span className="md:hidden">
          <button type="button" onClick={onBack} className="ov-msg-back" aria-label="Back to inbox"><ArrowLeft size={18} /></button>
        </span>
        {item ? (
          <>
            <LineAvatar line={item.line} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-[18px] md:text-[20px]" style={{ fontFamily: DISPLAY, fontWeight: 600, color: 'var(--ov-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
              <div style={{ marginTop: 2, fontSize: 13, color: 'var(--ov-mute)' }}>{item.sub}</div>
            </div>
          </>
        ) : (
          <>
            <span className="ov-skel" style={{ width: 44, height: 44, borderRadius: '50%', flexShrink: 0 }} />
            <span className="ov-skel" style={{ width: 160, height: 16 }} />
          </>
        )}
      </div>

      <div className="ov-msg-thread scrollbar-thin" style={empty ? { display: 'flex' } : undefined}>
        {isLoading ? (
          <div className="ov-msg-col" aria-hidden="true">
            <span className="ov-skel" style={{ width: '45%', height: 40, borderRadius: 18 }} />
            <span className="ov-skel" style={{ width: '35%', height: 40, borderRadius: 18, alignSelf: 'flex-end' }} />
            <span className="ov-skel" style={{ width: '50%', height: 40, borderRadius: 18 }} />
          </div>
        ) : empty ? (
          item && (
            <div style={{ margin: 'auto', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
              <LineAvatar line={item.line} size={72} />
              <div>
                <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 600, color: 'var(--ov-hi)' }}>Start a conversation with {item.short}</div>
                <p style={{ margin: '6px 0 0', fontSize: 14.5, lineHeight: 1.5, color: 'var(--ov-mute)' }}>{emptyCopy}</p>
              </div>
              {starters && (
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                  {starters.map(s => <button key={s} type="button" className="ov-starter" onClick={() => pickStarter(s)}>{s}</button>)}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="ov-msg-col">
            {groups.map(g => {
              if (g.type === 'day') return <DayDivider key={g.key} label={g.label} />
              const mine = g.senderId === me?.id
              const head = g.msgs[0]
              const tail = g.msgs[g.msgs.length - 1]
              return (
                <ChatBubbleGroup
                  key={g.key} mine={mine} messages={g.msgs}
                  time={mine ? clock(tail.created_at) : null}
                  caption={mine ? null : (
                    <>
                      <span style={{ fontWeight: 700, color: 'var(--ov-mid)' }}>{firstName(head.sender_name) || 'Someone'}</span>
                      {ROLE_LABEL[head.sender_role] ? ` · ${ROLE_LABEL[head.sender_role]}` : ''} · {clock(head.created_at)}
                    </>
                  )}
                  avatar={mine ? null : (
                    <LineAvatar line={head.sender_role === 'admin' ? { kind: 'admin', name: 'Admin' } : item?.line || { kind: 'agent', name: head.sender_name }} size={32} badge={false} />
                  )}
                />
              )
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="ov-msg-foot">
        <div style={{ maxWidth: 860, margin: '0 auto' }}>
          <Composer
            value={draft} onChange={setDraft} onSubmit={submit} max={MAX_LEN} inputRef={inputRef}
            placeholder={`Message ${item?.short || ''}…`} busy={send.isPending}
            error={send.isError ? send.error?.message || 'Couldn’t send that.' : null}
          />
        </div>
      </div>
    </>
  )
}
