import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { ghostBtn, MONO, DISPLAY } from '../../lib/exportStyles'
import { LiveClock } from '../../components/ui/LiveClock'
import { StatTile, StatGrid, SectionHead, ListCard, EmptyNote } from '../../components/agent/AgentUI'
import { FulfillHead, FulfillRow } from '../../components/fulfillment/FulfillUI'
import { needsAttention } from '../../lib/fulfillmentFlags'
import { sameLocalDay, startOfWeek, startOfMonth, median, hoursBetween, fmtDuration, useNow } from '../../lib/agentBookings'

// Fulfillment Overview (Prompt 681) — the Fulfillment role's landing page.
// A step back from the desk: how the whole team is doing this week and month,
// what needs attention across everyone, and today's calls. The desk
// (/fulfillment/desk) stays the place work actually gets
// done; every row here opens the item there.
//
// Laid out like the agent Overview (greeting + clock row, four eyebrow tiles,
// tinted attention banner, one list card) so both sides read as one product.

export default function FulfillmentOverview() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = useNow(30e3)
  const { data: rows = [], isLoading } = useFulfillmentQueue()

  const g = useMemo(() => {
    const today = new Date(now)
    const weekStart = startOfWeek(today).getTime()
    const monthStart = startOfMonth(today).getTime()
    const open = rows.filter(p => p.fulfillment_stage !== 'Complete')
    const done = rows.filter(p => p.fulfillment_stage === 'Complete' && p.fulfillment_completed_at)
    const since = (list, t) => list.filter(p => new Date(p.fulfillment_completed_at).getTime() >= t)
    const doneWeek = since(done, weekStart)
    const doneMonth = since(done, monthStart)
    // Prompt 684 — nothing waits to be claimed now; every booking already has
    // a rep. What's left to watch is calls the reps haven't started yet.
    const toCall = open.filter(p => p.fulfillment_stage !== 'In Progress')
      .sort((a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9'))
    const unassigned = open.filter(p => !p.assigned_fulfillment_id)
    const attention = open.filter(p => needsAttention(p, now))
      .sort((a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9'))
    const todays = open.filter(p => sameLocalDay(p.scheduled_call_at, today))
      .sort((a, b) => a.scheduled_call_at.localeCompare(b.scheduled_call_at))
    // Today's flagged items already show (with their pill) in Today's calls;
    // the attention list only needs the older ones. The tile counts all.
    const attentionOlder = attention.filter(p => !sameLocalDay(p.scheduled_call_at, today))
    // Booked → cancelled, this month: how long a client waits end to end.
    const turnaround = median(doneMonth.map(p => hoursBetween(p.created_at, p.fulfillment_completed_at)))

    return { toCall, unassigned, attention, attentionOlder, todays, doneWeek, doneMonth, turnaround, open }
  }, [rows, now])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    timeZone: profile?.timezone || undefined, weekday: 'long', month: 'short', day: 'numeric',
  })
  const open = id => navigate(`/fulfillment/desk?open=${id}`)
  const dash = v => (isLoading ? '—' : v)
  const nextCall = g.toCall.find(p => p.scheduled_call_at && new Date(p.scheduled_call_at) >= now)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: 26, fontWeight: 500, letterSpacing: '-0.015em', color: 'var(--text-primary)' }}>
            {greeting}{firstName ? `, ${firstName}` : ''}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>
            {isLoading ? 'Loading the team’s cancellations…'
              : g.todays.length ? `${g.todays.length} call${g.todays.length === 1 ? '' : 's'} on the books today across the team.`
                : 'No calls on the books today.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span className="hidden sm:inline" style={{ fontFamily: MONO, fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{dateLabel}</span>
          <LiveClock timezone={profile?.timezone} large />
        </div>
      </div>

      <StatGrid>
        <StatTile label="Cancelled this week" value={dash(g.doneWeek.length)} sub={`${g.doneMonth.length} this month · whole team`}
          onClick={() => navigate('/fulfillment/pipeline?stage=cancelled')} />
        <StatTile label="Not started yet" value={dash(g.toCall.length)}
          sub={g.unassigned.length ? `${g.unassigned.length} with no rep yet`
            : nextCall ? `next call ${new Date(nextCall.scheduled_call_at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
              : 'nothing booked ahead'}
          tone={g.unassigned.length ? 'warning' : 'neutral'}
          onClick={() => navigate('/fulfillment/desk')} />
        <StatTile label="Needs attention" value={dash(g.attention.length)} tone={g.attention.length ? 'warning' : 'neutral'}
          sub="overdue callbacks or stale" onClick={() => navigate('/fulfillment/pipeline?stage=attention')} />
        <StatTile label="Booked to cancelled" value={dash(fmtDuration(g.turnaround))} sub="median, this month" />
      </StatGrid>

      {g.attention.length > 0 && (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16,
            background: 'var(--warning-dim)', border: 'var(--border-w) solid var(--warning-bd)', color: 'var(--warning)',
          }}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <p style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 14, fontWeight: 500 }}>
              {g.attention.length} cancellation{g.attention.length === 1 ? ' is' : 's are'} overdue or sitting too long:
              a call time that's passed without being started, or started over two days ago and not finished.
              {g.attentionOlder.length < g.attention.length && ' Today’s are flagged in the list below.'}
            </p>
            <button onClick={() => navigate('/fulfillment/pipeline?stage=attention')} style={{ ...ghostBtn, height: 32 }}>
              See all <ArrowRight size={13} />
            </button>
          </div>
          {g.attentionOlder.length > 0 && (
            <ListCard style={{ marginTop: 10 }}>
              <FulfillHead />
              {g.attentionOlder.slice(0, 8).map((p, i) => <FulfillRow key={p.id} p={p} now={now} first={i === 0} onClick={() => open(p.id)} />)}
            </ListCard>
          )}
        </div>
      )}

      <div>
        <SectionHead
          title="Today’s calls"
          sub="Every client booked for today, whoever has them"
          action={(
            <button onClick={() => navigate('/fulfillment/pipeline')} style={ghostBtn}>
              Full pipeline <ArrowRight size={14} />
            </button>
          )}
        />
        <ListCard empty={<EmptyNote>{isLoading ? 'Loading…' : 'Nothing booked for today.'}</EmptyNote>}>
          {g.todays.length > 0 && <FulfillHead />}
          {g.todays.map((p, i) => <FulfillRow key={p.id} p={p} now={now} first={i === 0} onClick={() => open(p.id)} />)}
        </ListCard>
      </div>
    </div>
  )
}
