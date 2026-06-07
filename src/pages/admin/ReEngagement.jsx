import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Badge } from '../../components/ui/Badge'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { RefreshCw, MessageSquare, Mail, CheckCircle } from 'lucide-react'

export default function ReEngagement() {
  const { data, isLoading } = useQuery({
    queryKey: ['re_engagement', 'admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('re_engagement_log')
        .select(`
          *,
          lead:leads(id, business_name, contact_name, phone, status)
        `)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const pending = data?.filter(r => r.status === 'pending') || []
  const sent = data?.filter(r => r.status === 'sent') || []
  const replied = data?.filter(r => r.status === 'replied') || []

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">Re-Engagement</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Twilio sequence tracking for Voicemail and No Answer leads</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Pending" value={pending.length} icon={RefreshCw} color="yellow" />
        <StatCard label="Sent" value={sent.length} icon={MessageSquare} color="indigo" />
        <StatCard label="Replied" value={replied.length} icon={CheckCircle} color="green" />
      </div>

      <Card>
        <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Sequence Log</p>

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-[var(--bg-2)] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !data?.length ? (
          <div className="text-center py-8">
            <RefreshCw className="text-[var(--text-muted)] mx-auto mb-2" size={24} />
            <p className="text-[var(--text-muted)] text-sm">No re-engagement sequences running</p>
            <p className="text-[var(--text-muted)] text-xs mt-1">
              Sequences trigger automatically at midnight CST for Voicemail / No Answer leads
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-3 py-2 text-xs text-[var(--text-muted)] font-medium text-left">Business</th>
                <th className="px-3 py-2 text-xs text-[var(--text-muted)] font-medium text-left">Step</th>
                <th className="px-3 py-2 text-xs text-[var(--text-muted)] font-medium text-left">Channel</th>
                <th className="px-3 py-2 text-xs text-[var(--text-muted)] font-medium text-left">Scheduled</th>
                <th className="px-3 py-2 text-xs text-[var(--text-muted)] font-medium text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map(row => (
                <tr key={row.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-2)]">
                  <td className="px-3 py-2.5">
                    <p className="text-[var(--text-primary)]">{row.lead?.business_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{row.lead?.contact_name}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-secondary)]">Step {row.sequence_step}</td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-center gap-1 text-[var(--text-secondary)]">
                      {row.channel === 'sms' ? <MessageSquare size={12} /> : <Mail size={12} />}
                      {row.channel.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-muted)] text-xs">
                    {new Date(row.scheduled_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge label={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
