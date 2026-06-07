import { useState } from 'react'
import { useAllLeads, useBulkAssignLeads } from '../../hooks/useLeads'
import { useReps } from '../../hooks/useProfiles'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Search, UserPlus } from 'lucide-react'

const STATUSES = ['', 'New', 'Contacted', 'Voicemail', 'No Answer', 'Interested', 'Booked', 'Not Interested']

export default function AllLeads() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [assignTo, setAssignTo] = useState('')

  const { data: leads, isLoading } = useAllLeads({
    search: search || undefined,
    status: statusFilter || undefined,
    rep_id: repFilter || undefined,
  })
  const { data: reps } = useReps()
  const bulkAssign = useBulkAssignLeads()

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === leads?.length) setSelected(new Set())
    else setSelected(new Set(leads?.map(l => l.id)))
  }

  async function handleBulkAssign() {
    if (!assignTo || !selected.size) return
    await bulkAssign.mutateAsync({ leadIds: [...selected], repId: assignTo })
    setSelected(new Set())
    setAssignTo('')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-[var(--text-primary)]">All Leads</h1>
          <p className="text-[var(--text-muted)] text-sm mt-0.5">{leads?.length ?? '…'} leads</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            className="pl-8 pr-3 py-2 bg-[var(--bg-2)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-56"
            placeholder="Search business name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          {STATUSES.map(s => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
        </Select>
        <Select value={repFilter} onChange={e => setRepFilter(e.target.value)}>
          <option value="">All Reps</option>
          {(reps || []).map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
        </Select>
      </div>

      {/* Bulk assign bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-900/20 border border-indigo-800 rounded-lg px-4 py-2.5 mb-4">
          <p className="text-sm text-indigo-300">{selected.size} selected</p>
          <Select value={assignTo} onChange={e => setAssignTo(e.target.value)}>
            <option value="">Assign to rep…</option>
            {(reps || []).map(r => <option key={r.id} value={r.id}>{r.full_name}</option>)}
          </Select>
          <Button size="sm" onClick={handleBulkAssign} disabled={!assignTo || bulkAssign.isPending}>
            <UserPlus size={13} />
            {bulkAssign.isPending ? 'Assigning…' : 'Assign'}
          </Button>
          <button onClick={() => setSelected(new Set())} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-sm ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-[10px] overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    checked={leads?.length > 0 && selected.size === leads?.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Business</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Status</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Rep</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Source</th>
                <th className="px-4 py-3 text-xs text-[var(--text-muted)] font-medium text-left">Added</th>
              </tr>
            </thead>
            <tbody>
              {(leads || []).map(lead => (
                <tr key={lead.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-2)]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="accent-indigo-500"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleSelect(lead.id)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--text-primary)] font-medium">{lead.business_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{lead.city}, {lead.state}</p>
                  </td>
                  <td className="px-4 py-3"><Badge label={lead.status} /></td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{lead.assigned_rep?.full_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--text-muted)] capitalize">{lead.source?.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {new Date(lead.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
