import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Users, Phone, Calendar, DollarSign, TrendingUp, Activity } from 'lucide-react'

export default function Overview() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

      const [leadsRes, callsRes, apptRes, revenueRes, repsRes] = await Promise.all([
        supabase.from('leads').select('id, status', { count: 'exact' }),
        supabase.from('calls').select('id', { count: 'exact' }).gte('created_at', monthStart),
        supabase.from('appointments').select('id, status', { count: 'exact' }),
        supabase.from('appointments').select('deal_value').eq('outcome', 'closed').gte('updated_at', monthStart),
        supabase.from('profiles').select('id').eq('role', 'rep').eq('is_active', true),
      ])

      const statusBreakdown = (leadsRes.data || []).reduce((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1
        return acc
      }, {})

      const mrrClosed = (revenueRes.data || []).reduce((s, d) => s + (d.deal_value || 0), 0)
      const pendingAppts = (apptRes.data || []).filter(a => a.status === 'pending').length

      return {
        totalLeads: leadsRes.count || 0,
        callsThisMonth: callsRes.count || 0,
        pendingAppts,
        mrrClosed,
        activeReps: repsRes.data?.length || 0,
        statusBreakdown,
      }
    },
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-100">Overview</h1>
        <p className="text-slate-500 text-sm mt-0.5">Top-level KPIs across all reps and closers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Leads" value={stats?.totalLeads} icon={Users} color="indigo" />
        <StatCard label="Calls This Month" value={stats?.callsThisMonth} icon={Phone} color="blue" />
        <StatCard label="Pending Appointments" value={stats?.pendingAppts} icon={Calendar} color="yellow" />
        <StatCard label="Revenue This Month" value={`$${(stats?.mrrClosed || 0).toLocaleString()}`} icon={DollarSign} color="green" />
        <StatCard label="Active Reps" value={stats?.activeReps} icon={Activity} color="indigo" />
      </div>

      {stats?.statusBreakdown && (
        <Card>
          <p className="text-sm font-semibold text-slate-200 mb-4">Lead Status Breakdown</p>
          <div className="space-y-2">
            {Object.entries(stats.statusBreakdown).map(([status, count]) => {
              const pct = stats.totalLeads ? Math.round((count / stats.totalLeads) * 100) : 0
              return (
                <div key={status} className="flex items-center gap-3">
                  <p className="text-sm text-slate-400 w-32 flex-shrink-0">{status}</p>
                  <div className="flex-1 h-2 bg-[#2a3347] rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-sm text-slate-300 w-10 text-right">{count}</p>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
