import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Phone } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { DayFilterBar, useDayFilter, toUtcDateStr } from '../../components/ui/DayFilterBar'

// The feed is strictly outcome-driven: a calls row exists only when a lead
// was moved to a real outcome (Appointment Booked / No Answer / Not
// Interested / Follow-Up), and the row is deleted if the rep reverts the
// lead to New — so the feed self-corrects. No other event types are logged.
const FEED_OUTCOMES = ['Appointment Booked', 'No Answer', 'Not Interested', 'Follow-Up']

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function ActivityFeed() {
  const { profile } = useAuth()
  // Single-day-only, always (Prompt 227) — no "All days" escape hatch.
  // Buckets by UTC calendar date, matching the boundary assign_daily_batches()
  // (pg_cron, supabase/migrations/016_daily_batch_cron.sql) actually uses —
  // CURRENT_DATE with zero per-rep timezone adjustment. Browser-local would
  // disagree with what the rest of the dashboard considers "today" (Prompt 223
  // investigation, see brain/Memories.md).
  const { todayStr, selectedDate, setSelectedDate } = useDayFilter()

  const { data: calls, isLoading } = useQuery({
    queryKey: ['activity', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select(`*, lead:leads(business_name, contact_name)`)
        .eq('rep_id', profile.id)
        .in('outcome', FEED_OUTCOMES)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const items = (calls || [])
    .map(c => ({
      id: c.id,
      type: 'call',
      label: `Called ${c.lead?.business_name}`,
      sub: `Outcome: ${c.outcome}`,
      status: c.outcome,
      time: c.created_at,
    }))
    .filter(item => toUtcDateStr(item.time) === selectedDate)

  return (
    // 60px = one FeedItem row's rendered footprint (56px box + 4px space-y-1
    // gap, measured from live CSS) — shaves exactly one row off the bottom
    // per Prompt 202, so the box no longer ends flush with the last row.
    <div style={{ height: 'calc(100vh - 48px - 60px)', display: 'flex', flexDirection: 'column' }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">Activity Feed</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">Call outcomes — booked, follow-up, no answer, not interested</p>
        </div>

        <DayFilterBar selectedDate={selectedDate} todayStr={todayStr} onChange={setSelectedDate} />
      </div>

      <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-[var(--bg-2)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !items.length ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Bell className="text-[var(--text-muted)] mb-2" size={24} />
            <p className="text-[var(--text-muted)] text-sm">
              {selectedDate === todayStr
                ? 'No activity today'
                : `No activity on ${MONTH_NAMES[+selectedDate.slice(5, 7) - 1].slice(0, 3)} ${+selectedDate.slice(8)}`}
            </p>
          </div>
        ) : (
          <div className="space-y-1 scrollbar-thin" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {items.map(item => (
              <FeedItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// Same status color scheme as the Call Now modal / Badge. Exported so My
// Calls can reuse the exact same outcome → color mapping instead of a
// second copy that could drift (Prompt 194).
export const STATUS_COLORS = {
  'New':                { color: '#38BDF8', dim: 'rgba(56,189,248,0.10)' },
  'Appointment Booked': { color: '#22C55E', dim: 'rgba(34,197,94,0.10)' },
  'No Answer':          { color: '#94A3B8', dim: 'rgba(148,163,184,0.10)' },
  'Not Interested':     { color: '#EF4444', dim: 'rgba(239,68,68,0.10)' },
  'Follow-Up':          { color: '#F59E0B', dim: 'rgba(245,158,11,0.10)' },
}

function FeedItem({ item }) {
  const sc = item.status ? STATUS_COLORS[item.status] : null

  const icons = {
    call: <Phone size={14} style={sc ? { color: sc.color } : undefined} className={sc ? undefined : 'text-[var(--accent)]'} />,
  }

  return (
    <div
      className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-[var(--bg-2)] transition-colors"
      style={sc ? { borderLeft: `2px solid ${sc.color}` } : { borderLeft: '2px solid transparent' }}
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: sc ? sc.dim : 'var(--bg-3)' }}
      >
        {icons[item.type] || <Bell size={14} className="text-[var(--text-secondary)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)]">{item.label}</p>
        {item.sub && (
          <p className="text-xs" style={{ color: sc ? sc.color : 'var(--text-muted)' }}>{item.sub}</p>
        )}
      </div>
      <p className="text-xs text-[var(--text-muted)] flex-shrink-0">{formatTime(item.time)}</p>
    </div>
  )
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (isToday) return `Today ${time}`
  if (isYesterday) return `Yesterday ${time}`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`
}
