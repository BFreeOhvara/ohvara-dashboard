import { useState } from 'react'
import { usePastDeals } from '../../hooks/useAppointments'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { DollarSign } from 'lucide-react'

const FILTERS = ['all', 'closed', 'lost', 'no_show']

export default function PastDeals() {
  const { data: deals, isLoading } = usePastDeals()
  const [filter, setFilter] = useState('all')

  const filtered = deals?.filter(d => filter === 'all' || d.outcome === filter) || []
  const totalClosed = deals?.filter(d => d.outcome === 'closed').reduce((s, d) => s + (d.deal_value || 0), 0) || 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Past Deals</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">
            ${totalClosed.toLocaleString()} total closed revenue
          </p>
        </div>
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <Button key={f} variant={filter === f ? 'primary' : 'ghost'} size="sm" onClick={() => setFilter(f)}>
              {f.replace('_', ' ')}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-[var(--bg-1)] border border-[var(--border)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-20">
          <DollarSign className="text-[var(--text-muted)] mx-auto mb-2" size={24} />
          <p className="text-[var(--text-muted)] text-sm">No deals match this filter</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Business</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Rep</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Outcome</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Deal Value</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-2)]">
                  <td className="px-4 py-3">
                    <p className="text-[var(--text-primary)] font-medium">{d.lead?.business_name}</p>
                    {d.loss_reason && <p className="text-xs text-[var(--text-muted)]">{d.loss_reason}</p>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{d.rep?.full_name || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge label={d.outcome} />
                  </td>
                  <td className="px-4 py-3 text-[var(--text-primary)]">
                    {d.deal_value ? `$${Number(d.deal_value).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {new Date(d.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
