import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { useRepCallEvents } from '../../hooks/useRepCallEvents'
import { HeroPanel, TrendCard, LastWeekChart } from '../../components/agent/AgentUI'
import { YourDayCard, LiveCallStrips } from '../../components/fulfillment/FulfillUI'
import { isLive, useNow } from '../../lib/agentBookings'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import { weekFrame, weekStats, buildDay, timeParts, timeText, inLabel } from '../../lib/fulfillmentDay'

// Fulfillment Overview (Prompt 681), rebuilt in Prompt 745: the agent
// Overview's layout (hero, two trend cards, the right-hand box, the Last week
// chart) scoped to the signed-in rep. No team tiles, no Needs attention: a No
// answer just stays on the calendar. Admin gets the same page for the whole
// team (copy swaps only). Every row opens the item on the desk
// (/fulfillment/desk?open=<id>). All day and week maths is in the profile's
// zone (lib/fulfillmentDay.js).

export default function FulfillmentOverview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const team = profile?.role === 'admin'
  const tz = profile?.timezone || DEFAULT_TIMEZONE
  const { data: queue = [], isLoading: queueLoading } = useFulfillmentQueue()
  const rows = useMemo(
    () => (team ? queue : queue.filter(p => p.assigned_fulfillment_id === profile?.id)),
    [queue, team, profile?.id],
  )
  const anyLive = rows.some(isLive)

  const todayStr = zonedDateStr(now, tz)
  const frame = useMemo(() => weekFrame(todayStr, tz), [todayStr, tz])
  const { data: events = [], isLoading: eventsLoading } = useRepCallEvents(
    new Date(frame.sinceMs).toISOString(), team ? null : profile?.id, { live: anyLive },
  )
  const isLoading = queueLoading || eventsLoading || !profile

  const stats = useMemo(() => weekStats(
    frame,
    events.map(e => e.at),
    rows.filter(p => p.fulfillment_stage === 'Complete' && p.fulfillment_completed_at).map(p => p.fulfillment_completed_at),
  ), [frame, events, rows])

  const day = useMemo(() => {
    const d = buildDay(rows, now, tz, { team })
    const tile = e => (e ? { ...e, ...timeParts(e.at, tz) } : e)
    return { ...d, next: tile(d.next), rest: d.rest.map(tile), first: d.first }
  }, [rows, now, tz, team])
  const live = useMemo(() => rows.filter(isLive), [rows])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`
  const dateLabel = month => new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month, day: 'numeric' })
  const shortDay = new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })

  const open = id => navigate(`/fulfillment/desk?open=${id}`)
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const where = team ? ' across the team' : ''

  const sub = isLoading ? 'Loading your calls…'
    : day.left > 0 ? `${plural(day.left, 'call')} to go${team ? ' across the team' : ''} today.${day.next ? ` Next up at ${timeText(day.next.at, tz)}.` : ''}`
      : live.length ? (team ? 'The team is on a call.' : 'You’re on a call.')
        : team ? 'Nothing else on the team’s calendar today.' : 'Nothing else on your calendar today.'
  const action = day.first
    ? { label: team ? 'Open the next call' : 'Open your next call', icon: Phone, onClick: () => open(day.first.id) }
    : { label: 'Open the desk', icon: Phone, onClick: () => navigate('/fulfillment/desk') }

  const countLine = `${plural(day.total, 'call')} on ${team ? 'the' : 'your'} calendar${where} today. ${day.done.length} done, ${day.left} to go.`
  const dash = v => (isLoading ? '—' : v)

  return (
    <div className="flex flex-col gap-[14px] sm:gap-5">
      <HeroPanel
        greeting={greeting} sub={sub} timezone={tz}
        dateLong={dateLabel('long')} dateShort={dateLabel('short')}
        action={action}
      />

      <LiveCallStrips live={live} now={now} team={team} onOpen={open} />

      <div className="ov-grid">
        <div className="grid grid-cols-2 gap-[14px] sm:gap-5" style={{ gridArea: 'trend', minWidth: 0 }}>
          <TrendCard
            label="Calls made this week" icon={Phone} tone="a"
            value={dash(stats.calls.value)} diff={isLoading ? null : stats.calls.diff}
            week={stats.calls.week} todayIdx={frame.todayIdx}
            onClick={() => navigate('/fulfillment/pipeline')}
          />
          <TrendCard
            label="Cancelled this week" icon={Check} tone="b"
            value={dash(stats.cancelled.value)} diff={isLoading ? null : stats.cancelled.diff}
            week={stats.cancelled.week} todayIdx={frame.todayIdx}
            onClick={() => navigate('/fulfillment/pipeline?stage=cancelled')}
          />
        </div>

        <YourDayCard
          title={team ? 'Today' : 'Your day'} dateLabel={shortDay} loading={isLoading} countLine={countLine}
          next={day.next} nextIn={day.next ? inLabel(day.next.ms, now) : ''}
          later={day.rest} more={day.more}
          done={day.done} doneTime={iso => timeText(iso, tz)}
          onOpen={open} onCalendar={() => navigate(`/fulfillment/desk?day=${todayStr}`)}
          calendarLabel={team ? 'See the calendar' : 'See your calendar'}
        />

        <div style={{ gridArea: 'chart', display: 'flex', minWidth: 0 }}>
          <LastWeekChart
            days={stats.lastWeek} loading={isLoading}
            subtitle={team ? 'calls made and old policies confirmed cancelled' : 'calls you made and old policies confirmed cancelled'}
            firstLabel="Calls" firstWord="calls" emptyText="No calls last week."
          />
        </div>
      </div>
    </div>
  )
}
