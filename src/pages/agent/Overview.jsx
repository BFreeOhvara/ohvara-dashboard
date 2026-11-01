import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PhoneIncoming } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useAgentBookings } from '../../hooks/useAgentBookings'
import { useOverviewBook } from '../../hooks/useOverviewBook'
import { HeroPanel, LoadError } from '../../components/agent/AgentUI'
import { BookRow, WeekSubmissions, ComingUpSteps, StepsDoneChart, GetLeadsCard } from '../../components/agent/OverviewBlocks'
import { stageOf, agentStageOf, tabOf, useNow } from '../../lib/agentBookings'
import { addDaysStr } from '../../lib/scheduling'
import { DEFAULT_TIMEZONE, zonedDateStr } from '../../lib/timezones'
import { LiveDot } from '../../components/ui/LiveDot'
import { fullName } from '../../lib/policyFormat'
import { usePhoneLayout } from '../../hooks/usePhoneLayout'
import { PhoneHome } from '../../components/agent/phone/PhoneHome'
import { TodayCards, TodayStrip, AttentionWithTexts, useAppointmentsLeftToday } from '../../components/agent/TodayCards'

// Agent Overview (Prompt 665) — the landing page. "Your day at a glance".
//
// Prompt 714 — v2, the pilot for the portal-wide visual upgrade: a hero
// (greeting, big clock, Submit), a chart, and a "Needs your attention" list
// with a next step per No answer client. Everything the attention box shows
// comes from the useAgentBookings rows already loaded.
//
// Prompt 723 — the side box has two states: amber "Needs your attention" when
// a client didn't pick up, otherwise "You're all caught up" with the next
// booked calls ("Up next").
//
// Prompt 732 — "Needs your attention" is the Needs attention tab and nothing
// else: a No answer client is Fulfillment's to work, so it never shows here.
// The rows only open My Pipeline on that client; nothing starts from here.
//
// Portal parity T3 — for an agent with Leads, Today's cards (TodayCards) sit under the
// hero (on a phone, under PhoneHome) and Texts waiting folds into the attention box.
//
// Servicing Overview (Agent Portal Servicing Spec, Overview) — the page is about looking after the agent's
// book, not counting cancellations: Your book (four stage tiles), This week (submissions used), Coming up
// (next steps) and Steps done (last week, four kinds) replace the Booked / Cancelled trend cards and chart.
// The whole Today strip (appointments, live transfers, New leads) shows only for an agent who has Leads;
// otherwise one small Get leads card takes its place. An agent with Leads and no Servicing
// (profile.has_servicing === false, the Submit.jsx:37 test) sees only the Leads panels, filling the screen.
// The numbers come from useOverviewBook() (src/hooks/useOverviewBook.js); the blocks are in OverviewBlocks.jsx.

// Days are YYYY-MM-DD strings in the agent's profile zone (Prompt 768), the zone the weekly cap and the
// Overview's data layer (src/lib/overviewBook.js) use.
const hourIn = (ms, tz) => +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) % 24

