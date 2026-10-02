import { useMemo, useState } from 'react'
import { CalendarCheck, CircleCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTeamActivity } from '../../hooks/useTeamActivity'
import { card, eyebrow, MONO } from '../../lib/exportStyles'
import { StatTile, StatGrid, SectionHead, EmptyNote, Pill, GroupRow } from '../../components/agent/AgentUI'
import { Segmented } from '../../components/ui/Segmented'
import { GapNote } from '../../components/ui/ExportForm'
import { Avatar } from '../../components/ui/Avatar'
import { startOfWeek, sameLocalDay, useNow } from '../../lib/agentBookings'
import { excludeTestAccounts } from '../../lib/testAccounts'

// Team (Prompt 671) — what the whole team is doing this week: a leaderboard
// (most bookings / most cancellations closed, Monday to now) and an activity
// feed for the last 7 days. Motivation and visibility, not analytics.
//
// Privacy: every row comes from team_activity() (migration 111), which only
// returns kind, time, and the agent's first name + avatar. Teammates' client
// names and numbers never reach the browser. Test accounts are held out of
// the team view unless you are one (same rule as every team-wide rollup).

const FEED_DAYS = 7
const FEED_PAGE = 40

const BOARDS = [
  { value: 'booked', label: 'Bookings' },
  { value: 'cancelled', label: 'Cancellations closed' },
]

function rankBy(events, kind) {
  const m = new Map()
  for (const e of events) {
    if (e.kind !== kind) continue
    if (!m.has(e.agent_id)) m.set(e.agent_id, { id: e.agent_id, name: e.agent_first_name, url: e.avatar_url, color: e.avatar_color, n: 0, last: e.at })
    const a = m.get(e.agent_id)
    a.n += 1
    if (new Date(e.at) > new Date(a.last)) a.last = e.at
  }
  // Ties share a rank (1, 1, 3) and whoever got there first lists first.
  const list = [...m.values()].sort((a, b) => b.n - a.n || new Date(a.last) - new Date(b.last))
  let rank = 0
  return list.map((a, i) => {
    if (i === 0 || a.n !== list[i - 1].n) rank = i + 1
    return { ...a, rank }
  })
}

