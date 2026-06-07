import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { StatCard } from '../../components/ui/StatCard'
import { Card } from '../../components/ui/Card'
import { Database, MapPin, Briefcase } from 'lucide-react'

export default function LeadSources() {
  const { data: counts } = useQuery({
    queryKey: ['sources', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('source')
      if (error) throw error
      return (data || []).reduce((acc, l) => {
        acc[l.source] = (acc[l.source] || 0) + 1
        return acc
      }, {})
    },
  })

  const total = Object.values(counts || {}).reduce((s, v) => s + v, 0)
  const gmPct = total ? Math.round(((counts?.google_maps || 0) / total) * 100) : 0
  const indeedPct = total ? Math.round(((counts?.indeed || 0) / total) * 100) : 0

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-[var(--text-primary)]">Lead Sources</h1>
        <p className="text-[var(--text-muted)] text-sm mt-0.5">Indeed vs Google Maps split and scraper controls</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Leads" value={total} icon={Database} color="indigo" />
        <StatCard label="Google Maps" value={counts?.google_maps || 0} icon={MapPin} color="blue" sub={`${gmPct}% of total`} />
        <StatCard label="Indeed" value={counts?.indeed || 0} icon={Briefcase} color="green" sub={`${indeedPct}% of total`} />
      </div>

      <Card className="mb-4">
        <p className="text-sm font-medium text-[var(--text-primary)] mb-4">Source Split</p>
        <div className="space-y-3">
          <SourceBar label="Google Maps" count={counts?.google_maps || 0} pct={gmPct} color="bg-blue-500" />
          <SourceBar label="Indeed" count={counts?.indeed || 0} pct={indeedPct} color="bg-green-500" />
        </div>
      </Card>

      {/* Scraper controls — stubbed */}
      <Card>
        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Scraper Controls</p>
        <p className="text-xs text-[var(--text-muted)] mb-4">Live scraper connection — coming in a future session</p>
        <div className="grid md:grid-cols-2 gap-3">
          <ScraperStub label="Google Maps Scraper" status="Not connected" color="blue" />
          <ScraperStub label="Indeed Scraper" status="Not connected" color="green" />
        </div>
      </Card>
    </div>
  )
}

function SourceBar({ label, count, pct, color }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-sm text-[var(--text-secondary)] w-28 flex-shrink-0">{label}</p>
      <div className="flex-1 h-2 bg-[var(--bg-3)] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-[var(--text-secondary)] w-12 text-right">{count}</p>
    </div>
  )
}

function ScraperStub({ label, status, color }) {
  const dotColor = { blue: 'bg-blue-500', green: 'bg-green-500' }
  return (
    <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-lg p-4 opacity-60">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${dotColor[color]} opacity-40`} />
        <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{status}</p>
      <p className="text-xs text-[var(--text-muted)] mt-1">Wire-this: connect scraper → Supabase in a future session</p>
    </div>
  )
}
