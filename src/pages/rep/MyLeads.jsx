import { useState } from 'react'
import { Phone, RefreshCw } from 'lucide-react'
import { useMyLeads } from '../../hooks/useLeads'
import { LeadCard } from '../../components/rep/LeadCard'
import { AIScriptPanel } from '../../components/rep/AIScriptPanel'
import { Button } from '../../components/ui/Button'

export default function MyLeads() {
  const { data: leads, isLoading, refetch } = useMyLeads()
  const [scriptLead, setScriptLead] = useState(null)

  const counts = leads
    ? Object.groupBy?.(leads, l => l.status) || leads.reduce((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1
        return acc
      }, {})
    : {}

  return (
    <div className="flex h-full">
      <div className={`flex-1 min-w-0 ${scriptLead ? 'mr-[420px]' : ''}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-slate-100">My Leads</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Today's batch · {leads?.length ?? '…'} leads
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>

        {/* Status summary */}
        {leads && leads.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-5">
            {Object.entries(counts).map(([status, count]) => (
              <span key={status} className="px-2.5 py-1 rounded-full bg-[#1e2433] text-xs text-slate-300 border border-[#2a3347]">
                {status} <span className="text-slate-500">{count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Lead list */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[#161b24] border border-[#2a3347] animate-pulse" />
            ))}
          </div>
        ) : !leads?.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-full bg-[#1e2433] flex items-center justify-center mb-4">
              <Phone className="text-slate-500" size={24} />
            </div>
            <p className="text-slate-400 font-medium">No leads assigned today</p>
            <p className="text-slate-600 text-sm mt-1">Check back after the nightly batch runs at midnight CST.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {leads.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onScriptOpen={setScriptLead}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI Script Panel slides in from right */}
      {scriptLead && (
        <AIScriptPanel
          lead={scriptLead}
          onClose={() => setScriptLead(null)}
        />
      )}
    </div>
  )
}
