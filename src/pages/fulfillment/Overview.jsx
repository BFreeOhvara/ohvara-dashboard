import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useFulfillmentQueue } from '../../hooks/usePolicies'
import { useFulfillmentPay, useTimeEntries } from '../../hooks/useFulfillmentPay'
import { primaryBtn, ghostBtn, eyebrow, MONO, DISPLAY } from '../../lib/exportStyles'
import { LiveClock } from '../../components/ui/LiveClock'
import { Avatar } from '../../components/ui/Avatar'
import { StatTile, StatGrid, SectionHead, ListCard, EmptyNote } from '../../components/agent/AgentUI'
import { FulfillHead, FulfillRow } from '../../components/fulfillment/FulfillUI'
import { ClockCard } from '../../components/fulfillment/ClockCard'
import { needsAttention } from '../../lib/fulfillmentFlags'
import { sameLocalDay, startOfWeek, startOfMonth, median, hoursBetween, fmtDuration, useNow } from '../../lib/agentBookings'
import { payPeriod } from '../../lib/payPeriod'

// Fulfillment Overview (Prompt 681) — the Fulfillment role's landing page.
// A step back from the desk: how the whole team is doing this week and month,
// what needs attention across everyone, today's calls, and a per-rep
// breakdown. The desk (/fulfillment/desk) stays the place work actually gets
// done; every row here opens the item there.
//
// Laid out like the agent Overview (greeting + clock row, four eyebrow tiles,
// tinted attention banner, one list card) so both sides read as one product.