function dayLabel(iso, now) {
  const d = new Date(iso)
  if (sameLocalDay(iso, new Date(now))) return 'Today'
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (sameLocalDay(iso, y)) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function Team() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const now = useNow()

  // Fetch from whichever is earlier — Monday (leaderboard) or 7 days back
  // (feed: today + the 6 days before) — floored to midnight so the query key only changes once a day.
  const since = useMemo(() => {
    const weekAgo = new Date(now)
    weekAgo.setDate(weekAgo.getDate() - (FEED_DAYS - 1))
    weekAgo.setHours(0, 0, 0, 0)
    const monday = startOfWeek(new Date(now))
    return monday < weekAgo ? monday : weekAgo
  }, [now])
  const { data: raw = [], isLoading, error } = useTeamActivity(since)
  const events = useMemo(() => excludeTestAccounts(raw, profile?.id), [raw, profile?.id])

  const [board, setBoard] = useState('booked')
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE)

  const g = useMemo(() => {
    const weekStart = startOfWeek(new Date(now))
    const week = events.filter(e => new Date(e.at) >= weekStart)
    const today = new Date(now)
    const booked = rankBy(week, 'booked')
    const cancelled = rankBy(week, 'cancelled')
    const me = booked.find(a => a.id === profile?.id)
    return {
      bookedToday: events.filter(e => e.kind === 'booked' && sameLocalDay(e.at, today)).length,
      bookedWeek: week.filter(e => e.kind === 'booked').length,
      cancelledWeek: week.filter(e => e.kind === 'cancelled').length,
      activeAgents: new Set(week.map(e => e.agent_id)).size,
      boards: { booked, cancelled },
      me,
      meCount: me?.n || 0,
    }
  }, [events, now, profile?.id])

  const feed = useMemo(() => {
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - (FEED_DAYS - 1))
    cutoff.setHours(0, 0, 0, 0)
    return events.filter(e => new Date(e.at) >= cutoff)
  }, [events, now])

  if (isLoading) return <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>Loading…</p>
  if (error) return <p style={{ margin: 0, fontSize: 14, color: 'var(--danger)' }}>Couldn't load team activity: {error.message}</p>

  const ranked = g.boards[board]
  const shown = feed.slice(0, feedLimit)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <StatGrid>
        <StatTile label="Team booked today" value={g.bookedToday} />
        <StatTile label="Team booked this week" value={g.bookedWeek} sub="since Monday" />
        <StatTile label="Cancellations closed" value={g.cancelledWeek} sub="this week" />
        {isAdmin
          ? <StatTile label="Agents active" value={g.activeAgents} sub="booked or closed this week" />
          : <StatTile label="You this week" value={g.meCount}
              sub={g.me ? `booked · #${g.me.rank} of ${g.boards.booked.length}` : 'booked — get on the board'} />}
      </StatGrid>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <div>
          <SectionHead title="This week's leaders" sub="Monday to now" />
          <Segmented options={BOARDS} value={board} onChange={setBoard} size="sm" style={{ marginBottom: 12 }} />
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {ranked.length === 0 ? (
              <EmptyNote>
                {board === 'booked'
                  ? 'No bookings yet this week — the first one takes the top spot.'
                  : 'No cancellations closed yet this week.'}
              </EmptyNote>
            ) : ranked.map((a, i) => (
              <LeaderRow key={a.id} a={a} first={i === 0} isMe={a.id === profile?.id}
                unit={board === 'booked' ? 'booked' : 'closed'} />
            ))}
          </div>
        </div>

        <div>
          <SectionHead title="Activity" sub={`Last ${FEED_DAYS} days · updates every minute`} />
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {shown.length === 0 ? (
              <EmptyNote>Nothing yet this week. Bookings and closed cancellations show up here as they happen.</EmptyNote>
            ) : (
              <>
                {shown.map((e, i) => {
                  const label = dayLabel(e.at, now)
                  const newDay = i === 0 || dayLabel(shown[i - 1].at, now) !== label
                  return (
                    <div key={`${e.kind}-${e.agent_id}-${e.at}-${i}`}>
                      {newDay && <GroupRow label={label} first={i === 0} />}
                      <FeedRow e={e} isMe={e.agent_id === profile?.id} />
                    </div>
                  )
                })}
                {feed.length > shown.length && (
                  <button
                    onClick={() => setFeedLimit(n => n + FEED_PAGE)}
                    style={{
                      width: '100%', padding: '12px 20px', border: 'none', borderTop: 'var(--border-w) solid var(--border)',
                      background: 'var(--bg-elevated)', fontSize: 13, fontWeight: 600, color: 'var(--accent)',
                    }}
                  >
                    Show more ({feed.length - shown.length})
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <GapNote>
        Team activity shows who did what and when — never a teammate's client names or numbers. Your own clients are in My Pipeline.
      </GapNote>
    </div>
  )
}

function LeaderRow({ a, first, isMe, unit }) {
  const top = a.rank === 1
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px',
      borderTop: first ? 'none' : 'var(--border-w) solid var(--border)',
      background: isMe ? 'var(--accent-dim)' : 'transparent',
    }}>
      <span style={{
        width: 28, textAlign: 'center', fontFamily: MONO, fontSize: 13, fontVariantNumeric: 'tabular-nums',
        color: top ? 'var(--accent)' : 'var(--text-muted)', fontWeight: top ? 500 : 400,
      }}>
        #{a.rank}
      </span>
      <Avatar name={a.name} avatarUrl={a.url} avatarColor={a.color} size={32} />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {a.name}
        </span>
        {isMe && <Pill tone="accent">You</Pill>}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {a.n}
      </span>
      <span className="hidden sm:inline" style={{ ...eyebrow, color: 'var(--text-muted)', width: 52 }}>{unit}</span>
    </div>
  )
}

const KIND = {
  booked: { icon: CalendarCheck, color: 'var(--info)', text: 'booked a call with Fulfillment' },
  cancelled: { icon: CircleCheck, color: 'var(--success)', text: 'closed a cancellation' },
}

function FeedRow({ e, isMe }) {
  const k = KIND[e.kind] || KIND.booked
  const Icon = k.icon
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
      borderTop: 'var(--border-w) solid var(--border)',
    }}>
      <Avatar name={e.agent_first_name} avatarUrl={e.avatar_url} avatarColor={e.avatar_color} size={30} />
      <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{isMe ? 'You' : e.agent_first_name}</span>{' '}
        {k.text}
      </p>
      <Icon size={15} style={{ color: k.color, flexShrink: 0 }} aria-hidden />
      <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', minWidth: 62, textAlign: 'right' }}>
        {new Date(e.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </span>
    </div>
  )
}
