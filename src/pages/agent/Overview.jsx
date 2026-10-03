import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, AlertTriangle, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { primaryBtn, ghostBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { LiveClock } from '../../components/ui/LiveClock'
import { StatTile, StatGrid, SectionHead, ListCard, GroupRow, ClientRow, EmptyNote } from '../../components/agent/AgentUI'
import { stageOf, isMissed, sameLocalDay, startOfWeek, useNow } from '../../lib/agentBookings'

// Agent Overview (Prompt 665) — the landing page. "Your day at a glance":
// what's booked today, anything Fulfillment hasn't picked up yet, what's
// coming, and the week's numbers — with Book a call one tap away.
//
// Prompt 669 — laid out like Restorix Portal's closer Overview: greeting +
// date/clock row, four eyebrow stat tiles, a tinted needs-attention banner,
// then one "Your calls" table with Today / Coming up group rows instead of
// two half-width cards.
//
// Prompt 672 — each tile opens My Clients on the matching slice of its
// Pipeline (?range= / ?stage=).

const UPCOMING_LIMIT = 6

export default function Overview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow()
  const { data: rows = [], isLoading } = useAgentBookings(profile?.id)

  const g = useMemo(() => {
    const today = new Date(now)
    const weekStart = startOfWeek(today).getTime()
    const open = rows.filter(p => stageOf(p) !== 'cancelled')
    const todays = rows
      .filter(p => sameLocalDay(p.scheduled_call_at, today))
      .sort((a, b) => a.scheduled_call_at.localeCompare(b.scheduled_call_at))
    // Today's misses already show (flagged) in the Today group; the attention
    // list only needs the older ones. The tile counts all of them.
    const missedAll = open.filter(p => isMissed(p, now))
    const missed = missedAll.filter(p => !sameLocalDay(p.scheduled_call_at, today))
    const upcoming = open
      .filter(p => p.scheduled_call_at && new Date(p.scheduled_call_at) > today && !sameLocalDay(p.scheduled_call_at, today))
      .sort((a, b) => a.scheduled_call_at.localeCompare(b.scheduled_call_at))
    const bookedThisWeek = rows.filter(p => new Date(p.created_at).getTime() >= weekStart).length
    const cancelledThisWeek = rows.filter(p => stageOf(p) === 'cancelled' && p.fulfillment_completed_at
      && new Date(p.fulfillment_completed_at).getTime() >= weekStart).length
    const inProgress = rows.filter(p => stageOf(p) === 'inProgress').length
    const waiting = rows.filter(p => stageOf(p) === 'booked').length
    return { todays, missed, missedAll, upcoming, bookedThisWeek, cancelledThisWeek, inProgress, waiting }
  }, [rows, now])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    timeZone: profile?.timezone || undefined, weekday: 'long', month: 'short', day: 'numeric',
  })
  const open = id => navigate(`/agent/clients?open=${id}`)
  const upcoming = g.upcoming.slice(0, UPCOMING_LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 26, fontWeight: 500, letterSpacing: '-0.015em', color: 'var(--text-primary)' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            {isLoading ? 'Loading your calls…'
              : g.todays.length ? `${g.todays.length} call${g.todays.length === 1 ? '' : 's'} on the books today.`
                : 'Nothing on the books today yet.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="hidden sm:inline" style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{dateLabel}</span>
          <span className="hidden sm:inline"><LiveClock timezone={profile?.timezone} /></span>
          <button onClick={() => navigate('/agent/book')} style={primaryBtn}>
            <CalendarPlus size={16} /> Book a call
          </button>
        </div>
      </div>

      <StatGrid>
        <StatTile label="Booked this week" value={isLoading ? '—' : g.bookedThisWeek} sub="since Monday"
          onClick={() => navigate('/agent/clients?range=week&stage=all')} />
        <StatTile label="With Fulfillment" value={isLoading ? '—' : g.waiting + g.inProgress}
          sub={`${g.inProgress} being worked · ${g.waiting} waiting`} onClick={() => navigate('/agent/clients?stage=all')} />
        <StatTile label="Cancelled this week" value={isLoading ? '—' : g.cancelledThisWeek} sub="old policy confirmed cancelled"
          onClick={() => navigate('/agent/clients?stage=cancelled')} />
        <StatTile label="Not picked up" value={isLoading ? '—' : g.missedAll.length} tone={g.missedAll.length ? 'warning' : 'neutral'}
          sub="booked time passed, still waiting" onClick={() => navigate('/agent/clients?stage=missed')} />
      </StatGrid>

      {g.missed.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16,
            background: 'var(--warning-dim)', border: 'var(--border-w) solid var(--warning-bd)', color: 'var(--warning)',
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>
              {g.missed.length} booked time{g.missed.length === 1 ? '' : 's'} passed and Fulfillment hasn't picked {g.missed.length === 1 ? 'it' : 'them'} up.
              Open one to move it or give Fulfillment a heads-up.
            </p>
          </div>
          <ListCard head style={{ marginTop: 10 }}>
            {g.missed.map((p, i) => <ClientRow key={p.id} p={p} now={now} first={i === 0} onClick={() => open(p.id)} />)}
          </ListCard>
        </div>
      )}

      <div>
        <SectionHead
          title="Your calls"
          sub="When Fulfillment is calling your clients"
          action={(
            <button onClick={() => navigate('/agent/clients')} style={ghostBtn}>
              All my clients <ArrowRight size={14} />
            </button>
          )}
        />
        <ListCard
          head={g.todays.length > 0 || upcoming.length > 0}
          empty={<EmptyNote>{isLoading ? 'Loading…' : 'No calls today or coming up. Book one when your next client says yes.'}</EmptyNote>}
        >
          {g.todays.length > 0 && <GroupRow label="Today" first />}
          {g.todays.map(p => <ClientRow key={p.id} p={p} now={now} onClick={() => open(p.id)} />)}
          {upcoming.length > 0 && <GroupRow label={g.todays.length ? 'Coming up' : 'Coming up · nothing today'} first={g.todays.length === 0} />}
          {upcoming.map(p => <ClientRow key={p.id} p={p} now={now} onClick={() => open(p.id)} />)}
        </ListCard>
      </div>
    </div>
  )
}