export default function FulfillmentOverview() {
  const { profile } = useAuth()
  const isRep = profile?.role === 'fulfillment'
  const navigate = useNavigate()
  const now = useNow(30e3)
  const { data: rows = [], isLoading } = useFulfillmentQueue()
  const { data: payRows = [] } = useFulfillmentPay(profile?.id, isRep)
  const { data: entries = [], isLoading: entriesLoading } = useTimeEntries(isRep ? profile.id : null, isRep ? payPeriod(now).start.toISOString() : null)

  const g = useMemo(() => {
    const today = new Date(now)
    const weekStart = startOfWeek(today).getTime()
    const monthStart = startOfMonth(today).getTime()
    const open = rows.filter(p => p.fulfillment_stage !== 'Complete')
    const done = rows.filter(p => p.fulfillment_stage === 'Complete' && p.fulfillment_completed_at)
    const since = (list, t) => list.filter(p => new Date(p.fulfillment_completed_at).getTime() >= t)
    const doneWeek = since(done, weekStart)
    const doneMonth = since(done, monthStart)
    const waiting = open.filter(p => !p.assigned_fulfillment_id)
    const attention = open.filter(p => needsAttention(p, now))
      .sort((a, b) => (a.scheduled_call_at || '9').localeCompare(b.scheduled_call_at || '9'))
    const todays = open.filter(p => sameLocalDay(p.scheduled_call_at, today))
      .sort((a, b) => a.scheduled_call_at.localeCompare(b.scheduled_call_at))
    // Today's flagged items already show (with their pill) in Today's calls;
    // the attention list only needs the older ones. The tile counts all.
    const attentionOlder = attention.filter(p => !sameLocalDay(p.scheduled_call_at, today))
    // Booked → cancelled, this month: how long a client waits end to end.
    const turnaround = median(doneMonth.map(p => hoursBetween(p.created_at, p.fulfillment_completed_at)))

    const reps = new Map()
    const rep = (id, name) => {
      if (!reps.has(id)) reps.set(id, { id, name, onDesk: 0, week: 0, month: 0, hours: [] })
      return reps.get(id)
    }
    for (const p of open) if (p.assigned_fulfillment_id) rep(p.assigned_fulfillment_id, p.assigned?.full_name).onDesk++
    // A week can start in last month, so walk everything since the earlier boundary.
    for (const p of since(done, Math.min(weekStart, monthStart))) {
      if (!p.assigned_fulfillment_id) continue
      const r = rep(p.assigned_fulfillment_id, p.assigned?.full_name)
      const t = new Date(p.fulfillment_completed_at).getTime()
      if (t >= weekStart) r.week++
      if (t >= monthStart) {
        r.month++
        if (p.fulfillment_claimed_at) r.hours.push(hoursBetween(p.fulfillment_claimed_at, p.fulfillment_completed_at))
      }
    }
    const team = [...reps.values()]
      .map(r => ({ ...r, work: median(r.hours) }))
      .sort((a, b) => b.week - a.week || b.month - a.month || (a.name || '').localeCompare(b.name || ''))

    return { waiting, attention, attentionOlder, todays, doneWeek, doneMonth, turnaround, team, open }
  }, [rows, now])

  const firstName = (profile?.full_name || '').split(' ')[0]
  const hour = new Date(now).getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLabel = new Date(now).toLocaleDateString('en-US', {
    timeZone: profile?.timezone || undefined, weekday: 'long', month: 'short', day: 'numeric',
  })
  const open = id => navigate(`/fulfillment/desk?open=${id}`)
  const dash = v => (isLoading ? '—' : v)
  const oldestWaiting = g.waiting.reduce((a, b) => (!a || new Date(b.created_at) < new Date(a.created_at) ? b : a), null)

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
          <span className="hidden sm:inline"><LiveClock timezone={profile?.timezone} /></span>
          <button onClick={() => navigate('/fulfillment/desk')} style={primaryBtn}>
            {isRep ? 'Open my desk' : 'Open the desk'} <ArrowRight size={15} />
          </button>
        </div>
      </div>

      {isRep && <ClockCard entries={entries} pay={payRows[0]} now={now} loading={entriesLoading} />}

      <StatGrid>
        <StatTile label="Cancelled this week" value={dash(g.doneWeek.length)} sub={`${g.doneMonth.length} this month · whole team`}
          onClick={() => navigate('/fulfillment/pipeline?stage=cancelled')} />
        <StatTile label="Waiting to claim" value={dash(g.waiting.length)}
          sub={oldestWaiting ? `oldest booked ${fmtDuration(hoursBetween(oldestWaiting.created_at, now))} ago` : 'queue is clear'}
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
              a callback time that's passed, waiting over a day, or claimed over two days ago.
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

      <div>
        <SectionHead title="The team" sub="Who has what, and what each rep has cancelled" />
        <ListCard empty={<EmptyNote>{isLoading ? 'Loading…' : 'Nobody has claimed or cancelled anything yet this month.'}</EmptyNote>}>
          {g.team.length > 0 && (
            <div className="hidden md:grid md:grid-cols-[minmax(0,1.6fr)_100px_100px_100px_120px] items-center gap-x-4"
              style={{ ...eyebrow, padding: '11px 20px', background: 'var(--bg-elevated)' }}>
              <span>Rep</span>
              <span style={{ justifySelf: 'end' }}>On desk</span>
              <span style={{ justifySelf: 'end' }}>This week</span>
              <span style={{ justifySelf: 'end' }}>This month</span>
              <span style={{ justifySelf: 'end' }}>Claim → done</span>
            </div>
          )}
          {g.team.map((r, i) => (
            <div key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.6fr)_100px_100px_100px_120px] items-center gap-x-4 gap-y-1"
              style={{ padding: '14px 20px', borderTop: i ? 'var(--border-w) solid var(--border)' : 'none' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Avatar profile={{ full_name: r.name }} size={28} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name || 'Unknown'}{r.id === profile?.id && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> (you)</span>}
                </span>
              </span>
              <span className="md:hidden" style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                <b style={{ fontFamily: MONO, color: 'var(--text-primary)' }}>{r.week}</b> this week · <span style={{ fontFamily: MONO }}>{r.onDesk}</span> on desk
              </span>
              <Num value={r.onDesk} />
              <Num value={r.week} strong />
              <Num value={r.month} />
              <Num value={fmtDuration(r.work)} />
            </div>
          ))}
        </ListCard>
      </div>
    </div>
  )
}

function Num({ value, strong }) {
  return (
    <span className="hidden md:block"
      style={{ justifySelf: 'end', fontFamily: MONO, fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 600 : 400, color: 'var(--text-primary)' }}>
      {value}
    </span>
  )
}