// One-screen mode: from 1280px wide and 700px tall the page fits the height under the header (the .ov-fitag rules
// in index.css, switched on in DashboardLayout for /agent). Shorter or narrower it scrolls as before. This hook
// decides what only JS can: the row cap, the scrolling list and the Today strip.
const FIT_QUERY = '(min-width: 1280px) and (min-height: 700px)'
function useFit() {
  const [fit, setFit] = useState(() => typeof window !== 'undefined' && window.matchMedia(FIT_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(FIT_QUERY)
    const on = () => setFit(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return fit
}

// Needs attention first, then Confirm number, then the rest.
const ATTN_RANK = { needsAttention: 0, confirmNumber: 1 }
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`

export default function Overview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const phone = usePhoneLayout()
  const fit = useFit() && !phone
  const now = useNow()
  const { data: rows = [], isLoading: loadingRows, isError, refetch } = useAgentBookings(profile?.id)
  // A failed load shows dashes, not zeros (Prompt 768).
  const isLoading = loadingRows || isError
  const ov = useOverviewBook()
  const { hasLeads, hasServicing, leadsStatus } = ov
  // A Leads buyer is known at once; anyone else waits for the lead list before the Get leads card shows.
  const getLeads = !hasLeads && leadsStatus === 'ready'
  const left = useAppointmentsLeftToday()

  const tz = profile?.timezone || DEFAULT_TIMEZONE

  const g = useMemo(() => {
    const today = zonedDateStr(now, tz)
    const ms = iso => new Date(iso).getTime()
    const dayOf = iso => (iso ? zonedDateStr(ms(iso), tz) : null)
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
      todays: rows.filter(p => dayOf(p.scheduled_call_at) === today).length,
      live: rows.filter(p => stageOf(p) === 'inProgress'),
      attention,
      upcoming,
    }
  }, [rows, now, tz])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = hourIn(now, tz)
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''}`
  const dateLabel = month => new Date(now).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month, day: 'numeric',
  })
  const tomorrow = addDaysStr(zonedDateStr(now, tz), 1)
  const tomorrowSteps = ov.steps.dueSoon.filter(s => zonedDateStr(new Date(s.dueAt).getTime(), tz) === tomorrow).length
  const sub = hasServicing
    ? (ov.steps.dueSoonStatus === 'error' ? 'Couldn’t load your steps.'
      : ov.steps.dueSoonStatus === 'loading' ? 'Loading your steps…'
        : tomorrowSteps ? `${plural(tomorrowSteps, 'step')} scheduled for tomorrow.` : 'Nothing scheduled for tomorrow.')
    : (left.failed ? 'Couldn’t load your appointments.'
      : left.loading ? 'Loading your appointments…'
        : left.count ? `${plural(left.count, 'appointment')} left today.` : 'No appointments left today.')

  // Prompt 772 — the phone layout's Home, from the same numbers.
  if (phone) {
    const home = <PhoneHome g={g} ov={ov} greeting={greeting} sub={sub} isLoading={isLoading} isError={isError} refetch={refetch} now={now} tz={tz} />
    return (
      <div className="tc-phone">
        {home}
        {hasLeads && hasServicing && <h2 className="ph-h2" style={{ margin: '6px 0 -6px' }}>Your leads today</h2>}
        {hasLeads && <TodayCards showTexts />}
        {getLeads && <GetLeadsCard />}
      </div>
    )
  }

  const hero = (
    <HeroPanel
      fit={fit} greeting={greeting} sub={sub} timezone={profile?.timezone}
      dateLong={dateLabel('long')} dateShort={dateLabel('short')}
      onBook={() => navigate('/agent/submit')}
      action={hasServicing ? undefined : { label: 'Open Leads', icon: PhoneIncoming, onClick: () => navigate('/agent/leads') }}
    />
  )

  // Leads only: no book, no weekly count, no steps. The Leads panels take the whole page.
  if (!hasServicing) {
    return (
      <div className="ag-page flex flex-col gap-[14px] sm:gap-5" data-ov="leads-only">
        {hero}
        {hasLeads ? <TodayCards fitGrid={fit} showTexts={!fit} /> : getLeads ? <GetLeadsCard /> : null}
      </div>
    )
  }

  return (
    <div className="ag-page flex flex-col gap-[14px] sm:gap-5">
      {hero}

      {isError && <LoadError what="your calls" onRetry={() => refetch()} className="ag-err" />}

      {g.live.length > 0 && (
        <div className="ag-call" style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16,
          background: 'var(--danger-dim)', border: 'var(--border-w) solid var(--danger-bd)', color: 'var(--danger)',
        }}>
          <LiveDot size={10} />
          <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>
            Fulfillment is on a call with {g.live.map(fullName).join(', ')} right now.
          </p>
        </div>
      )}

      <BookRow book={ov.book} onRetry={ov.refetch} />

      {hasLeads && (fit ? <TodayStrip /> : <TodayCards />)}

      <div className="ov-grid ov-grid--svc">
        <AttentionWithTexts items={g.attention} loading={isLoading} upcoming={g.upcoming} now={now} onGo={navigate} fit={fit} slim={fit} />

        <div className="ag-chartw" style={{ gridArea: 'chart', display: 'flex', minWidth: 0 }}>
          <StepsDoneChart days={ov.steps.doneByDay} status={ov.steps.doneStatus} savesKnown={ov.steps.savesKnown} onRetry={ov.refetch} fit={fit} />
        </div>

        <div className="ov-side" style={{ gridArea: 'side' }}>
          <WeekSubmissions submissions={ov.submissions} tz={tz} onRetry={ov.refetch} />
          <ComingUpSteps steps={ov.steps.dueSoon} status={ov.steps.dueSoonStatus} now={now} tz={tz} onRetry={ov.refetch} fit={fit} />
          {getLeads && <GetLeadsCard />}
        </div>
      </div>
    </div>
  )
}
