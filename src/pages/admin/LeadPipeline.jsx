import { useLeadPipeline } from '../../hooks/useLeads'
import { Badge } from '../../components/ui/Badge'

const STAGES = ['New', 'Contacted', 'Voicemail', 'No Answer', 'Interested', 'Booked', 'Not Interested']

const STAGE_COLORS = {
  'New':           'border-slate-600',
  'Contacted':     'border-blue-700',
  'Voicemail':     'border-yellow-700',
  'No Answer':     'border-orange-700',
  'Interested':    'border-green-700',
  'Booked':        'border-indigo-700',
  'Not Interested':'border-red-800',
}

export default function LeadPipeline() {
  const { data: leads, isLoading } = useLeadPipeline()

  const grouped = STAGES.reduce((acc, s) => {
    acc[s] = (leads || []).filter(l => l.status === s)
    return acc
  }, {})

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-100">Lead Pipeline</h1>
        <p className="text-slate-500 text-sm mt-0.5">Kanban view across all 7 status stages</p>
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map(s => (
            <div key={s} className="w-56 flex-shrink-0 h-64 bg-[#161b24] border border-[#2a3347] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin">
          {STAGES.map(stage => (
            <div key={stage} className="w-56 flex-shrink-0">
              <div className={`border-t-2 ${STAGE_COLORS[stage]} bg-[#161b24] border border-[#2a3347] rounded-xl overflow-hidden`}>
                <div className="px-3 py-2.5 border-b border-[#2a3347] flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-300">{stage}</p>
                  <span className="text-xs text-slate-500 bg-[#1e2433] rounded px-1.5 py-0.5">
                    {grouped[stage].length}
                  </span>
                </div>
                <div className="p-2 space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto scrollbar-thin">
                  {grouped[stage].length === 0 ? (
                    <p className="text-xs text-slate-600 text-center py-4">Empty</p>
                  ) : (
                    grouped[stage].map(lead => (
                      <div key={lead.id} className="bg-[#1e2433] rounded-lg p-2.5 border border-[#2a3347]">
                        <p className="text-xs font-medium text-slate-200 truncate">{lead.business_name}</p>
                        {lead.assigned_rep && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{lead.assigned_rep.full_name}</p>
                        )}
                        {lead.niche && (
                          <p className="text-xs text-slate-600 mt-0.5 truncate">{lead.niche}</p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
