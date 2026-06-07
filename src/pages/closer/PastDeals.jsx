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
          <h1 className="text-xl font-bold text-slate-100">Past Deals</h1>
          <p className="text-slate-500 text-sm mt-0.5">
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
            <div key={i} className="h-14 bg-[#161b24] border border-[#2a3347] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !filtered.length ? (
        <div className="text-center py-20">
          <DollarSign className="text-slate-600 mx-auto mb-2" size={24} />
          <p className="text-slate-500 text-sm">No deals match this filter</p>
        </div>
      ) : (
        <div className="bg-[#161b24] border border-[#2a3347] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3347] text-left">
                <th className="px-4 py-3 text-xs text-slate-500 font-medium">Business</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium">Rep</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium">Outcome</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium">Deal Value</th>
                <th className="px-4 py-3 text-xs text-slate-500 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} className="border-b border-[#2a3347]/50 hover:bg-[#1e2433]">
                  <td className="px-4 py-3">
                    <p className="text-slate-200 font-medium">{d.lead?.business_name}</p>
                    {d.loss_reason && <p className="text-xs text-slate-500">{d.loss_reason}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{d.rep?.full_name || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge label={d.outcome} />
                  </td>
                  <td className="px-4 py-3 text-slate-200">
                    {d.deal_value ? `$${Number(d.deal_value).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
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
