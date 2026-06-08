import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Phone, Calendar, RefreshCw } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { clsx } from 'clsx'

export default function ActivityFeed() {
  const { profile } = useAuth()

  const { data: calls, isLoading } = useQuery({
    queryKey: ['activity', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select(`*, lead:leads(business_name, contact_name)`)
        .eq('rep_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
    enabled: !!profile?.id,
  })

  const { data: reEngaged } = useQuery({
    queryKey: ['re_engagement', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('re_engagement_log')
        .select(`*, lead:leads(business_name, assigned_rep_id)`)
        .eq('status', 'replied')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data || []).filter(r => r.lead?.assigned_rep_id === profile.id)
    },
    enabled: !!profile?.id,
  })

  const items = [
    ...(reEngaged || []).map(r => ({
      id: r.id,
      type: 're_engaged',
      label: `${r.lead?.business_name} replied to re-engagement`,
      time: r.created_at,
    })),
    ...(calls || []).map(c => ({
      id: c.id,
      type: 'call',
      label: `Called ${c.lead?.business_name}`,
      sub: c.outcome ? `Outcome: ${c.outcome}` : null,
      time: c.created_at,
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">Activity Feed</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Recent calls, assignments, and replies</p>
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-[var(--bg-2)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !items.length ? (
          <div className="text-center py-10">
            <Bell className="text-[var(--text-muted)] mx-auto mb-2" size={24} />
            <p className="text-[var(--text-muted)] text-sm">No activity yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {items.map(item => (
              <FeedItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function FeedItem({ item }) {
  const icons = {
    call:        <Phone size={14} className="text-[var(--accent)]" />,
    re_engaged:  <RefreshCw size={14} className="text-[var(--success)]" />,
    booked:      <Calendar size={14} className="text-[var(--warning)]" />,
  }

  return (
    <div className="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-[var(--bg-2)] transition-colors">
      <div className="w-7 h-7 rounded-full bg-[var(--bg-3)] flex items-center justify-center flex-shrink-0 mt-0.5">
        {icons[item.type] || <Bell size={14} className="text-[var(--text-secondary)]" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--text-primary)]">{item.label}</p>
        {item.sub && <p className="text-xs text-[var(--text-muted)]">{item.sub}</p>}
      </div>
      <p className="text-xs text-[var(--text-muted)] flex-shrink-0">{formatTime(item.time)}</p>
    </div>
  )
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return d.toLocaleDateString()
}
