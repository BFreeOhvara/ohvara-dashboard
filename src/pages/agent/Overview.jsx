import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CalendarClock, Hourglass, CircleCheckBig, AlertTriangle, ArrowRight } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { card, cardTitle, primaryBtn, ghostBtn } from '../../lib/exportStyles'
import { StatTile, StatGrid, ClientRow, EmptyNote } from '../../components/agent/AgentUI'
import { stageOf, isMissed, sameLocalDay, startOfWeek, useNow } from '../../lib/agentBookings'

// Agent Overview (Prompt 665) — the landing page. "Your day at a glance":
// what's booked today, anything Fulfillment hasn't picked up yet, what's
// coming, and the week's numbers — with Book a call one tap away.

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
    // Today's misses already show (flagged) in the Today list; the warning
    // card only needs the older ones. The tile counts all of them.
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
  const greeting = new Date(now).getHours() < 12 ? 'Good morning' : new Date(now).getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div style={{ maxWidth: 1100, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>
            {isLoading ? 'Loading your calls…'
              : g.todays.length ? `${g.todays.length} call${g.todays.length === 1 ? '' : 's'} on the books today.`
                : 'Nothing on the books today yet.'}
          </p>
        </div>
        <button onClick={() => navigate('/agent/book')}
          style={{ ...primaryBtn, height: 40, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <CalendarPlus size={15} /> Book a call
        </button>
      </div>

      <StatGrid>
        <StatTile icon={CalendarClock} label="Booked this week" value={g.bookedThisWeek} tone={g.bookedThisWeek ? 'accent' : 'neutral'}
          sub="since Monday" />
        <StatTile icon={Hourglass} label="With Fulfillment" value={g.waiting + g.inProgress} tone={g.inProgress ? 'info' : 'neutral'}
          sub={`${g.inProgress} being worked · ${g.waiting} waiting`} />
        <StatTile icon={CircleCheckBig} label="Cancelled this week" value={g.cancelledThisWeek} tone="success"
          sub="old policy confirmed cancelled" />
        <StatTile icon={AlertTriangle} label="Not picked up" value={g.missedAll.length} tone={g.missedAll.length ? 'warning' : 'neutral'}
          sub="booked time passed, still waiting" />
      </StatGrid>

      {g.missed.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warning-bd)' }}>
          <p style={{ ...cardTitle, color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <AlertTriangle size={14} /> Booked time passed — Fulfillment hasn't picked these up
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {g.missed.map(p => <ClientRow key={p.id} p={p} now={now} onClick={() => navigate(`/agent/clients?open=${p.id}`)} />)}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Open one to move it to a new time, or give Fulfillment a heads-up.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={card}>
          <p style={cardTitle}>Today</p>
          {g.todays.length === 0 ? (
            <EmptyNote>No calls today. Book one when your next client says yes.</EmptyNote>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.todays.map(p => <ClientRow key={p.id} p={p} now={now} timeOnly onClick={() => navigate(`/agent/clients?open=${p.id}`)} />)}
            </div>
          )}
        </div>

        <div style={card}>
          <p style={cardTitle}>Coming up</p>
          {g.upcoming.length === 0 ? (
            <EmptyNote>Nothing booked past today.</EmptyNote>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.upcoming.slice(0, 6).map(p => <ClientRow key={p.id} p={p} now={now} onClick={() => navigate(`/agent/clients?open=${p.id}`)} />)}
            </div>
          )}
          <button onClick={() => navigate('/agent/clients')} style={{ ...ghostBtn, marginTop: 12 }}>
            All my clients <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
