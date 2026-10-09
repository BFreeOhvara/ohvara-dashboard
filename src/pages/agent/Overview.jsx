import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { HeroPanel, TrendCard, AttentionCard, ComingUpCard, LastWeekChart } from '../../components/agent/AgentUI'
import { stageOf, agentStageOf, tabOf, sameLocalDay, startOfWeek, useNow } from '../../lib/agentBookings'
import { LiveDot } from '../../components/ui/LiveDot'
import { fullName } from '../../lib/policyFormat'

// Agent Overview (Prompt 665) — the landing page. "Your day at a glance".
//
// Prompt 714 — v2, the pilot for the portal-wide visual upgrade: a hero
// (greeting, big clock, Book a call), two trend cards against last week, a
// chart, and a "Needs your attention" list with a next step per No answer
// client. The With Fulfillment tile and the "Your calls" list are gone.
// Everything comes from the useAgentBookings rows already loaded.
//
// Prompt 723 — the side box has two states: amber "Needs your attention" when
// a client didn't pick up, otherwise "You're all caught up" with the next
// booked calls. The chart is last Monday to Sunday (was 14 days), and the
// box's button is the blue .ov-primary.
//
// Prompt 732 — "Needs your attention" is the Needs attention tab and nothing
// else: a No answer client is Fulfillment's to work, so it never shows here.
// The rows only open My Pipeline on that client; nothing starts from here.
//
// Prompt 672 — the trend cards open My Clients on the matching slice of its
// Pipeline (?range= / ?stage=).

const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Needs attention first, then Confirm number, then the rest.
const ATTN_RANK = { needsAttention: 0, confirmNumber: 1 }

export default function Overview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow()
  const { data: rows = [], isLoading } = useAgentBookings(profile?.id)

  const g = useMemo(() => {
    const today = new Date(now)
    const weekStart = startOfWeek(today)
    const lastWeekStart = addDays(weekStart, -7)
    const ms = iso => new Date(iso).getTime()

    // Booked = when the call was booked; Cancelled = when the old policy was
    // confirmed cancelled.
    const bookedAt = rows.map(p => p.created_at).filter(Boolean)
    const cancelledAt = rows
      .filter(p => stageOf(p) === 'cancelled' && p.fulfillment_completed_at)
      .map(p => p.fulfillment_completed_at)
    const since = (list, from) => list.filter(iso => ms(iso) >= from.getTime()).length
    const between = (list, from, to) => list.filter(iso => ms(iso) >= from.getTime() && ms(iso) < to.getTime()).length
    const onDay = (list, day) => list.filter(iso => sameLocalDay(iso, day)).length

    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    // Last Monday to Sunday (weeks run Monday to Sunday everywhere).
    const lastWeek = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(lastWeekStart, i)
      return { date, booked: onDay(bookedAt, date), cancelled: onDay(cancelledAt, date) }
    })

    const bookedThisWeek = since(bookedAt, weekStart)
    const cancelledThisWeek = since(cancelledAt, weekStart)
    const lastCall = p => (p.last_call_at ? ms(p.last_call_at) : 0)
    const attention = rows
      .filter(p => tabOf(p) === 'needs')
      .sort((a, b) => (ATTN_RANK[agentStageOf(a)] ?? 2) - (ATTN_RANK[agentStageOf(b)] ?? 2) || lastCall(a) - lastCall(b))
    // Booked calls still ahead, soonest first (live, cancelled and no-answer
    // rows are not "booked").
    const upcoming = rows
      .filter(p => stageOf(p) === 'booked' && p.scheduled_call_at && ms(p.scheduled_call_at) > now)
      .sort((a, b) => ms(a.scheduled_call_at) - ms(b.scheduled_call_at))

    return {
      todays: rows.filter(p => sameLocalDay(p.scheduled_call_at, today)).length,
      live: rows.filter(p => stageOf(p) === 'inProgress'),
      todayIdx: (today.getDay() + 6) % 7,
      booked: {
        value: bookedThisWeek,
        diff: bookedThisWeek - between(bookedAt, lastWeekStart, weekStart),
        week: weekDays.map(d => onDay(bookedAt, d)),
      },
      cancelled: {
        value: cancelledThisWeek,
        diff: cancelledThisWeek - between(cancelledAt, lastWeekStart, weekStart),
        week: weekDays.map(d => onDay(cancelledAt, d)),
      },
      lastWeek,
      attention,
      upcoming,
    }
  }, [rows, now])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = new Date(now).getHours()
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`
  const dateLabel = month => new Date(now).toLocaleDateString('en-US', {
    timeZone: profile?.timezone || undefined, weekday: 'long', month, day: 'numeric',
  })
  const sub = isLoading ? 'Loading your calls…'
    : g.todays ? `${g.todays} call${g.todays === 1 ? '' : 's'} on the books today.`
      : 'Nothing on the books today yet.'

  return (
    <div className="flex flex-col gap-[14px] sm:gap-5">
      <HeroPanel
        greeting={greeting} sub={sub} timezone={profile?.timezone}
        dateLong={dateLabel('long')} dateShort={dateLabel('short')}
        onBook={() => navigate('/agent/book')}
      />

      {g.live.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16,
          background: 'var(--danger-dim)', border: 'var(--border-w) solid var(--danger-bd)', color: 'var(--danger)',
        }}>
          <LiveDot size={10} />
          <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>
            Fulfillment is on a call with {g.live.map(fullName).join(', ')} right now.
          </p>
        </div>
      )}

      <div className="ov-grid">
        <div className="grid grid-cols-2 gap-[14px] sm:gap-5" style={{ gridArea: 'trend', minWidth: 0 }}>
          <TrendCard
            label="Booked this week" icon={CalendarPlus} tone="a"
            value={isLoading ? '—' : g.booked.value} diff={isLoading ? null : g.booked.diff}
            week={g.booked.week} todayIdx={g.todayIdx}
            onClick={() => navigate('/agent/clients?range=week&stage=all')}
          />
          <TrendCard
            label="Cancelled this week" icon={Check} tone="b"
            value={isLoading ? '—' : g.cancelled.value} diff={isLoading ? null : g.cancelled.diff}
            week={g.cancelled.week} todayIdx={g.todayIdx}
            onClick={() => navigate('/agent/clients?stage=cancelled')}
          />
        </div>

        {isLoading || g.attention.length > 0
          ? <AttentionCard items={g.attention} loading={isLoading} onGo={navigate} />
          : <ComingUpCard upcoming={g.upcoming} now={now} onGo={navigate} />}

        <div style={{ gridArea: 'chart', display: 'flex', minWidth: 0 }}>
          <LastWeekChart days={g.lastWeek} loading={isLoading} />
        </div>
      </div>
    </div>
  )
}
